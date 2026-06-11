import { Worker, Job, DelayedError } from 'bullmq'
import { Prisma } from '@prisma/client'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pvQueue } from '../lib/redis'
import { pvVideoQueue, pvFaceQueue, pvVoiceQueue } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { generateVideo, pollVideoJob } from '../lib/fal-client'
import { uploadToR2 } from '../lib/r2-client'
import { checkAndDeductCredits, InsufficientCreditsError } from '../lib/credits'

const QUEUE_NAME = 'pv-video'
const MAX_PER_USER = 3
const REEL_COST = 1

interface VideoJobData {
  reelId: string
  userId: string
  generationMode?: string
}

function toSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},000`
}

function buildSrt(transcript: string): string {
  const lines = transcript.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean)
  if (lines.length === 0) return ''
  const durationPerLine = 3
  return lines.map((line, i) => {
    const start = i * durationPerLine
    const end = (i + 1) * durationPerLine
    return `${i + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${line}\n`
  }).join('\n')
}

async function burnCaptions(inputBuffer: Buffer, transcript: string, reelId: string): Promise<Buffer> {
  const tmp = tmpdir()
  const inputPath = join(tmp, `${reelId}-input.mp4`)
  const srtPath = join(tmp, `${reelId}-captions.srt`)
  const outputPath = join(tmp, `${reelId}-output.mp4`)
  try {
    writeFileSync(inputPath, inputBuffer)
    writeFileSync(srtPath, buildSrt(transcript), 'utf-8')
    execSync(
      `ffmpeg -i "${inputPath}" -vf subtitles="${srtPath}" -c:v libx264 -c:a aac -y "${outputPath}"`,
      { stdio: 'pipe' },
    )
    return readFileSync(outputPath)
  } catch (err) {
    logger.warn('FFmpeg caption burn failed — using original video', { err })
    return inputBuffer
  } finally {
    for (const p of [inputPath, srtPath, outputPath]) {
      if (existsSync(p)) unlinkSync(p)
    }
  }
}

const worker = new Worker<VideoJobData>(
  QUEUE_NAME,
  async (job: Job<VideoJobData>, token) => {
    const { reelId, userId } = job.data

    const activeJobs = await pvVideoQueue.getActive()
    const userActive = activeJobs.filter((j) => j.data.userId === userId).length
    if (userActive > MAX_PER_USER) {
      await job.moveToDelayed(Date.now() + 10_000, token)
      throw new DelayedError()
    }

    const reel = await prisma.generatedReel.findUnique({
      where: { id: reelId },
      include: { user: { select: { plan: true } } },
    })
    if (!reel) {
      logger.error('Reel not found in video worker', { reelId })
      return
    }

    await prisma.generatedReel.update({
      where: { id: reelId },
      data: { status: 'PROCESSING', processingStage: 'generating' },
    })

    const falMode = reel.user.plan === 'CREATOR' || reel.user.plan === 'AGENCY' ? 'paid' : 'free'
    const script = reel.upgradedScript ?? reel.originalTranscript ?? reel.selectedHook ?? ''

    let falJobId = reel.falJobId
    let endpoint: string

    if (falJobId) {
      endpoint = falMode === 'paid'
        ? '/fal-ai/kling-video/v1.6/standard/text-to-video'
        : '/fal-ai/wan/v2.1/text-to-video'
      logger.info('Resuming existing fal.ai job', { reelId, falJobId })
    } else {
      const submission = await generateVideo(script, reel.sourcePlatform, falMode)
      falJobId = submission.jobId
      endpoint = submission.endpoint
      await prisma.generatedReel.update({ where: { id: reelId }, data: { falJobId } })
      logger.info('fal.ai job submitted', { reelId, falJobId })
    }

    const pollResult = await pollVideoJob(falJobId, endpoint)
    if (pollResult.status === 'FAILED' || !pollResult.videoUrl) {
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { status: 'FAILED', processingStage: null },
      })
      throw new Error('fal.ai video generation failed')
    }

    const videoRes = await fetch(pollResult.videoUrl)
    if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`)
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

    await prisma.generatedReel.update({
      where: { id: reelId },
      data: { processingStage: 'uploading' },
    })

    const transcript = reel.originalTranscript ?? reel.upgradedScript ?? ''
    const finalBuffer = transcript ? await burnCaptions(videoBuffer, transcript, reelId) : videoBuffer

    const r2Key = `users/${userId}/reels/${reelId}.mp4`
    const signedUrl = await uploadToR2(finalBuffer, r2Key, 'video/mp4')

    try {
      await checkAndDeductCredits(userId, REEL_COST)
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        logger.warn('Insufficient credits after upload — marking failed', { userId, reelId })
        await prisma.generatedReel.update({
          where: { id: reelId },
          data: { status: 'FAILED', processingStage: null },
        })
        return
      }
      throw err
    }

    const generationMode = reel.generationMode ?? job.data.generationMode ?? 'personal'
    await prisma.generatedReel.update({
      where: { id: reelId },
      data: { status: 'COMPLETE', videoUrl: signedUrl, completedAt: new Date(), processingStage: null },
    })
    logger.info('Video generation complete', { reelId, generationMode })

    if (generationMode === 'personal') {
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { processingStage: 'processing_face' },
      })
      await pvFaceQueue.add('face-swap', { reelId, userId })
      await pvVoiceQueue.add('voice-clone', { reelId, userId })
    }
  },
  {
    connection: pvQueue,
    concurrency: 5,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
)

worker.on('failed', async (job, err) => {
  if (!job) return
  const { reelId, userId } = job.data
  const maxAttempts = job.opts.attempts ?? 3
  logger.error('Video job failed', { reelId, userId, err: err.message })

  if (job.attemptsMade >= maxAttempts) {
    try {
      await prisma.failedJob.create({
        data: {
          queueName: QUEUE_NAME,
          jobId: job.id ?? 'unknown',
          payload: job.data as unknown as Prisma.InputJsonValue,
          errorMessage: err.message,
          retryCount: job.attemptsMade,
          userId,
        },
      })
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { status: 'FAILED', processingStage: null },
      })
    } catch (dbErr) {
      logger.error('Failed to write to DLQ', { error: dbErr })
    }
  }
})

process.on('SIGTERM', async () => {
  await worker.close()
})

export default worker
