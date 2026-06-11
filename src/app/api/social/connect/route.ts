import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

const connectSchema = z.object({
  platform: z.enum(['INSTAGRAM', 'TIKTOK', 'YOUTUBE']),
})

interface AyrshareProfileResponse {
  profileKey?: string
  id?: string
  status?: string
  message?: string
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
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = connectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Invalid platform' },
      { status: 400 },
    )
  }

  const apiKey = process.env.AYRSHARE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Ayrshare not configured' }, { status: 500 })
  }

  const userId = session.user.id

  const res = await fetch('https://app.ayrshare.com/api/profiles', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: userId }),
  })

  if (!res.ok) {
    const err = (await res.json()) as AyrshareProfileResponse
    return NextResponse.json(
      { error: err.message ?? 'Failed to create Ayrshare profile' },
      { status: 502 },
    )
  }

  const data = (await res.json()) as AyrshareProfileResponse
  if (!data.profileKey) {
    return NextResponse.json({ error: 'No profile key returned from Ayrshare' }, { status: 502 })
  }

  const encryptedKey = encrypt(data.profileKey)

  await prisma.user.update({
    where: { id: userId },
    data: { ayrshareProfileKey: encryptedKey },
  })

  return NextResponse.json({ success: true })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.AYRSHARE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Ayrshare not configured' }, { status: 500 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { ayrshareProfileKey: true },
  })

  if (user?.ayrshareProfileKey) {
    let profileKey: string
    try {
      profileKey = decrypt(user.ayrshareProfileKey)
      await fetch('https://app.ayrshare.com/api/profiles', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Profile-Key': profileKey,
        },
      })
    } catch {
      // Best-effort — always clear from DB regardless of Ayrshare response
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { ayrshareProfileKey: null },
  })

  return NextResponse.json({ success: true })
}
