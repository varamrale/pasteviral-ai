import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const POLL_INTERVAL_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 5_000
const MAX_STREAM_MS = 10 * 60 * 1000

const STAGE_PROGRESS: Record<string, number> = {
  generating: 20,
  uploading: 60,
  processing_face: 75,
  processing_voice: 85,
}

function stageProgress(stage: string | null | undefined, status: string): number {
  if (status === 'COMPLETE') return 100
  if (status === 'FAILED') return 0
  if (status === 'PENDING') return 5
  if (stage && stage in STAGE_PROGRESS) return STAGE_PROGRESS[stage]
  return 10
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        if (request.signal.aborted) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      const heartbeat = () => {
        if (!request.signal.aborted) controller.enqueue(encoder.encode(':\n\n'))
      }
      const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS)
      const deadline = Date.now() + MAX_STREAM_MS
      try {
        while (!request.signal.aborted && Date.now() < deadline) {
          const reel = await prisma.generatedReel.findUnique({
            where: { id, userId: session.user!.id! },
            select: { status: true, videoUrl: true, processingStage: true, createdAt: true },
          })
          if (!reel) {
            send({ error: 'Not found' })
            break
          }
          send({
            status: reel.status,
            videoUrl: reel.videoUrl,
            processingStage: reel.processingStage,
            progress: stageProgress(reel.processingStage, reel.status),
            createdAt: reel.createdAt,
          })
          if (reel.status === 'COMPLETE' || reel.status === 'FAILED') break
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, POLL_INTERVAL_MS)
            request.signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
          })
        }
      } finally {
        clearInterval(heartbeatTimer)
        controller.close()
      }
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
