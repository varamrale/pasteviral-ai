import { Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { pvQueue } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

interface PostJobData {
  userId: string
  postId: string
}

const QUEUE_NAME = 'pv-post'

const worker = new Worker<PostJobData>(
  QUEUE_NAME,
  async (job) => {
    logger.info('Processing job', { jobId: job.id, jobName: job.name })
    // TODO: Day 5 — Ayrshare posting
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
