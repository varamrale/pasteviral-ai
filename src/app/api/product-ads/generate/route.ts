import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pvVideoQueue } from '@/lib/queue'
import { validateUrl } from '@/lib/url-parser'

const generateAdSchema = z.object({
  productUrl: z.string().min(1),
  productName: z.string().min(1).max(100),
  adFormat: z.enum(['talking_head', 'unboxing', 'tutorial', 'before_after', 'problem_solution', 'trending_hook']),
}).strict()

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })
  if (!user || user.plan !== 'AGENCY') {
    return NextResponse.json(
      { error: 'Product Ads require the AGENCY plan' },
      { status: 403 },
    )
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = generateAdSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  const { productUrl, productName, adFormat } = parsed.data

  const urlValidation = validateUrl(productUrl)
  if (!urlValidation.valid) {
    return NextResponse.json({ error: urlValidation.error }, { status: 400 })
  }

  const reel = await prisma.generatedReel.create({
    data: {
      userId,
      sourceUrl: productUrl,
      sourcePlatform: 'YOUTUBE',
      status: 'PENDING',
      creditsUsed: 1,
      generationMode: 'product_ad',
      adMode: true,
      productUrl,
      productName,
      adFormat,
    },
  })

  await pvVideoQueue.add('generate-reel', {
    reelId: reel.id,
    userId,
    generationMode: 'product_ad',
    sourceUrl: productUrl,
    productName,
    adFormat,
  })

  return NextResponse.json({ reelId: reel.id }, { status: 201 })
}
