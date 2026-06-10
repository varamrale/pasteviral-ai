import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pvVideoQueue } from '@/lib/queue'
import { checkAndDeductCredits, InsufficientCreditsError } from '@/lib/credits'
import { validateUrl, canonicalizeUrl } from '@/lib/url-parser'

const REEL_COST = 1

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

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

  try {
    await checkAndDeductCredits(userId, REEL_COST)
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: err.message }, { status: 402 })
    }
    throw err
  }

  const canonicalUrl = canonicalizeUrl(body.url)

  const analyseRes = await fetch(
    new URL('/api/reels/analyse', request.url).toString(),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({ url: canonicalUrl }),
    },
  )

  if (!analyseRes.ok) {
    const err = await analyseRes.json() as { error?: string }
    return NextResponse.json({ error: err.error ?? 'Analysis failed' }, { status: analyseRes.status })
  }

  const analyseData = await analyseRes.json() as {
    platform: string
    transcript: string | null
    metadata: Record<string, unknown>
  }

  const reel = await prisma.generatedReel.create({
    data: {
      userId,
      sourceUrl: canonicalUrl,
      sourcePlatform: validation.platform!,
      originalTranscript: analyseData.transcript ?? undefined,
      status: 'PENDING',
      creditsUsed: REEL_COST,
    },
  })

  const job = await pvVideoQueue.add('generate-reel', {
    reelId: reel.id,
    userId,
    sourceUrl: canonicalUrl,
    platform: validation.platform,
    transcript: analyseData.transcript,
    metadata: analyseData.metadata,
  })

  return NextResponse.json({ reelId: reel.id, jobId: job.id })
}
