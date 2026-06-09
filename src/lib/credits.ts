import { Plan } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export class InsufficientCreditsError extends Error {
  constructor(required: number, available: number) {
    super(`Insufficient credits: need ${required}, have ${available}`)
    this.name = 'InsufficientCreditsError'
  }
}

export async function checkCredits(userId: string, cost: number): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, creditsRemaining: true },
  })

  if (!user) throw new Error(`User not found: ${userId}`)
  if (user.plan === Plan.AGENCY) return

  if (user.creditsRemaining < cost) {
    throw new InsufficientCreditsError(cost, user.creditsRemaining)
  }
}

export async function deductCredits(userId: string, cost: number, reelId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })

  if (!user) throw new Error(`User not found: ${userId}`)

  if (user.plan === Plan.AGENCY) {
    await prisma.generatedReel.update({
      where: { id: reelId },
      data: { creditsUsed: cost },
    })
    return
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { creditsRemaining: { decrement: cost } },
    }),
    prisma.generatedReel.update({
      where: { id: reelId },
      data: { creditsUsed: cost },
    }),
  ])
}
