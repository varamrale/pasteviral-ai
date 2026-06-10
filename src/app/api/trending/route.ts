import { NextRequest, NextResponse } from 'next/server'
import { Prisma, Platform } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { pvCache } from '@/lib/redis'

const VALID_PLATFORMS = new Set<string>(Object.values(Platform))

const TIMESPAN_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const niche = searchParams.get('niche') ?? undefined
  const platformParam = searchParams.get('platform')?.toUpperCase() ?? undefined
  const timespan = searchParams.get('timespan') ?? '24h'
  const minViewsParam = searchParams.get('minViews') ?? '0'
  const minViews = parseInt(minViewsParam, 10)

  const platform =
    platformParam && VALID_PLATFORMS.has(platformParam)
      ? (platformParam as Platform)
      : undefined

  const cacheKey = `trending:${niche ?? ''}:${platform ?? ''}:${timespan}:${minViews}`

  const cached = await pvCache.get(cacheKey)
  if (cached) {
    return NextResponse.json(JSON.parse(cached))
  }

  const timespanMs = TIMESPAN_MS[timespan] ?? TIMESPAN_MS['24h']
  const since = new Date(Date.now() - timespanMs)

  const where: Prisma.ViralReelWhereInput = {
    firstSeenAt: { gte: since },
    ...(niche ? { niche } : {}),
    ...(platform ? { platform } : {}),
    ...(minViews > 0 ? { viewCount: { gte: BigInt(minViews) } } : {}),
  }

  const reels = await prisma.viralReel.findMany({
    where,
    orderBy: { adjustedScore: 'desc' },
    take: 20,
  })

  const data = reels.map((r) => ({
    id: r.id,
    platform: r.platform,
    reelUrl: r.reelUrl,
    creatorHandle: r.creatorHandle,
    viewCount: r.viewCount.toString(),
    likeCount: r.likeCount.toString(),
    commentCount: r.commentCount.toString(),
    shareCount: r.shareCount.toString(),
    velocityScore: r.velocityScore,
    adjustedScore: r.adjustedScore,
    niche: r.niche,
    topHashtags: r.topHashtags,
    views24hAgo: r.views24hAgo.toString(),
    avgDailyViews7d: r.avgDailyViews7d,
    firstSeenAt: r.firstSeenAt,
    lastCheckedAt: r.lastCheckedAt,
    alertSent: r.alertSent,
  }))

  const response = { success: true, data }

  await pvCache.set(cacheKey, JSON.stringify(response), 'EX', 900)

  return NextResponse.json(response)
}
