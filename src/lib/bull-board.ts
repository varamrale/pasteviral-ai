import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/dist/src/queueAdapters/bullMQ'
import type { BaseAdapter } from '@bull-board/api/dist/src/queueAdapters/base'
import { HonoAdapter } from '@bull-board/hono'
import { serveStatic } from '@hono/node-server/serve-static'
import {
  pvVideoQueue,
  pvPostQueue,
  pvViralQueue,
  pvNotifQueue,
  pvFaceQueue,
  pvVoiceQueue,
} from './queue'

export function createBullBoardApp() {
  const serverAdapter = new HonoAdapter(serveStatic)
  serverAdapter.setBasePath('/api/admin/queues')

  createBullBoard({
    queues: [
      new BullMQAdapter(pvVideoQueue) as unknown as BaseAdapter,
      new BullMQAdapter(pvPostQueue) as unknown as BaseAdapter,
      new BullMQAdapter(pvViralQueue) as unknown as BaseAdapter,
      new BullMQAdapter(pvNotifQueue) as unknown as BaseAdapter,
      new BullMQAdapter(pvFaceQueue) as unknown as BaseAdapter,
      new BullMQAdapter(pvVoiceQueue) as unknown as BaseAdapter,
    ],
    serverAdapter,
  })

  return serverAdapter.registerPlugin()
}
