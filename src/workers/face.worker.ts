import { Worker, Job, UnrecoverableError } from 'bullmq'
import { Prisma } from '@prisma/client'
import { pvQueue } from '../lib/redis'
import { pvVoiceQueue, pvPostQueue } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { uploadToR2, getPublicUrl, generateSignedUrl } from '../lib/r2-client'

interface FaceJobData {
  reelId: string
  userId: string
}

interface MagicHourJobResult {
  id: string
  status: 'processing' | 'complete' | 'failed'
  download_url?: string
}

const QUEUE_NAME = 'pv-face'
const MAGIC_HOUR_BASE = 'https://api.magichour.ai/api/v1/face-swap/video'
const POLL_INTERVAL_MS = 10_000
const MAX_POLL_MS = 5 * 60 * 1_000

async function submitFaceSwap(
  sourceVideoUrl: string,
  faceImageUrl: string,
): Promise<string> {
  const apiKey = process.env.MAGIC_HOUR_API_KEY ?? ''
  const res = await fetch(MAGIC_HOUR_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source_video_url: sourceVideoUrl, face_image_url: faceImageUrl }),
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 422) {
      throw new UnrecoverableError(`Magic Hour rejected request: ${body}`)
    }
    throw new Error(`Magic Hour submit failed ${res.status}: ${body}`)
  }

  const data = (await res.json()) as MagicHourJobResult
  return data.id
}

async function pollFaceSwap(jobId: string): Promise<MagicHourJobResult> {
  const apiKey = process.env.MAGIC_HOUR_API_KEY ?? ''
  const deadline = Date.now() + MAX_POLL_MS

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    const res = await fetch(`${MAGIC_HOUR_BASE}/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!res.ok) {
      throw new Error(`Magic Hour poll failed ${res.status}`)
    }

    const data = (await res.json()) as MagicHourJobResult
    if (data.status === 'complete' || data.status === 'failed') {
      return data
    }
  }

  throw new Error('Magic Hour face swap timed out after 5 minutes')
}

const worker = new Worker<FaceJobData>(
  QUEUE_NAME,
  async (job: Job<FaceJobData>) => {
    const { reelId, userId } = job.data

    const reel = await prisma.generatedReel.findUnique({
      where: { id: reelId },
      include: {
        user: {
          select: { plan: true, facePhotoUrl: true, elevenLabsVoiceId: true },
        },
      },
    })

    if (!reel) {
      throw new UnrecoverableError(`Reel ${reelId} not found`)
    }

    const { plan, facePhotoUrl, elevenLabsVoiceId } = reel.user
    const planAllowsFaceSwap = plan === 'CREATOR' || plan === 'AGENCY'

    if (!planAllowsFaceSwap || !facePhotoUrl || !reel.videoUrl) {
      logger.info('Skipping face swap', { reelId, plan, hasFacePhoto: !!facePhotoUrl })
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { processingStage: 'face_complete' },
      })
      try {
        if (elevenLabsVoiceId) {
          await pvVoiceQueue.add('voice-clone', { reelId, userId })
        } else {
          await pvPostQueue.add('post-reel', { reelId, userId })
        }
      } catch (queueErr) {
        logger.error('Failed to queue next stage from face skip path', { reelId, err: queueErr })
        await prisma.generatedReel.update({ where: { id: reelId }, data: { status: 'FAILED', processingStage: null } })
        throw queueErr
      }
      return
    }

    let magicHourJobId = reel.magicHourJobId

    if (!magicHourJobId || magicHourJobId === 'pending') {
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { magicHourJobId: 'pending' },
      })

      const signedFaceUrl = await generateSignedUrl(facePhotoUrl)
      const jobId = await submitFaceSwap(reel.videoUrl, signedFaceUrl)

      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { magicHourJobId: jobId },
      })
      magicHourJobId = jobId
      logger.info('Magic Hour job submitted', { reelId, magicHourJobId: jobId })
    } else {
      logger.info('Resuming Magic Hour job', { reelId, magicHourJobId })
    }

    const result = await pollFaceSwap(magicHourJobId)

    if (result.status === 'failed' || !result.download_url) {
      await prisma.generatedReel.update({
        where: { id: reelId },
        data: { status: 'FAILED', processingStage: null, magicHourJobId: null },
      })
      throw new UnrecoverableError('Magic Hour face swap returned failed status')
    }

    const swappedRes = await fetch(result.download_url)
    if (!swappedRes.ok) {
      throw new Error(`Failed to download swapped video: ${swappedRes.status}`)
    }
    const swappedBuffer = Buffer.from(await swappedRes.arrayBuffer())

    const r2Key = `users/${userId}/reels/${reelId}-face.mp4`
    await uploadToR2(swappedBuffer, r2Key, 'video/mp4')
    const publicUrl = getPublicUrl(r2Key)

    await prisma.generatedReel.update({
      where: { id: reelId },
      data: {
        videoUrl: publicUrl,
        faceSwapApplied: true,
        processingStage: 'face_complete',
        magicHourJobId: null,
      },
    })

    logger.info('Face swap complete', { reelId })

    try {
      if (elevenLabsVoiceId) {
        await pvVoiceQueue.add('voice-clone', { reelId, userId })
      } else {
        await pvPostQueue.add('post-reel', { reelId, userId })
      }
    } catch (queueErr) {
      logger.error('Failed to queue next stage after face swap', { reelId, err: queueErr })
      await prisma.generatedReel.update({ where: { id: reelId }, data: { status: 'FAILED', processingStage: null } })
      throw queueErr
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
  logger.error('Face job failed', { reelId, userId, error: err.message, attempt: job.attemptsMade })

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
        data: { status: 'FAILED', processingStage: null, magicHourJobId: null },
      })
      logger.error('Face job moved to DLQ', { reelId, queue: QUEUE_NAME })
    } catch (dbErr) {
      logger.error('Failed to write to DLQ', { error: dbErr })
    }
  }
})

process.on('SIGTERM', async () => {
  await worker.close()
})

export default worker
