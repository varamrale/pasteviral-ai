'use client'

import { useState, useEffect } from 'react'

type Platform = {
  id: string
  label: string
  slug: string
  connected: boolean
}

type AccountsResponse = {
  platforms: Platform[]
  hasProfile: boolean
  error?: string
}

const PLATFORM_ICONS: Record<string, string> = {
  INSTAGRAM: 'IG',
  TIKTOK: 'TK',
  YOUTUBE: 'YT',
}

export default function AccountsPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [hasProfile, setHasProfile] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/social/accounts')
      const data = (await res.json()) as AccountsResponse
      if (data.error) {
        setError(data.error)
        return
      }
      setPlatforms(data.platforms)
      setHasProfile(data.hasProfile)
    } catch {
      setError('Failed to load connected accounts')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchAccounts()
  }, [])

  async function handleConnect(platformId: string) {
    setActionLoading(platformId)
    setError(null)
    try {
      const res = await fetch('/api/social/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformId }),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Connection failed')
        return
      }
      // Refresh list after connecting
      await fetchAccounts()
    } catch {
      setError('Connection request failed')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDisconnect() {
    setActionLoading('disconnect')
    setError(null)
    try {
      const res = await fetch('/api/social/connect', { method: 'DELETE' })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Disconnect failed')
        return
      }
      await fetchAccounts()
    } catch {
      setError('Disconnect request failed')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Connected Accounts</h1>
        <p className="text-zinc-400 text-sm mb-8">
          Link your social platforms to enable auto-posting after content is generated.
        </p>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-2xl bg-zinc-900 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {platforms.map((platform) => (
              <div
                key={platform.id}
                className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-4"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-xs font-bold text-zinc-300">
                    {PLATFORM_ICONS[platform.id] ?? '??'}
                  </div>
                  <div>
                    <p className="font-medium text-white">{platform.label}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span
                        className={`h-2 w-2 rounded-full ${platform.connected ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                      />
                      <span className="text-xs text-zinc-400">
                        {platform.connected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {platform.connected ? (
                    <button
                      type="button"
                      onClick={() => void handleDisconnect()}
                      disabled={actionLoading !== null}
                      className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {actionLoading === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleConnect(platform.id)}
                      disabled={actionLoading !== null}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {actionLoading === platform.id ? 'Connecting…' : 'Connect'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {hasProfile && (
          <p className="mt-6 text-center text-xs text-zinc-600">
            Your Ayrshare profile is active. Connected accounts will be used for auto-posting.
          </p>
        )}
      </div>
    </main>
  )
}
