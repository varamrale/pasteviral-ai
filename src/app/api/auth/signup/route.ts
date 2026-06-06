import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
})

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1'

  const limit = await rateLimit(ip, 'signup', 3, 3600)
  if (!limit.success) {
    return NextResponse.json(
      { success: false, error: 'Too many signup attempts. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000).toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': limit.resetAt.toISOString(),
        },
      }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = signupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  const { email, password, name } = parsed.data

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })

  if (existing) {
    return NextResponse.json(
      { success: false, error: 'An account with this email already exists.' },
      { status: 409 }
    )
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: {
      email,
      name: name ?? null,
      passwordHash,
      plan: 'FREE',
      creditsRemaining: 3,
    },
    select: { id: true, email: true },
  })

  logger.info('User registered', { userId: user.id })

  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)

      const verifyUrl = `${process.env.NEXTAUTH_URL}/auth/verify-email?email=${encodeURIComponent(email)}`

      await resend.emails.send({
        from: 'noreply@pasteviral.com',
        to: email,
        subject: 'Verify your email — PasteViral',
        html: `
          <p>Hi ${name ?? 'there'},</p>
          <p>Thanks for signing up! Please verify your email address:</p>
          <p><a href="${verifyUrl}">Verify Email</a></p>
          <p>If you didn't create an account, you can safely ignore this email.</p>
        `,
      })
    } catch (err) {
      logger.error('Failed to send verification email', { error: err, userId: user.id })
    }
  }

  return NextResponse.json(
    { success: true, message: 'Check your email to verify your account.' },
    { status: 201 }
  )
}
