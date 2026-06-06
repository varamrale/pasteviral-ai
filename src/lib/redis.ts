import IORedis from 'ioredis'

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}

export const pvQueue = new IORedis(process.env.UPSTASH_QUEUE_URL!, redisOptions)
export const pvCache = new IORedis(process.env.UPSTASH_CACHE_URL!, redisOptions)
export const pvSession = new IORedis(process.env.UPSTASH_SESSION_URL!, redisOptions)