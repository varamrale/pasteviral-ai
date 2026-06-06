import { Worker, Job } from 'bullmq'
import { pvQueue } from '../lib/redis'
import { logger } from '../lib/logger'

const worker = new Worker(
  'pv-video',
  async (job: Job) => {
    logger.info(`Processing job`, { jobId: job.id, jobName: job.name })
    // TODO: Day 10 — fal.ai video generation
  },
  {
    connection: pvQueue,
    concurrency: 3,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  }
)

worker.on('failed', (job, err) => {
  logger.error(`Job failed`, { jobId: job?.id, error: err.message })
})

export default worker