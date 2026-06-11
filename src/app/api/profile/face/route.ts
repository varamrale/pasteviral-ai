import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  uploadToR2,
  deleteFromR2,
  listR2ObjectsByPrefix,
  generateSignedUrl,
} from '@/lib/r2-client'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const CONSENT_VERSION = '1.0'
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png'])

function hasMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  }
  return false
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true, facePhotoUrl: true, faceConsentAt: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  let signedUrl: string | null = null
  if (user.facePhotoUrl) {
    signedUrl = await generateSignedUrl(user.facePhotoUrl)
  }

  return NextResponse.json({
    plan: user.plan,
    hasFacePhoto: !!user.facePhotoUrl,
    signedUrl,
    consentDate: user.faceConsentAt?.toISOString() ?? null,
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

  const consentAccepted = formData.get('consentAccepted')
  if (consentAccepted !== 'true') {
    return NextResponse.json({ error: 'Consent required before uploading' }, { status: 400 })
  }

  const photo = formData.get('photo')
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: 'photo is required' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(photo.type)) {
    return NextResponse.json(
      { error: 'Only JPEG and PNG files are accepted' },
      { status: 400 },
    )
  }

  if (photo.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 })
  }

  const timestamp = Date.now()
  const r2Key = `users/${userId}/face-${timestamp}.jpg`

  const buffer = Buffer.from(await photo.arrayBuffer())
  if (!hasMagicBytes(buffer, photo.type)) {
    return NextResponse.json({ error: 'File content does not match declared type' }, { status: 400 })
  }
  const signedUrl = await uploadToR2(buffer, r2Key, photo.type)

  await prisma.user.update({
    where: { id: userId },
    data: {
      facePhotoUrl: r2Key,
      faceConsentAt: new Date(),
      faceConsentVersion: CONSENT_VERSION,
    },
  })

  return NextResponse.json({ success: true, facePhotoUrl: signedUrl })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const keys = await listR2ObjectsByPrefix(`users/${userId}/face-`)
  await Promise.all(keys.map((key) => deleteFromR2(key)))

  await prisma.user.update({
    where: { id: userId },
    data: { facePhotoUrl: null, faceConsentAt: null },
  })

  return NextResponse.json({ success: true })
}
