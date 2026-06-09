import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { razorpay } from '@/lib/razorpay'

const PLAN_IDS: Record<string, string | undefined> = {
  STARTER: process.env.RAZORPAY_PLAN_STARTER_ID,
  CREATOR: process.env.RAZORPAY_PLAN_CREATOR_ID,
  AGENCY: process.env.RAZORPAY_PLAN_AGENCY_ID,
}

const bodySchema = z.object({
  plan: z.enum(['STARTER', 'CREATOR', 'AGENCY']),
})

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

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Invalid plan' },
      { status: 400 }
    )
  }

  const { plan } = parsed.data
  const userId = session.user.id

  const planId = PLAN_IDS[plan]
  if (!planId) {
    return NextResponse.json(
      { error: `Razorpay plan ID not configured for ${plan}` },
      { status: 500 }
    )
  }

  const subscription = await razorpay.subscriptions.create({
    plan_id: planId,
    total_count: 120,
    customer_notify: 1,
    notes: {
      userId,
      plan,
    },
  })

  return NextResponse.json({
    subscriptionId: subscription.id,
    keyId: process.env.RAZORPAY_KEY_ID,
  })
}
