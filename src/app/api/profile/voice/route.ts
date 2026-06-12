import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadToR2, deleteFromR2, listR2ObjectsByPrefix } from '@/lib/r2-client'
import { logger } from '@/lib/logger'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['audio/wav', 'audio/mpeg', 'audio/webm'])
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'

function hasMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'audio/wav') {
    return buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
  }
  if (mimeType === 'audio/mpeg') {
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return true
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return true
    return false
  }
  // audio/webm — no strict magic bytes check
  return true
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true, elevenLabsVoiceId: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    plan: user.plan,
    hasVoiceClone: !!user.elevenLabsVoiceId,
  })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const recording = formData.get('recording')
  if (!(recording instanceof File)) {
    return NextResponse.json({ error: 'recording field is required' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(recording.type)) {
    return NextResponse.json(
      { error: 'Only WAV, MP3, and WebM audio files are accepted' },
      { status: 400 },
    )
  }

  if (recording.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 })
  }

  const buffer = Buffer.from(await recording.arrayBuffer())

  if (!hasMagicBytes(buffer, recording.type)) {
    return NextResponse.json(
      { error: 'File content does not match declared audio type' },
      { status: 400 },
    )
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey || apiKey === 'not_configured_yet') {
    return NextResponse.json({ error: 'Voice clone service is not configured' }, { status: 503 })
  }

  const timestamp = Date.now()
  const r2Key = `users/${userId}/voice-${timestamp}.wav`
  await uploadToR2(buffer, r2Key, recording.type)

  const ivcFormData = new FormData()
  ivcFormData.append('name', userId)
  ivcFormData.append(
    'files',
    new Blob([buffer], { type: recording.type }),
    `voice-${timestamp}.wav`,
  )

  const ivcRes = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: ivcFormData,
  })

  if (!ivcRes.ok) {
    const body = await ivcRes.text()
    logger.error('ElevenLabs IVC failed', { userId, status: ivcRes.status })
    await deleteFromR2(r2Key).catch(() => undefined)
    logger.warn('IVC error detail', { body: body.slice(0, 200) })
    return NextResponse.json({ error: 'Voice clone creation failed' }, { status: 502 })
  }

  const ivcData = (await ivcRes.json()) as { voice_id: string }

  await prisma.user.update({
    where: { id: userId },
    data: {
      elevenLabsVoiceId: ivcData.voice_id,
      voiceRecordingUrl: r2Key,
    },
  })

  logger.info('Voice clone created', { userId })

  return NextResponse.json({ success: true })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { elevenLabsVoiceId: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (user.elevenLabsVoiceId && apiKey && apiKey !== 'not_configured_yet') {
    const delRes = await fetch(`${ELEVENLABS_BASE}/voices/${user.elevenLabsVoiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': apiKey },
    })
    if (!delRes.ok) {
      logger.warn('ElevenLabs voice delete returned non-OK', { userId, status: delRes.status })
    }
  }

  const keys = await listR2ObjectsByPrefix(`users/${userId}/voice-`)
  await Promise.all(keys.map((key) => deleteFromR2(key)))

  await prisma.user.update({
    where: { id: userId },
    data: {
      elevenLabsVoiceId: null,
      voiceRecordingUrl: null,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'VOICE_RECORDING_DELETED',
      metadata: { reason: 'user_requested_deletion' },
    },
  })

  logger.info('Voice clone deleted (GDPR)', { userId })

  return NextResponse.json({ success: true })
}
