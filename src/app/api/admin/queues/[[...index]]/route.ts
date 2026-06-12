import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createBullBoardApp } from '@/lib/bull-board'

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean),
)

const app = createBullBoardApp()

async function withAdminAuth(request: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email || !ADMIN_EMAILS.has(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return app.fetch(request)
}

export const GET = withAdminAuth
export const POST = withAdminAuth
