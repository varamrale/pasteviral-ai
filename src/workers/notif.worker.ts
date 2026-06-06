import { Worker, Job } from 'bullmq'
import { pvQueue } from '../lib/redis'
import { logger } from '../lib/logger'

const worker = new Worker(
  'pv-notif',
  async (job: Job) => {
    logger.info(`Processing job`, { jobId: job.id, jobName: job.name })
    // TODO: Day 6 — web-push + Resend email
  },
  {
    connection: pvQueue,
    concurrency: 20,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  }
)

worker.on('failed', (job, err) => {
  logger.error(`Job failed`, { jobId: job?.id, error: err.message })
})

export default worker