import { Queue } from 'bullmq'
import { pvQueue } from './redis'

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
}

export const pvVideoQueue = new Queue('pv-video', { connection: pvQueue, defaultJobOptions })
export const pvPostQueue = new Queue('pv-post', { connection: pvQueue, defaultJobOptions })
export const pvViralQueue = new Queue('pv-viral', { connection: pvQueue, defaultJobOptions })
export const pvNotifQueue = new Queue('pv-notif', { connection: pvQueue, defaultJobOptions })
export const pvFaceQueue = new Queue('pv-face', { connection: pvQueue, defaultJobOptions })
export const pvVoiceQueue = new Queue('pv-voice', { connection: pvQueue, defaultJobOptions })
