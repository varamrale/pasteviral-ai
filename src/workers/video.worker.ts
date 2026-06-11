import { Worker, Job, DelayedError, UnrecoverableError } from 'bullmq'
import { Prisma } from '@prisma/client'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pvQueue } from '../lib/redis'
import { pvVideoQueue, pvFaceQueue } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { generateVideo, pollVideoJob, FalPermanentError } from '../lib/fal-client'
import { uploadToR2, getPublicUrl } from '../lib/r2-client'
import { checkAndDeductCredits, InsufficientCreditsError } from '../lib/credits'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegBin: string = (require('ffmpeg-static') as string | null) ?? 'ffmpeg'

const QUEUE_NAME = 'pv-video'
const MAX_PER_USER = 3
const REEL_COST = 1
const PAID_ENDPOINT = '/fal-ai/kling-video/v1.6/standard/text-to-video'
const FREE_ENDPOINT = '/fal-ai/wan/v2.1/text-to-video'

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
      `"${ffmpegBin}" -i "${inputPath}" -vf subtitles="${srtPath}" -c:v libx264 -c:a aac -y "${outputPath}"`,
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
    let endpoint = falMode === 'paid' ? PAID_ENDPOINT : FREE_ENDPOINT

    if (!falJobId || falJobId === 'PENDING_FAL') {
      // Write sentinel before submitting to prevent double-charge on worker crash/retry
      await prisma.generatedReel.update({ where: { id: reelId }, data: { falJobId: 'PENDING_FAL' } })

      let submission: Awaited<ReturnType<typeof generateVideo>>
      try {
        submission = await generateVideo(script, reel.sourcePlatform, falMode)
      } catch (submitErr: unknown) {
        if (submitErr instanceof FalPermanentError) {
          await prisma.generatedReel.update({
            where: { id: reelId },
            data: { status: 'FAILED', processingStage: null },
          })
          throw new UnrecoverableError((submitErr as Error).message)
        }
        throw submitErr
      }

      falJobId = submission.jobId
      endpoint = submission.endpoint
      await prisma.generatedReel.update({ where: { id: reelId }, data: { falJobId } })
      logger.info('fal.ai job submitted', { reelId, falJobId })
    } else {
      logger.info('Resuming existing fal.ai job', { reelId, falJobId })
    }

    const pollResult = await pollVideoJob(falJobId!, endpoint)
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
    let publicVideoUrl: string
    try {
      await uploadToR2(finalBuffer, r2Key, 'video/mp4')
      publicVideoUrl = getPublicUrl(r2Key)
    } catch (uploadErr: unknown) {
      logger.error('R2 upload failed — marking reel as FAILED', { reelId, err: uploadErr })
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { status: 'FAILED', processingStage: null },
      })
      throw uploadErr
    }

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
    const nextStage = generationMode === 'personal' ? 'processing_face' : null
    await prisma.generatedReel.update({
      where: { id: reelId },
      data: { status: 'COMPLETE', videoUrl: publicVideoUrl, completedAt: new Date(), processingStage: nextStage },
    })
    logger.info('Video generation complete', { reelId, generationMode })

    if (generationMode === 'personal') {
      try {
        await pvFaceQueue.add('face-swap', { reelId, userId })
      } catch (queueErr) {
        logger.error('Failed to queue face-swap job', { reelId, err: queueErr })
        await prisma.generatedReel.update({
          where: { id: reelId },
          data: { status: 'FAILED', processingStage: null },
        })
        throw queueErr
      }
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
