import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pvCache } from '@/lib/redis'
import { upgradeScript } from '@/lib/script-engine'
import { generateHooks, HookVariant } from '@/lib/hook-engine'

const SCRIPT_CACHE_TTL = 86400 // 24 hours

interface ScriptCachePayload {
  upgradedScript: string
  similarityScore: number
  hooks: HookVariant[]
  topic: string
  angle: string
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  let body: { reelId?: unknown }
  try {
    body = await request.json() as { reelId?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body.reelId !== 'string' || !body.reelId.trim()) {
    return NextResponse.json({ error: 'reelId is required' }, { status: 400 })
  }

  const reel = await prisma.generatedReel.findUnique({
    where: { id: body.reelId, userId },
    select: {
      id: true,
      originalTranscript: true,
      sourcePlatform: true,
    },
  })

  if (!reel) {
    return NextResponse.json({ error: 'Reel not found' }, { status: 404 })
  }

  if (!reel.originalTranscript) {
    return NextResponse.json({ error: 'No transcript available for this reel' }, { status: 422 })
  }

  const cacheKey = `script:${createHash('sha256').update(`${reel.id}:${reel.originalTranscript}`).digest('hex')}`

  const cached = await pvCache.get(cacheKey)
  if (cached) {
    try {
      return NextResponse.json(JSON.parse(cached) as ScriptCachePayload)
    } catch {
      // fall through
    }
  }

  const platform = reel.sourcePlatform.toString()
  const [scriptResult, hooks] = await Promise.all([
    upgradeScript(reel.originalTranscript, platform),
    generateHooks(reel.originalTranscript, platform),
  ])

  const topHook = hooks[0]

  await prisma.generatedReel.update({
    where: { id: reel.id },
    data: {
      upgradedScript: scriptResult.upgradedScript,
      similarityScore: scriptResult.similarityScore,
      hookType: topHook?.type ?? null,
    },
  })

  const payload: ScriptCachePayload = {
    upgradedScript: scriptResult.upgradedScript,
    similarityScore: scriptResult.similarityScore,
    hooks,
    topic: scriptResult.topic,
    angle: scriptResult.angle,
  }

  await pvCache.set(cacheKey, JSON.stringify(payload), 'EX', SCRIPT_CACHE_TTL)

  return NextResponse.json(payload)
}

export async function PATCH(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { reelId?: unknown; selectedHook?: unknown; hookType?: unknown; upgradedScript?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body.reelId !== 'string') {
    return NextResponse.json({ error: 'reelId is required' }, { status: 400 })
  }

  await prisma.generatedReel.updateMany({
    where: { id: body.reelId, userId: session.user.id },
    data: {
      ...(typeof body.selectedHook === 'string' && { selectedHook: body.selectedHook }),
      ...(typeof body.hookType === 'string' && { hookType: body.hookType }),
      ...(typeof body.upgradedScript === 'string' && { upgradedScript: body.upgradedScript }),
    },
  })

  return NextResponse.json({ ok: true })
}
