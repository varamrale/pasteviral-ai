import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_PATTERNS = [/^\/dashboard(\/.*)?$/, /^\/api\/reels(\/.*)?$/, /^\/api\/social(\/.*)?$/]

function isProtected(pathname: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(pathname))
}

export default auth(function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const session = (req as NextRequest & { auth?: { user?: { id?: string } } }).auth

  if (isProtected(pathname)) {
    if (!session?.user?.id) {
      const signInUrl = new URL('/auth/signin', req.url)
      signInUrl.searchParams.set('callbackUrl', req.url)
      return NextResponse.redirect(signInUrl)
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
