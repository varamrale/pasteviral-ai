import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pvCache } from '@/lib/redis'
import { upgradeScript } from '@/lib/script-engine'
import { generateHooks, HookVariant } from '@/lib/hook-engine'

const scriptPostSchema = z.object({ reelId: z.string().min(1, 'reelId is required') }).strict()

const scriptPatchSchema = z.object({
  reelId: z.string().min(1, 'reelId is required'),
  selectedHook: z.string().optional(),
  hookType: z.string().optional(),
  upgradedScript: z.string().optional(),
}).strict()

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

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsedPost = scriptPostSchema.safeParse(raw)
  if (!parsedPost.success) {
    return NextResponse.json({ error: parsedPost.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const reel = await prisma.generatedReel.findUnique({
    where: { id: parsedPost.data.reelId, userId },
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

  let rawPatch: unknown
  try {
    rawPatch = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsedPatch = scriptPatchSchema.safeParse(rawPatch)
  if (!parsedPatch.success) {
    return NextResponse.json({ error: parsedPatch.error.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { reelId, selectedHook, hookType, upgradedScript } = parsedPatch.data

  await prisma.generatedReel.updateMany({
    where: { id: reelId, userId: session.user.id },
    data: {
      ...(selectedHook !== undefined && { selectedHook }),
      ...(hookType !== undefined && { hookType }),
      ...(upgradedScript !== undefined && { upgradedScript }),
    },
  })

  return NextResponse.json({ ok: true })
}
