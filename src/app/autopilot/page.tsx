'use client'

import { useState, useEffect } from 'react'

type RecentPost = {
  id: string
  sourcePlatform: string
  sourceUrl: string
  postedAt: string | null
  views24h: number | null
}

type AutopilotStatus = {
  autoMode: boolean
  autoModeFrequency: number
  autoModePaused: boolean
  recentPosts: RecentPost[]
}

const FREQUENCY_OPTIONS = [
  { value: 1, label: '1 / day', description: 'Daily at peak time' },
  { value: 3, label: '3 / day', description: 'Morning, afternoon, evening' },
  { value: 5, label: '5 / day', description: 'Every ~5 hours' },
]

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function AutopilotPage() {
  const [status, setStatus] = useState<AutopilotStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function fetchStatus() {
    try {
      const res = await fetch('/api/autopilot')
      const data = (await res.json()) as AutopilotStatus & { error?: string }
      if (data.error) {
        setError(data.error)
        return
      }
      setStatus(data)
    } catch {
      setError('Failed to load autopilot status')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchStatus()
  }, [])

  async function patch(payload: Partial<Pick<AutopilotStatus, 'autoMode' | 'autoModeFrequency' | 'autoModePaused'>>) {
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Update failed')
        return
      }
      setStatus((prev) => (prev ? { ...prev, ...payload } : prev))
    } catch {
      setError('Update failed — please try again')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white px-4 py-12">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="h-8 w-48 rounded-lg bg-zinc-900 animate-pulse" />
          <div className="h-4 w-72 rounded bg-zinc-900 animate-pulse" />
          <div className="h-40 rounded-2xl bg-zinc-900 animate-pulse" />
          <div className="h-32 rounded-2xl bg-zinc-900 animate-pulse" />
        </div>
      </main>
    )
  }

  if (!status) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white px-4 py-12">
        <div className="max-w-2xl mx-auto">
          <p className="text-zinc-400 text-sm">{error ?? 'Unable to load autopilot.'}</p>
        </div>
      </main>
    )
  }

  const isPaused = status.autoModePaused
  const isOn = status.autoMode

  return (
    <main className="min-h-screen bg-zinc-950 text-white px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Autopilot</h1>
          <p className="text-zinc-400 text-sm">
            Automatically find and post trending reels on your connected accounts.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Auto-post mode</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {isOn
                  ? isPaused
                    ? 'Paused — no posts until resumed'
                    : 'Active — posting automatically'
                  : 'Off — no automatic posts'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void patch({ autoMode: !isOn, ...(isOn ? {} : { autoModePaused: false }) })}
              disabled={isSaving}
              aria-pressed={isOn}
              className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                isOn ? 'border-violet-600 bg-violet-600' : 'border-zinc-700 bg-zinc-800'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                  isOn ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {isOn && (
            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void patch({ autoModePaused: !isPaused })}
                disabled={isSaving}
                className={`rounded-lg px-4 py-2 text-xs font-medium transition min-h-[44px] disabled:cursor-not-allowed disabled:opacity-50 ${
                  isPaused
                    ? 'border border-violet-500/40 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20'
                    : 'border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'
                }`}
              >
                {isPaused ? 'Resume autopilot' : 'Pause autopilot'}
              </button>
              {isSaving && <span className="text-xs text-zinc-500">Saving…</span>}
            </div>
          )}
        </div>

        {isOn && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <p className="text-sm font-medium text-white mb-1">Posting frequency</p>
            <p className="text-xs text-zinc-500 mb-5">How many reels to post per day on each connected account.</p>
            <div className="grid grid-cols-3 gap-3">
              {FREQUENCY_OPTIONS.map((opt) => {
                const isSelected = status.autoModeFrequency === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => void patch({ autoModeFrequency: opt.value })}
                    disabled={isSaving}
                    className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] ${
                      isSelected
                        ? 'border-violet-500 bg-violet-500/10'
                        : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    <span className={`block text-sm font-semibold ${isSelected ? 'text-violet-400' : 'text-zinc-300'}`}>
                      {opt.label}
                    </span>
                    <span className="block text-xs text-zinc-500 mt-1">{opt.description}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <p className="text-sm font-medium text-white mb-4">Recent auto-posts</p>
          {status.recentPosts.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4 text-center">
              No auto-posts yet.{' '}
              {!isOn && 'Enable auto-post mode above to get started.'}
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {status.recentPosts.map((post) => (
                <li key={post.id} className="flex items-center gap-4 py-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-xs font-medium text-zinc-400 uppercase">
                    {post.sourcePlatform.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-zinc-300">{post.sourceUrl}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {post.postedAt ? formatRelativeTime(post.postedAt) : '—'}
                      {post.views24h != null && ` · ${post.views24h.toLocaleString()} views`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
