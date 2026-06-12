import { prisma } from '@/lib/prisma'

const VIEWS_PER_CREDIT = 1000

export async function calculateRewards(reelId: string): Promise<void> {
  const reel = await prisma.generatedReel.findUnique({
    where: { id: reelId },
    select: { userId: true, views24h: true },
  })
  if (!reel || !reel.views24h) return

  const creditsEarned = Math.floor(reel.views24h / VIEWS_PER_CREDIT)
  if (creditsEarned === 0) return

  const existing = await prisma.contentReward.findFirst({ where: { reelId } })

  if (existing) {
    if (creditsEarned <= existing.creditsEarned) return
    const delta = creditsEarned - existing.creditsEarned
    await prisma.$transaction([
      prisma.contentReward.update({
        where: { id: existing.id },
        data: { views: reel.views24h, creditsEarned },
      }),
      prisma.user.update({
        where: { id: reel.userId },
        data: { earnedCredits: { increment: delta } },
      }),
    ])
  } else {
    await prisma.$transaction([
      prisma.contentReward.create({
        data: {
          userId: reel.userId,
          reelId,
          views: reel.views24h,
          creditsEarned,
        },
      }),
      prisma.user.update({
        where: { id: reel.userId },
        data: { earnedCredits: { increment: creditsEarned } },
      }),
    ])
  }
}
