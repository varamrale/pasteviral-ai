import { Worker, Job } from 'bullmq'
import { pvQueue } from '../lib/redis'
import { logger } from '../lib/logger'

const worker = new Worker(
  'pv-face',
  async (job: Job) => {
    logger.info(`Processing job`, { jobId: job.id, jobName: job.name })
    // TODO: Day 11 — Magic Hour face swap
  },
  {
    connection: pvQueue,
    concurrency: 5,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  }
)

worker.on('failed', (job, err) => {
  logger.error(`Job failed`, { jobId: job?.id, error: err.message })
})

export default worker