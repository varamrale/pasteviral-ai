import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { validateUrl } from '@/lib/url-parser'

const addChannelSchema = z.object({
  youtubeChannelUrl: z.string().min(1),
}).strict()

const YT_CHANNEL_REGEX = /(?:youtube\.com\/(?:channel\/|@|user\/))([a-zA-Z0-9_\-@]+)/

function extractChannelId(url: string): string | null {
  const match = YT_CHANNEL_REGEX.exec(url)
  return match ? match[1] : null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const channels = await prisma.monitoredAccount.findMany({
    where: { userId: session.user.id, platform: 'YOUTUBE' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      handle: true,
      youtubeChannelId: true,
      autoClipEnabled: true,
      autoClipMinViews: true,
      lastUploadedVideoId: true,
      lastFetchedAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ channels })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = addChannelSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { youtubeChannelUrl } = parsed.data

  const urlValidation = validateUrl(youtubeChannelUrl)
  if (!urlValidation.valid) {
    return NextResponse.json({ error: urlValidation.error }, { status: 400 })
  }

  const channelId = extractChannelId(youtubeChannelUrl)
  if (!channelId) {
    return NextResponse.json({ error: 'Could not extract YouTube channel ID from URL' }, { status: 400 })
  }

  const existing = await prisma.monitoredAccount.findFirst({
    where: { userId, platform: 'YOUTUBE', youtubeChannelId: channelId },
  })
  if (existing) {
    return NextResponse.json({ error: 'Channel already monitored' }, { status: 409 })
  }

  const channel = await prisma.monitoredAccount.create({
    data: {
      userId,
      platform: 'YOUTUBE',
      handle: channelId,
      youtubeChannelId: channelId,
      autoClipEnabled: true,
    },
    select: {
      id: true,
      handle: true,
      youtubeChannelId: true,
      autoClipEnabled: true,
      autoClipMinViews: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ channel }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const channel = await prisma.monitoredAccount.findFirst({
    where: { id, userId: session.user.id, platform: 'YOUTUBE' },
  })
  if (!channel) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.monitoredAccount.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
