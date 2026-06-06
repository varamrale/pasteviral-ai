import { pvSession } from '@/lib/redis'

interface RateLimitResult {
  success: boolean
  remaining: number
  resetAt: Date
}

export async function rateLimit(
  ip: string,
  action: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const key = `rate_limit:${action}:${ip}`
  const now = Date.now()
  const windowStart = now - windowSeconds * 1000

  const pipeline = pvSession.pipeline()
  pipeline.zremrangebyscore(key, '-inf', windowStart)
  pipeline.zadd(key, now, `${now}`)
  pipeline.zcard(key)
  pipeline.expire(key, windowSeconds)

  const results = await pipeline.exec()
  const count = (results?.[2]?.[1] as number) ?? 0

  const resetAt = new Date(now + windowSeconds * 1000)
  const remaining = Math.max(0, maxAttempts - count)

  return {
    success: count <= maxAttempts,
    remaining,
    resetAt,
  }
}
