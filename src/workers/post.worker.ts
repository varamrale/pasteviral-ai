import { Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { pvQueue } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { decrypt } from '../lib/crypto'

interface PostJobData {
  userId: string
  reelId: string
}

interface AyrsharePostResponse {
  id?: string
  status?: string
}

const QUEUE_NAME = 'pv-post'
const HASHTAG = '#AIGenerated'

const worker = new Worker<PostJobData>(
  QUEUE_NAME,
  async (job) => {
    logger.info('Processing post job', { jobId: job.id, reelId: job.data.reelId })

    const reel = await prisma.generatedReel.findUnique({
      where: { id: job.data.reelId, userId: job.data.userId },
      include: { user: { select: { ayrshareProfileKey: true } } },
    })

    if (!reel) throw new Error(`Reel ${job.data.reelId} not found`)
    if (!reel.videoUrl) throw new Error(`Reel ${reel.id} has no video URL`)
    if (!reel.user.ayrshareProfileKey) throw new Error(`User ${job.data.userId} has no Ayrshare profile`)

    if (reel.ayrsharePostId) {
      logger.info('Already posted — idempotency skip', { reelId: reel.id, ayrsharePostId: reel.ayrsharePostId })
      return
    }

    const apiKey = process.env.AYRSHARE_API_KEY
    if (!apiKey) throw new Error('AYRSHARE_API_KEY not configured')

    const profileKey = decrypt(reel.user.ayrshareProfileKey)
    const caption = `${reel.upgradedScript ?? ''} ${HASHTAG}`.trim()

    const res = await fetch('https://app.ayrshare.com/api/post', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Profile-Key': profileKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post: caption,
        platforms: ['instagram', 'tiktok'],
        mediaUrls: [reel.videoUrl],
      }),
    })

    if (!res.ok) {
      const err = (await res.json()) as { message?: string }
      throw new Error(err.message ?? `Ayrshare post failed with status ${res.status}`)
    }

    const data = (await res.json()) as AyrsharePostResponse

    await prisma.generatedReel.update({
      where: { id: reel.id },
      data: {
        ayrsharePostId: data.id ?? null,
        status: 'POSTED',
        postedAt: new Date(),
      },
    })

    logger.info('Reel posted', { reelId: reel.id, ayrsharePostId: data.id })
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
  const maxAttempts = job.opts.attempts ?? 3
  logger.error('Job failed', { jobId: job.id, error: err.message, attempt: job.attemptsMade })

  if (job.attemptsMade >= maxAttempts) {
    try {
      await prisma.failedJob.create({
        data: {
          queueName: QUEUE_NAME,
          jobId: job.id ?? 'unknown',
          payload: job.data as unknown as Prisma.InputJsonValue,
          errorMessage: err.message,
          retryCount: job.attemptsMade,
          userId: job.data.userId,
        },
      })
      logger.error('Job written to DLQ', { jobId: job.id, queue: QUEUE_NAME })
    } catch (dbErr) {
      logger.error('Failed to write to DLQ', { error: dbErr })
    }
  }
})

process.on('SIGTERM', async () => {
  await worker.close()
})

export default worker
