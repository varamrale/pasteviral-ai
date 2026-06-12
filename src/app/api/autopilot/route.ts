import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const VALID_FREQUENCIES = new Set([1, 3, 5])

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

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { autoMode, autoModeFrequency, autoModePaused } = body as Record<string, unknown>

  const update: {
    autoMode?: boolean
    autoModeFrequency?: number
    autoModePaused?: boolean
  } = {}

  if (autoMode !== undefined) {
    if (typeof autoMode !== 'boolean') {
      return NextResponse.json({ error: 'autoMode must be boolean' }, { status: 400 })
    }
    update.autoMode = autoMode
  }

  if (autoModeFrequency !== undefined) {
    if (typeof autoModeFrequency !== 'number' || !VALID_FREQUENCIES.has(autoModeFrequency)) {
      return NextResponse.json({ error: 'autoModeFrequency must be 1, 3, or 5' }, { status: 400 })
    }
    update.autoModeFrequency = autoModeFrequency
  }

  if (autoModePaused !== undefined) {
    if (typeof autoModePaused !== 'boolean') {
      return NextResponse.json({ error: 'autoModePaused must be boolean' }, { status: 400 })
    }
    update.autoModePaused = autoModePaused
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: update,
  })

  return NextResponse.json({ success: true })
}
