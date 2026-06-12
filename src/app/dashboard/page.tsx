import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DashboardClient } from './DashboardClient'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [user, topHookStat, trending] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { plan: true, creditsRemaining: true, earnedCredits: true },
    }),
    prisma.userHookStat.findFirst({
      where: { userId: session.user.id },
      orderBy: { avgViewsAchieved: 'desc' },
    }),
    prisma.viralReel.findMany({
      orderBy: { adjustedScore: 'desc' },
      take: 10,
      select: {
        id: true,
        platform: true,
        reelUrl: true,
        creatorHandle: true,
        viewCount: true,
        velocityScore: true,
        hookType: true,
        niche: true,
        thumbnailUrl: true,
      },
    }),
  ])

  if (!user) redirect('/login')

  return (
    <DashboardClient
      user={{
        plan: user.plan,
        creditsRemaining: user.creditsRemaining,
        earnedCredits: user.earnedCredits,
      }}
      topHookStat={
        topHookStat
          ? { hookType: topHookStat.hookType, avgViewsAchieved: topHookStat.avgViewsAchieved }
          : null
      }
      trendingReels={trending.map((r) => ({
        id: r.id,
        platform: r.platform,
        reelUrl: r.reelUrl,
        creatorHandle: r.creatorHandle,
        viewCount: Number(r.viewCount),
        velocityScore: r.velocityScore,
        hookType: r.hookType,
        niche: r.niche,
        thumbnailUrl: r.thumbnailUrl,
      }))}
    />
  )
}
