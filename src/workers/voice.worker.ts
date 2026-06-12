import { Worker, Job, UnrecoverableError } from 'bullmq'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import { Prisma } from '@prisma/client'
import { pvQueue, pvCache } from '../lib/redis'
import { pvPostQueue } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { uploadToR2, generateSignedUrl, getPublicUrl } from '../lib/r2-client'

const QUEUE_NAME = 'pv-voice'
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'
const TTS_CACHE_TTL = 24 * 60 * 60

const execFileAsync = promisify(execFile)

interface VoiceJobData {
  reelId: string
  userId: string
}

function ttsCacheKey(voiceId: string, script: string): string {
  return `tts:${createHash('sha256').update(voiceId + script).digest('hex')}`
}

async function synthesizeSpeech(voiceId: string, script: string, apiKey: string): Promise<Buffer> {
  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: script,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 422) {
      throw new UnrecoverableError(`ElevenLabs TTS input rejected: ${body.slice(0, 200)}`)
    }
    throw new Error(`ElevenLabs TTS failed with status ${res.status}`)
  }

  return Buffer.from(await res.arrayBuffer())
}

async function mergeAudioVideo(
  videoUrl: string,
  audioBuffer: Buffer,
  reelId: string,
): Promise<Buffer> {
  const videoRes = await fetch(videoUrl)
  if (!videoRes.ok) {
    throw new Error(`Failed to download source video: ${videoRes.status}`)
  }
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

  const tmpVideo = join(tmpdir(), `pv-${reelId}-video.mp4`)
  const tmpAudio = join(tmpdir(), `pv-${reelId}-audio.mp3`)
  const tmpOutput = join(tmpdir(), `pv-${reelId}-merged.mp4`)

  await writeFile(tmpVideo, videoBuffer)
  await writeFile(tmpAudio, audioBuffer)

  await execFileAsync(ffmpegPath!, [
    '-i', tmpVideo,
    '-i', tmpAudio,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    '-y',
    tmpOutput,
  ])

  const merged = await readFile(tmpOutput)

  await Promise.all([
    unlink(tmpVideo).catch(() => undefined),
    unlink(tmpAudio).catch(() => undefined),
    unlink(tmpOutput).catch(() => undefined),
  ])

  return merged
}

const worker = new Worker<VoiceJobData>(
  QUEUE_NAME,
  async (job: Job<VoiceJobData>) => {
    const { reelId, userId } = job.data

    const reel = await prisma.generatedReel.findUnique({
      where: { id: reelId },
      include: {
        user: {
          select: { plan: true, elevenLabsVoiceId: true },
        },
      },
    })

    if (!reel) {
      throw new UnrecoverableError(`Reel ${reelId} not found`)
    }

    const script = reel.upgradedScript ?? reel.originalTranscript
    if (!script) {
      throw new UnrecoverableError(`Reel ${reelId} has no script to narrate`)
    }

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey || apiKey === 'not_configured_yet') {
      logger.info('ElevenLabs not configured — skipping voice, chaining to post', { reelId })
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { processingStage: 'voice_complete' },
      })
      try {
        await pvPostQueue.add('post-reel', { reelId, userId })
      } catch (queueErr) {
        logger.error('Failed to queue post after voice skip', { reelId, err: queueErr })
        await prisma.generatedReel.update({
          where: { id: reelId },
          data: { status: 'FAILED', processingStage: null },
        })
        throw queueErr
      }
      return
    }

    const { plan, elevenLabsVoiceId } = reel.user
    const defaultVoiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM'
    const isPaidPlan = plan === 'STARTER' || plan === 'CREATOR' || plan === 'AGENCY'
    const voiceId = isPaidPlan && elevenLabsVoiceId ? elevenLabsVoiceId : defaultVoiceId

    // Idempotency: write 'pending' BEFORE API call; real id written after success
    if (!reel.elevenLabsJobId || reel.elevenLabsJobId === 'pending') {
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { elevenLabsJobId: 'pending' },
      })
    }

    const cacheKey = ttsCacheKey(voiceId, script)
    const sharedAudioR2Key = `cache/audio/${cacheKey}.mp3`
    let audioBuffer: Buffer

    const cachedR2Key = await pvCache.get(cacheKey)

    if (cachedR2Key) {
      logger.info('TTS cache hit — skipping ElevenLabs', { reelId })
      try {
        const signedUrl = await generateSignedUrl(cachedR2Key)
        const audioRes = await fetch(signedUrl)
        if (!audioRes.ok) throw new Error(`R2 fetch returned ${audioRes.status}`)
        audioBuffer = Buffer.from(await audioRes.arrayBuffer())
      } catch {
        logger.warn('TTS cache stale — re-synthesizing', { reelId })
        await pvCache.del(cacheKey)
        audioBuffer = await synthesizeSpeech(voiceId, script, apiKey)
        await uploadToR2(audioBuffer, sharedAudioR2Key, 'audio/mpeg')
        await pvCache.setex(cacheKey, TTS_CACHE_TTL, sharedAudioR2Key)
      }
    } else {
      audioBuffer = await synthesizeSpeech(voiceId, script, apiKey)
      await uploadToR2(audioBuffer, sharedAudioR2Key, 'audio/mpeg')
      await pvCache.setex(cacheKey, TTS_CACHE_TTL, sharedAudioR2Key)
    }

    await prisma.generatedReel.update({
      where: { id: reelId },
      data: { elevenLabsJobId: `tts-${Date.now()}` },
    })

    let finalVideoUrl = reel.videoUrl ?? null
    if (reel.videoUrl) {
      try {
        const mergedBuffer = await mergeAudioVideo(reel.videoUrl, audioBuffer, reelId)
        const mergedR2Key = `users/${userId}/reels/${reelId}-voice.mp4`
        await uploadToR2(mergedBuffer, mergedR2Key, 'video/mp4')
        finalVideoUrl = getPublicUrl(mergedR2Key)
      } catch (mergeErr) {
        logger.warn('FFmpeg merge failed — continuing with original video', {
          reelId,
          error: mergeErr instanceof Error ? mergeErr.message : String(mergeErr),
        })
      }
    }

    await prisma.generatedReel.update({
      where: { id: reelId },
      data: {
        videoUrl: finalVideoUrl,
        voiceApplied: true,
        processingStage: 'voice_complete',
        elevenLabsJobId: null,
      },
    })

    logger.info('Voice synthesis complete', { reelId })

    try {
      await pvPostQueue.add('post-reel', { reelId, userId })
    } catch (queueErr) {
      logger.error('Failed to queue post stage after voice', { reelId, err: queueErr })
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { status: 'FAILED', processingStage: null },
      })
      throw queueErr
    }
  },
  {
    connection: pvQueue,
    concurrency: 2,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
)

worker.on('failed', async (job, err) => {
  if (!job) return
  const { reelId, userId } = job.data
  const maxAttempts = job.opts.attempts ?? 3
  logger.error('Voice job failed', { reelId, userId, error: err.message, attempt: job.attemptsMade })

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
        data: { status: 'FAILED', processingStage: null, elevenLabsJobId: null },
      })
      logger.error('Voice job moved to DLQ', { reelId })
    } catch (dbErr) {
      logger.error('Failed to write voice DLQ entry', { error: dbErr })
    }
  }
})

process.on('SIGTERM', async () => {
  await worker.close()
})

export default worker
