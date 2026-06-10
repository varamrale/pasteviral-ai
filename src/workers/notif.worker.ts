import { Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import webpush from 'web-push'
import { Resend } from 'resend'
import { pvQueue } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

interface NotifJobData {
  userId: string
  viralReelId: string
  type: 'VIRAL_SPIKE'
}

const QUEUE_NAME = 'pv-notif'

webpush.setVapidDetails(
  'mailto:admin@pasteviral.ai',
  process.env.VAPID_PUBLIC_KEY ?? '',
  process.env.VAPID_PRIVATE_KEY ?? '',
)

const resend = new Resend(process.env.RESEND_API_KEY)

const worker = new Worker<NotifJobData>(
  QUEUE_NAME,
  async (job) => {
    const { userId, viralReelId } = job.data
    logger.info('Processing notification', { jobId: job.id, userId, viralReelId })

    const [user, viralReel, sub] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      }),
      prisma.viralReel.findUnique({
        where: { id: viralReelId },
        select: { id: true, niche: true, adjustedScore: true, reelUrl: true, platform: true },
      }),
      prisma.notificationSub.findFirst({
        where: { userId },
      }),
    ])

    if (!user || !viralReel) {
      logger.warn('User or ViralReel not found', { userId, viralReelId })
      return
    }

    if (sub) {
      try {
        const payload = JSON.stringify({
          title: '🔥 Viral Spike Detected!',
          body: `A viral ${viralReel.niche ?? viralReel.platform} reel has ${viralReel.adjustedScore.toFixed(0)}x velocity`,
          url: '/dashboard/viral',
          icon: '/icon.png',
        })
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        logger.info('Web push sent', { userId, viralReelId })
      } catch (err) {
        logger.warn('Web push failed', { userId, error: err })
      }
    }

    const resendKey = process.env.RESEND_API_KEY
    if (user.email && resendKey && resendKey !== 'not_configured_yet') {
      try {
        const baseUrl = process.env.NEXTAUTH_URL ?? 'https://pasteviral.ai'
        await resend.emails.send({
          from: 'PasteViral <noreply@pasteviral.ai>',
          to: user.email,
          subject: '🔥 A viral reel just matched your niche!',
          html: `
            <h2>Viral Spike Detected!</h2>
            <p>A new viral reel in your <strong>${viralReel.niche ?? viralReel.platform}</strong> niche
            has been detected with <strong>${viralReel.adjustedScore.toFixed(0)}x</strong> velocity score.</p>
            <p><a href="${baseUrl}/dashboard/viral">View it on PasteViral →</a></p>
          `,
        })
        logger.info('Email sent', { userId, viralReelId })
      } catch (err) {
        logger.warn('Email send failed', { userId, error: err })
      }
    }
  },
  {
    connection: pvQueue,
    concurrency: 20,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
)

worker.on('failed', async (job, err) => {
  if (!job) return
  const maxAttempts = job.opts.attempts ?? 3
  logger.error('Job failed', { jobId: job.id, error: err.message, attempt: job.attemptsMade })

  if (job.attemptsMade >= maxAttempts) {
    try {
      await prisma.failedJob.create({
        data: {
          queueName: QUEUE_NAME,
          jobId: job.id ?? 'unknown',
          payload: job.data as unknown as Prisma.InputJsonValue,
          errorMessage: err.message,
          retryCount: job.attemptsMade,
          userId: job.data.userId,
        },
      })
      logger.error('Job written to DLQ', { jobId: job.id, queue: QUEUE_NAME })
    } catch (dbErr) {
      logger.error('Failed to write to DLQ', { error: dbErr })
    }
  }
})

process.on('SIGTERM', async () => {
  await worker.close()
})

export default worker
