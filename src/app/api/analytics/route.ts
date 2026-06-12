import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pvCache } from '@/lib/redis'

const CACHE_TTL_SECONDS = 15 * 60

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const cacheKey = `analytics:${userId}`
  try {
    const cached = await pvCache.get(cacheKey)
    if (cached) {
      return NextResponse.json(JSON.parse(cached as string))
    }
  } catch {
    // cache miss — continue to DB
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const reels = await prisma.generatedReel.findMany({
    where: { userId, status: 'POSTED', createdAt: { gte: since } },
    select: {
      id: true,
      views24h: true,
      creditsUsed: true,
      hookType: true,
      sourceUrl: true,
      postedAt: true,
    },
  })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { earnedCredits: true },
  })

  const totalReels = reels.length
  const totalViews = reels.reduce((sum, r) => sum + (r.views24h ?? 0), 0)
  const avgViewsPerReel = totalReels > 0 ? Math.round(totalViews / totalReels) : 0
  const creditsUsed = reels.reduce((sum, r) => sum + r.creditsUsed, 0)

  const hookMap = new Map<string, { totalViews: number; count: number }>()
  for (const r of reels) {
    if (!r.hookType) continue
    const entry = hookMap.get(r.hookType) ?? { totalViews: 0, count: 0 }
    entry.totalViews += r.views24h ?? 0
    entry.count += 1
    hookMap.set(r.hookType, entry)
  }
  const hookPerformance = Array.from(hookMap.entries()).map(([hookType, data]) => ({
    hookType,
    avgViews: data.count > 0 ? Math.round(data.totalViews / data.count) : 0,
    count: data.count,
  }))

  const topReel = reels.reduce<{ id: string; views24h: number; sourceUrl: string } | null>(
    (best, r) => {
      if (!best || (r.views24h ?? 0) > best.views24h) {
        return { id: r.id, views24h: r.views24h ?? 0, sourceUrl: r.sourceUrl }
      }
      return best
    },
    null,
  )

  const postsThisWeek = reels.filter(
    (r) => r.postedAt && r.postedAt >= weekAgo,
  ).length
  const viewsThisWeek = reels
    .filter((r) => r.postedAt && r.postedAt >= weekAgo)
    .reduce((sum, r) => sum + (r.views24h ?? 0), 0)

  const result = {
    totalReels,
    totalViews,
    avgViewsPerReel,
    creditsUsed,
    creditsEarned: user?.earnedCredits ?? 0,
    hookPerformance,
    topReel,
    postsThisWeek,
    viewsThisWeek,
  }

  try {
    await pvCache.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS)
  } catch {
    // non-fatal
  }

  return NextResponse.json(result)
}
