import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await auth()

  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        if (request.signal.aborted) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      while (!request.signal.aborted) {
        const reel = await prisma.generatedReel.findUnique({
          where: { id, userId: session.user!.id! },
          select: { status: true, videoUrl: true },
        })

        if (!reel) {
          send({ error: 'Not found' })
          break
        }

        send({ status: reel.status, videoUrl: reel.videoUrl, progress: null })

        if (reel.status === 'COMPLETE' || reel.status === 'FAILED') break

        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 2000)
          request.signal.addEventListener('abort', () => {
            clearTimeout(t)
            resolve()
          }, { once: true })
        })
      }

      controller.close()
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
