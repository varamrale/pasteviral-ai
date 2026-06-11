import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateSignedUrl } from '@/lib/r2-client'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { facePhotoUrl: true },
  })

  if (!user?.facePhotoUrl) {
    return NextResponse.json({ error: 'No face photo on file' }, { status: 404 })
  }

  const signedUrl = await generateSignedUrl(user.facePhotoUrl)
  return NextResponse.json({ signedUrl })
}
