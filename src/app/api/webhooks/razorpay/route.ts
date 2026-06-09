import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { Plan } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const PLAN_CREDITS: Record<string, number> = {
  STARTER: 30,
  CREATOR: 100,
  AGENCY: -1,
}

interface RazorpayWebhookPayload {
  event: string
  payload: {
    subscription?: {
      entity: {
        id: string
        notes?: Record<string, string>
      }
    }
    payment?: {
      entity: {
        id: string
      }
    }
  }
}

function isPlan(s: string): s is Plan {
  return (Object.values(Plan) as string[]).includes(s)
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature') ?? ''
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET

  if (!secret) {
    logger.error('RAZORPAY_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  if (signature !== expectedSignature) {
    logger.warn('Razorpay webhook signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: RazorpayWebhookPayload
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sub = event.payload.subscription?.entity
  const payment = event.payload.payment?.entity

  try {
    switch (event.event) {
      case 'subscription.activated': {
        if (!sub) break
        const idempotencyKey = `activated:${sub.id}`
        const existing = await prisma.razorpayEvent.findUnique({ where: { id: idempotencyKey } })
        if (existing) return NextResponse.json({ received: true })

        const planName = sub.notes?.plan ?? ''
        const userId = sub.notes?.userId ?? ''

        if (!userId || !isPlan(planName)) {
          logger.warn('subscription.activated: missing plan or userId in notes', { subId: sub.id })
          await prisma.razorpayEvent.create({ data: { id: idempotencyKey } })
          break
        }

        const credits = PLAN_CREDITS[planName] ?? 3

        await prisma.$transaction([
          prisma.razorpayEvent.create({ data: { id: idempotencyKey } }),
          prisma.user.update({
            where: { id: userId },
            data: {
              plan: planName as Plan,
              creditsRemaining: credits === -1 ? 999999 : credits,
              razorpaySubscriptionId: sub.id,
            },
          }),
        ])
        break
      }

      case 'subscription.charged': {
        if (!sub || !payment) break
        const idempotencyKey = `charged:${payment.id}`
        const existing = await prisma.razorpayEvent.findUnique({ where: { id: idempotencyKey } })
        if (existing) return NextResponse.json({ received: true })

        const planName = sub.notes?.plan ?? ''
        const userId = sub.notes?.userId ?? ''

        if (!userId || !isPlan(planName)) {
          logger.warn('subscription.charged: missing plan or userId in notes', { subId: sub.id })
          await prisma.razorpayEvent.create({ data: { id: idempotencyKey } })
          break
        }

        const credits = PLAN_CREDITS[planName] ?? 3

        if (planName === 'AGENCY') {
          await prisma.razorpayEvent.create({ data: { id: idempotencyKey } })
          break
        }

        await prisma.$transaction([
          prisma.razorpayEvent.create({ data: { id: idempotencyKey } }),
          prisma.user.update({
            where: { id: userId },
            data: { creditsRemaining: credits },
          }),
        ])
        break
      }

      case 'subscription.cancelled': {
        if (!sub) break
        const idempotencyKey = `cancelled:${sub.id}`
        const existing = await prisma.razorpayEvent.findUnique({ where: { id: idempotencyKey } })
        if (existing) return NextResponse.json({ received: true })

        const userId = sub.notes?.userId ?? ''

        if (!userId) {
          logger.warn('subscription.cancelled: missing userId in notes', { subId: sub.id })
          await prisma.razorpayEvent.create({ data: { id: idempotencyKey } })
          break
        }

        await prisma.$transaction([
          prisma.razorpayEvent.create({ data: { id: idempotencyKey } }),
          prisma.user.update({
            where: { id: userId },
            data: {
              plan: Plan.FREE,
              creditsRemaining: 3,
              razorpaySubscriptionId: null,
            },
          }),
        ])
        break
      }

      default:
        break
    }
  } catch (err) {
    logger.error('Razorpay webhook handler error', { error: err, event: event.event })
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
