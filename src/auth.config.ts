import type { NextAuthConfig } from 'next-auth'

const PLACEHOLDER = 'not_configured_yet'

export const googleConfigured =
  !!process.env.GOOGLE_CLIENT_ID &&
  !!process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_CLIENT_ID !== PLACEHOLDER &&
  process.env.GOOGLE_CLIENT_SECRET !== PLACEHOLDER

export const resendConfigured =
  !!process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== PLACEHOLDER

export const authConfig = {
  providers: [],
  pages: {
    signIn: '/auth/signin',
    error: '/auth/signin',
  },
  session: { strategy: 'jwt' as const },
  cookies: {
    sessionToken: {
      name: 'next-auth.session-token',
      options: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict' as const,
        path: '/',
      },
    },
  },
} satisfies NextAuthConfig
