import NextAuth from 'next-auth'
import { authConfig } from '@/auth.config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_PATTERNS = [/^\/dashboard(\/.*)?$/, /^\/api\/reels(\/.*)?$/, /^\/api\/social(\/.*)?$/]
const ADMIN_PATTERNS = [/^\/api\/admin(\/.*)?$/, /^\/admin(\/.*)?$/]

type SessionRequest = NextRequest & { auth?: { user?: { id?: string; email?: string } } }

function isProtected(pathname: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(pathname))
}

function isAdminRoute(pathname: string): boolean {
  return ADMIN_PATTERNS.some((p) => p.test(pathname))
}

const { auth } = NextAuth(authConfig)

export default auth(function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const session = (req as SessionRequest).auth

  if (isAdminRoute(pathname)) {
    if (!session?.user?.id) {
      const signInUrl = new URL('/auth/signin', req.url)
      signInUrl.searchParams.set('callbackUrl', req.url)
      return NextResponse.redirect(signInUrl)
    }
    const adminEmails = new Set(
      (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean),
    )
    if (!session.user.email || !adminEmails.has(session.user.email)) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  if (isProtected(pathname) && !session?.user?.id) {
    const signInUrl = new URL('/auth/signin', req.url)
    signInUrl.searchParams.set('callbackUrl', req.url)
    return NextResponse.redirect(signInUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
