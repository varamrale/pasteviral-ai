import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const [user, rewards] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { earnedCredits: true },
    }),
    prisma.contentReward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        reelId: true,
        views: true,
        creditsEarned: true,
        paidOut: true,
        createdAt: true,
        reel: { select: { sourceUrl: true, hookType: true } },
      },
    }),
  ])

  const totalViews = rewards.reduce((sum, r) => sum + r.views, 0)

  return NextResponse.json({
    totalEarnedCredits: user?.earnedCredits ?? 0,
    totalViews,
    rewardHistory: rewards.map((r) => ({
      id: r.id,
      reelId: r.reelId,
      views: r.views,
      creditsEarned: r.creditsEarned,
      paidOut: r.paidOut,
      createdAt: r.createdAt,
      sourceUrl: r.reel.sourceUrl,
      hookType: r.reel.hookType,
    })),
  })
}
