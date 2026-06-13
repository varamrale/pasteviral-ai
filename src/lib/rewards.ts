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

  const existing = await prisma.contentReward.findUnique({ where: { reelId } })
  if (existing?.paidOut) return
  if (existing && creditsEarned <= existing.creditsEarned) return

  const delta = creditsEarned - (existing?.creditsEarned ?? 0)

  await prisma.$transaction([
    prisma.contentReward.upsert({
      where: { reelId },
      create: { userId: reel.userId, reelId, views: reel.views24h, creditsEarned },
      update: { views: reel.views24h, creditsEarned },
    }),
    prisma.user.update({
      where: { id: reel.userId },
      data: { earnedCredits: { increment: delta } },
    }),
  ])
}
