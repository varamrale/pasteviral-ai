import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = subscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { endpoint, p256dh, auth: authKey } = parsed.data

  await prisma.notificationSub.upsert({
    where: { endpoint },
    update: { p256dh, auth: authKey },
    create: {
      userId: session.user.id,
      endpoint,
      p256dh,
      auth: authKey,
    },
  })

  return NextResponse.json({ success: true })
}
