import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const autopilotSchema = z
  .object({
    autoMode: z.boolean().optional(),
    autoModeFrequency: z
      .union([z.literal(1), z.literal(3), z.literal(5)], {
        errorMap: () => ({ message: 'autoModeFrequency must be 1, 3, or 5' }),
      })
      .optional(),
    autoModePaused: z.boolean().optional(),
  })
  .strict()

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      autoMode: true,
      autoModeFrequency: true,
      autoModePaused: true,
      reels: {
        where: { status: 'POSTED', postedAt: { not: null } },
        orderBy: { postedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          sourcePlatform: true,
          sourceUrl: true,
          postedAt: true,
          views24h: true,
        },
      },
    },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    autoMode: user.autoMode,
    autoModeFrequency: user.autoModeFrequency,
    autoModePaused: user.autoModePaused,
    recentPosts: user.reels,
  })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = autopilotSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Invalid request' },
      { status: 400 },
    )
  }

  const { autoMode, autoModeFrequency, autoModePaused } = parsed.data

  const update: {
    autoMode?: boolean
    autoModeFrequency?: number
    autoModePaused?: boolean
  } = {}

  if (autoMode !== undefined) update.autoMode = autoMode
  if (autoModeFrequency !== undefined) update.autoModeFrequency = autoModeFrequency
  if (autoModePaused !== undefined) update.autoModePaused = autoModePaused

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  // Concurrent requests race at DB level (last-write-wins). Acceptable for
  // low-frequency settings toggles — optimistic locking is not warranted here.
  await prisma.user.update({
    where: { id: session.user.id },
    data: update,
  })

  return NextResponse.json({ success: true })
}
