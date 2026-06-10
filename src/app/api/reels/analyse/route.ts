import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pvSession } from '@/lib/redis'
import { canonicalizeUrl, validateUrl } from '@/lib/url-parser'

const CACHE_TTL_SECONDS = 21600 // 6 hours
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW = 3600 // 1 hour

async function checkRateLimit(userId: string): Promise<boolean> {
  const key = `rl:analyse:${userId}`
  const count = await pvSession.incr(key)
  if (count === 1) await pvSession.expire(key, RATE_LIMIT_WINDOW)
  return count <= RATE_LIMIT_MAX
}

async function fetchTranscript(url: string): Promise<string | null> {
  const apiKey = process.env.SUPADATA_API_KEY
  if (!apiKey) return null
  const res = await fetch(
    `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&text=true&mode=auto`,
    { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000) },
  )
  if (!res.ok) return null
  const body = await res.json() as { content?: string }
  return body.content ?? null
}

async function fetchMetadata(url: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.SOCIAVAULT_API_KEY
  if (!apiKey) return {}
  const res = await fetch(
    `https://api.sociavault.com/v1/scrape/instagram/reels?url=${encodeURIComponent(url)}`,
    { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) },
  )
  if (!res.ok) return {}
  return res.json() as Promise<Record<string, unknown>>
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const allowed = await checkRateLimit(userId)
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded. Max 10 analyses per hour.' }, { status: 429 })
  }

  let body: { url?: unknown }
  try {
    body = await request.json() as { url?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body.url !== 'string' || !body.url.trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  const validation = validateUrl(body.url)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const canonicalUrl = canonicalizeUrl(body.url)
  const urlHash = createHash('sha256').update(canonicalUrl).digest('hex')

  const cached = await prisma.urlCache.findUnique({
    where: { urlHash },
    select: { platform: true, transcript: true, metadata: true, expiresAt: true },
  })

  if (cached && cached.expiresAt > new Date()) {
    return NextResponse.json({
      platform: cached.platform,
      transcript: cached.transcript,
      metadata: cached.metadata,
      cached: true,
    })
  }

  const [transcript, metadata] = await Promise.all([
    fetchTranscript(canonicalUrl),
    fetchMetadata(canonicalUrl),
  ])

  const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000)

  await prisma.urlCache.upsert({
    where: { urlHash },
    create: {
      urlHash,
      platform: validation.platform!,
      transcript,
      metadata: metadata as object,
      expiresAt,
    },
    update: {
      platform: validation.platform!,
      transcript,
      metadata: metadata as object,
      expiresAt,
      cachedAt: new Date(),
    },
  })

  return NextResponse.json({
    platform: validation.platform,
    transcript,
    metadata,
    cached: false,
  })
}
