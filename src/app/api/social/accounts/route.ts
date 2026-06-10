import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'

interface AyrshareUserResponse {
  activeSocialAccounts?: string[]
  status?: string
}

const SUPPORTED_PLATFORMS = [
  { id: 'INSTAGRAM', label: 'Instagram', slug: 'instagram' },
  { id: 'TIKTOK', label: 'TikTok', slug: 'tiktok' },
  { id: 'YOUTUBE', label: 'YouTube', slug: 'youtube' },
] as const

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { ayrshareProfileKey: true },
  })

  if (!user?.ayrshareProfileKey) {
    return NextResponse.json({
      platforms: SUPPORTED_PLATFORMS.map((p) => ({ ...p, connected: false })),
      hasProfile: false,
    })
  }

  const apiKey = process.env.AYRSHARE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Ayrshare not configured' }, { status: 500 })
  }

  let profileKey: string
  try {
    profileKey = decrypt(user.ayrshareProfileKey)
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt profile key' }, { status: 500 })
  }

  const res = await fetch('https://app.ayrshare.com/api/user', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Profile-Key': profileKey,
    },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch accounts from Ayrshare' }, { status: 502 })
  }

  const data = (await res.json()) as AyrshareUserResponse
  const active = new Set((data.activeSocialAccounts ?? []).map((p) => p.toLowerCase()))

  const platforms = SUPPORTED_PLATFORMS.map((p) => ({
    ...p,
    connected: active.has(p.slug),
  }))

  return NextResponse.json({ platforms, hasProfile: true })
}
