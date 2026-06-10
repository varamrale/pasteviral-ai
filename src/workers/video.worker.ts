import { Worker, DelayedError } from 'bullmq'
import { Prisma } from '@prisma/client'
import { pvQueue } from '../lib/redis'
import { pvVideoQueue } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

interface VideoJobData {
  userId: string
  reelId: string
}

const QUEUE_NAME = 'pv-video'
const MAX_PER_USER = 3

const worker = new Worker<VideoJobData>(
  QUEUE_NAME,
  async (job, token) => {
    const activeJobs = await pvVideoQueue.getActive()
    const userActive = activeJobs.filter(
      (j) => (j.data as VideoJobData).userId === job.data.userId,
    ).length

    if (userActive > MAX_PER_USER) {
      await job.moveToDelayed(Date.now() + 10_000, token)
      throw new DelayedError()
    }

    logger.info('Processing job', { jobId: job.id, jobName: job.name })
    // TODO: Day 10 — fal.ai video generation
  },
  {
    connection: pvQueue,
    concurrency: 20,
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
