'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function VerifyEmailPage() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email')

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 px-4 py-12">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-900/40 border border-indigo-700">
          <svg
            className="h-8 w-8 text-indigo-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-white">Check your email</h1>
          {email ? (
            <p className="mt-2 text-sm text-gray-400">
              We sent a verification link to{' '}
              <span className="font-medium text-gray-300">{email}</span>.
            </p>
          ) : (
            <p className="mt-2 text-sm text-gray-400">
              A verification link has been sent to your email address.
            </p>
          )}
          <p className="mt-1 text-sm text-gray-500">
            Click the link in that email to activate your account.
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-gray-600">Didn&apos;t receive the email? Check your spam folder.</p>
          <Link
            href="/auth/signin"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-700 bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  )
}
