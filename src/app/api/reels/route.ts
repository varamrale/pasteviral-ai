import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pvVideoQueue } from '@/lib/queue'
import { checkCredits, InsufficientCreditsError } from '@/lib/credits'
import { validateUrl, canonicalizeUrl } from '@/lib/url-parser'

const REEL_COST = 1

const reelSchema = z.object({
  url: z.string().min(1, 'url is required'),
  generationMode: z.enum(['personal', 'faceless']).optional(),
}).strict()

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

  const parsed = reelSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const generationMode = parsed.data.generationMode ?? 'personal'
  const validation = validateUrl(parsed.data.url)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  try {
    await checkCredits(userId, REEL_COST)
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: err.message }, { status: 402 })
    }
    throw err
  }

  const canonicalUrl = canonicalizeUrl(parsed.data.url)

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
      generationMode,
    },
  })

  const job = await pvVideoQueue.add('generate-reel', {
    reelId: reel.id,
    userId,
    generationMode,
    sourceUrl: canonicalUrl,
    platform: validation.platform,
    transcript: analyseData.transcript,
    metadata: analyseData.metadata,
  })

  return NextResponse.json({ reelId: reel.id, jobId: job.id })
}
