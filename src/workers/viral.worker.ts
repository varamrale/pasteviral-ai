import { Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { pvQueue } from '../lib/redis'
import { pvViralQueue, pvNotifQueue } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

interface ViralJobData {
  type: 'cron'
}

interface SociaVaultReel {
  url: string
  creator_handle?: string
  view_count?: number
  like_count?: number
  comment_count?: number
  share_count?: number
  hashtags?: string[]
}

interface SociaVaultResponse {
  reels?: SociaVaultReel[]
  data?: SociaVaultReel[]
}

const QUEUE_NAME = 'pv-viral'
const SOCIAVAULT_BASE = 'https://api.sociavault.com/v1/scrape/instagram'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

const worker = new Worker<ViralJobData>(
  QUEUE_NAME,
  async (job) => {
    logger.info('Viral scan started', { jobId: job.id })

    const apiKey = process.env.SOCIAVAULT_API_KEY
    if (!apiKey || apiKey === 'not_configured_yet') {
      logger.warn('SOCIAVAULT_API_KEY not configured, skipping scan')
      return
    }

    const users = await prisma.user.findMany({
      where: { niches: { isEmpty: false } },
      select: { id: true, niches: true },
    })

    if (users.length === 0) return

    const nicheToUsers = new Map<string, string[]>()
    for (const user of users) {
      for (const niche of user.niches) {
        const existing = nicheToUsers.get(niche) ?? []
        nicheToUsers.set(niche, [...existing, user.id])
      }
    }

    for (const [niche, userIds] of nicheToUsers) {
      const scanHash = sha256(`scan:instagram:${niche}`)
      const now = new Date()

      const cachedScan = await prisma.urlCache.findFirst({
        where: { urlHash: scanHash, expiresAt: { gt: now } },
        select: { id: true },
      })

      let reels: SociaVaultReel[] = []

      if (!cachedScan) {
        try {
          const res = await fetch(
            `${SOCIAVAULT_BASE}/reels-by-hashtag?hashtag=${encodeURIComponent(niche)}&limit=20`,
            { headers: { Authorization: `Bearer ${apiKey}` } },
          )
          if (!res.ok) {
            logger.warn('SociaVault API error', { niche, status: res.status })
            continue
          }
          const body = (await res.json()) as SociaVaultResponse
          reels = body.reels ?? body.data ?? []
        } catch (err) {
          logger.error('SociaVault fetch failed', { niche, error: err })
          continue
        }

        const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)
        await prisma.urlCache.upsert({
          where: { urlHash: scanHash },
          update: { expiresAt, cachedAt: now },
          create: { urlHash: scanHash, platform: 'INSTAGRAM', expiresAt },
        })
      }

      const newViralReelIds: string[] = []

      for (const reel of reels) {
        if (!reel.url) continue

        const urlHash = sha256(reel.url)
        const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)

        await prisma.urlCache.upsert({
          where: { urlHash },
          update: { expiresAt, cachedAt: now },
          create: { urlHash, platform: 'INSTAGRAM', expiresAt },
        })

        const existing = await prisma.viralReel.findUnique({
          where: { urlHash },
          select: { id: true },
        })
        if (existing) continue

        const viewCount = reel.view_count ?? 0
        const views24hAgo = 0
        const avgDailyViews7d = 0
        const velocityScore = (viewCount - views24hAgo) / Math.max(avgDailyViews7d, 1)
        const nicheInTags =
          !reel.hashtags ||
          reel.hashtags.length === 0 ||
          reel.hashtags.some((tag) => tag.toLowerCase().includes(niche.toLowerCase()))
        const nicheMultiplier = nicheInTags ? 1.3 : 0.7
        const adjustedScore = velocityScore * nicheMultiplier

        if (adjustedScore <= 10) continue

        const viralReel = await prisma.viralReel.create({
          data: {
            platform: 'INSTAGRAM',
            reelUrl: reel.url,
            urlHash,
            creatorHandle: reel.creator_handle ?? null,
            viewCount: BigInt(viewCount),
            likeCount: BigInt(reel.like_count ?? 0),
            commentCount: BigInt(reel.comment_count ?? 0),
            shareCount: BigInt(reel.share_count ?? 0),
            velocityScore,
            adjustedScore,
            niche,
            topHashtags: reel.hashtags ?? [],
            views24hAgo: BigInt(0),
            avgDailyViews7d: 0,
          },
        })

        newViralReelIds.push(viralReel.id)
      }

      for (const userId of userIds) {
        for (const viralReelId of newViralReelIds) {
          await pvNotifQueue.add('viral-spike', { userId, viralReelId, type: 'VIRAL_SPIKE' })
        }
      }

      logger.info('Niche processed', { niche, newReels: newViralReelIds.length })
    }

    logger.info('Viral scan complete', { jobId: job.id })
  },
  {
    connection: pvQueue,
    concurrency: 10,
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
          userId: 'system',
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

void pvViralQueue.upsertJobScheduler(
  'viral-cron',
  { pattern: '*/15 * * * *' },
  { name: 'viral-scan', data: { type: 'cron' } },
)

export default worker
