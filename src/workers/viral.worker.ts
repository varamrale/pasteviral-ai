import { Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { pvQueue } from '../lib/redis'
import { pvViralQueue, pvNotifQueue, pvVideoQueue } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { calculateRewards } from '../lib/rewards'

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
      const validReels = reels.filter((r) => !!r.url)

      // Batch urlCache upserts in parallel — eliminates N sequential awaits
      const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)
      await Promise.all(
        validReels.map((reel) => {
          const urlHash = sha256(reel.url)
          return prisma.urlCache.upsert({
            where: { urlHash },
            update: { expiresAt, cachedAt: now },
            create: { urlHash, platform: 'INSTAGRAM', expiresAt },
          })
        }),
      )

      // Pre-fetch all existing hashes in one query — eliminates N findUnique calls
      const allHashes = validReels.map((r) => sha256(r.url))
      const existingReels = await prisma.viralReel.findMany({
        where: { urlHash: { in: allHashes } },
        select: { urlHash: true },
      })
      const existingHashes = new Set(existingReels.map((r) => r.urlHash))

      for (const reel of validReels) {
        const urlHash = sha256(reel.url)
        if (existingHashes.has(urlHash)) continue

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

      // Parallelize all notification queue adds — eliminates N×M sequential awaits
      await Promise.all(
        userIds.flatMap((userId) =>
          newViralReelIds.map((viralReelId) =>
            pvNotifQueue.add('viral-spike', { userId, viralReelId, type: 'VIRAL_SPIKE' }),
          ),
        ),
      )

      logger.info('Niche processed', { niche, newReels: newViralReelIds.length })
    }

    // YouTube auto-clip: check monitored channels for new uploads
    const ytApiKey = process.env.YOUTUBE_API_KEY
    if (ytApiKey && ytApiKey !== 'not_configured_yet') {
      const channels = await prisma.monitoredAccount.findMany({
        where: { platform: 'YOUTUBE', autoClipEnabled: true, youtubeChannelId: { not: null } },
        select: {
          id: true,
          userId: true,
          youtubeChannelId: true,
          autoClipMinViews: true,
          lastUploadedVideoId: true,
        },
      })

      for (const channel of channels) {
        const channelId = channel.youtubeChannelId!
        const cacheHash = sha256(`yt-channel:${channelId}`)
        const now = new Date()

        const cachedChannel = await prisma.urlCache.findFirst({
          where: { urlHash: cacheHash, expiresAt: { gt: now } },
          select: { id: true },
        })

        if (cachedChannel) continue

        try {
          const ytRes = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${encodeURIComponent(channelId)}&order=date&type=video&maxResults=5&key=${ytApiKey}`,
          )
          if (!ytRes.ok) {
            logger.warn('YouTube API error', { channelId, status: ytRes.status })
            continue
          }

          interface YtSearchItem { id: { videoId?: string } }
          interface YtSearchResponse { items?: YtSearchItem[] }
          const ytBody = (await ytRes.json()) as YtSearchResponse
          const videos = ytBody.items ?? []

          const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)
          await prisma.urlCache.upsert({
            where: { urlHash: cacheHash },
            update: { expiresAt, cachedAt: now },
            create: { urlHash: cacheHash, platform: 'YOUTUBE', expiresAt },
          })

          for (const video of videos) {
            const videoId = video.id?.videoId
            if (!videoId) continue
            if (videoId === channel.lastUploadedVideoId) break

            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
            await pvVideoQueue.add('generate-reel', {
              userId: channel.userId,
              sourceUrl: videoUrl,
              platform: 'YOUTUBE',
              generationMode: 'faceless',
            })

            await prisma.monitoredAccount.update({
              where: { id: channel.id },
              data: { lastUploadedVideoId: videoId, lastFetchedAt: now },
            })
            break
          }
        } catch (err) {
          logger.error('YouTube channel poll failed', { channelId, error: err })
        }
      }
    }

    // Calculate content rewards for recently posted reels (batched to cap concurrent DB connections)
    const postedReels = await prisma.generatedReel.findMany({
      where: { status: 'POSTED', views24h: { gt: 0 } },
      select: { id: true },
      take: 100,
    })
    const BATCH_SIZE = 10
    for (let i = 0; i < postedReels.length; i += BATCH_SIZE) {
      await Promise.allSettled(postedReels.slice(i, i + BATCH_SIZE).map((r) => calculateRewards(r.id)))
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
