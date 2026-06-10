'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface HookVariant {
  type: string
  hook: string
  retentionBoost: number
  openingWords: string
}

interface ScriptData {
  upgradedScript: string
  similarityScore: number
  hooks: HookVariant[]
  topic: string
  angle: string
}

const HOOK_TYPE_LABELS: Record<string, string> = {
  curiosity: 'Curiosity',
  shock_stat: 'Shock Stat',
  question: 'Question',
  problem_agitate: 'Problem Agitate',
  outcome_first: 'Outcome First',
}

const HOOK_COLORS: Record<string, string> = {
  curiosity: 'from-purple-600 to-indigo-600',
  shock_stat: 'from-red-600 to-orange-600',
  question: 'from-blue-600 to-cyan-600',
  problem_agitate: 'from-orange-600 to-yellow-600',
  outcome_first: 'from-green-600 to-emerald-600',
}

function SimilarityBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color =
    pct <= 40 ? 'bg-green-900 text-green-300' :
    pct <= 60 ? 'bg-yellow-900 text-yellow-300' :
                'bg-red-900 text-red-300'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {pct}% similar to original
    </span>
  )
}

function SkeletonBlock({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-gray-800" style={{ width: `${60 + (i % 4) * 10}%` }} />
      ))}
    </div>
  )
}

function HookCard({
  hook,
  selected,
  onSelect,
}: {
  hook: HookVariant
  selected: boolean
  onSelect: () => void
}) {
  const gradient = HOOK_COLORS[hook.type] ?? 'from-gray-600 to-gray-500'
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-all ${
        selected
          ? 'border-indigo-500 bg-indigo-950 ring-1 ring-indigo-500'
          : 'border-gray-700 bg-gray-900 hover:border-gray-500'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`rounded-full bg-gradient-to-r px-2.5 py-0.5 text-xs font-semibold text-white ${gradient}`}>
          {HOOK_TYPE_LABELS[hook.type] ?? hook.type}
        </span>
        <span className="text-xs font-medium text-emerald-400">+{hook.retentionBoost}% retention</span>
      </div>
      <p className="text-sm text-gray-300">{hook.openingWords}{hook.openingWords.split(' ').length >= 20 ? '…' : ''}</p>
    </button>
  )
}

function GeneratePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const reelId = searchParams.get('reelId') ?? ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ScriptData | null>(null)
  const [editedScript, setEditedScript] = useState('')
  const [selectedHookIdx, setSelectedHookIdx] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!reelId) {
      setError('No reel ID provided.')
      setLoading(false)
      return
    }

    fetch('/api/reels/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reelId }),
    })
      .then(async (res) => {
        const json = await res.json() as ScriptData & { error?: string }
        if (!res.ok) throw new Error(json.error ?? 'Failed to generate script')
        return json
      })
      .then((json) => {
        setData(json)
        setEditedScript(json.upgradedScript)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setLoading(false)
      })
  }, [reelId])

  const handleContinue = useCallback(async () => {
    if (!data || !reelId) return
    setSaving(true)
    try {
      const selectedHook = data.hooks[selectedHookIdx]
      await fetch('/api/reels/script', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reelId,
          selectedHook: selectedHook?.hook ?? '',
          hookType: selectedHook?.type ?? '',
          upgradedScript: editedScript,
        }),
      })
      router.push(`/dashboard/reels/${reelId}`)
    } catch {
      setSaving(false)
    }
  }, [data, reelId, selectedHookIdx, editedScript, router])

  if (!reelId) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <p className="text-red-400">No reel ID provided. Go back to the dashboard.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Step 2 — Review &amp; Pick Your Hook</h1>
          {data && (
            <p className="mt-1 text-sm text-gray-400">
              Topic: <span className="text-gray-200">{data.topic}</span>
              {data.angle && (
                <> · Angle: <span className="text-gray-200">{data.angle}</span></>
              )}
            </p>
          )}
        </div>
        {data && <SimilarityBadge score={data.similarityScore} />}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Side-by-side scripts */}
      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-700 bg-gray-900 p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Original Transcript</h2>
          {loading ? (
            <SkeletonBlock rows={8} />
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-400">
              {/* original transcript not returned by API — show placeholder */}
              {data ? 'Original transcript from reel source.' : '—'}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-gray-700 bg-gray-900 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Upgraded Script
            <span className="rounded bg-indigo-900 px-1.5 py-0.5 text-xs font-medium text-indigo-300 normal-case tracking-normal">editable</span>
          </h2>
          {loading ? (
            <SkeletonBlock rows={8} />
          ) : (
            <textarea
              value={editedScript}
              onChange={(e) => setEditedScript(e.target.value)}
              rows={12}
              className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm leading-relaxed text-gray-200 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          )}
        </div>
      </div>

      {/* Hook cards */}
      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-white">Choose Your Opening Hook</h2>
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-800" />
            ))}
          </div>
        ) : data && data.hooks.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.hooks.map((hook, i) => (
              <HookCard
                key={hook.type}
                hook={hook}
                selected={selectedHookIdx === i}
                onSelect={() => setSelectedHookIdx(i)}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No hooks generated.</p>
        )}
      </div>

      {/* Selected hook preview */}
      {data && data.hooks[selectedHookIdx] && (
        <div className="mb-8 rounded-xl border border-indigo-700 bg-indigo-950 p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-400">Selected hook</p>
          <p className="text-sm text-indigo-100">{data.hooks[selectedHookIdx].hook}</p>
        </div>
      )}

      <button
        onClick={handleContinue}
        disabled={saving || loading || !data}
        className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Continue →'}
      </button>
    </main>
  )
}

export default function GeneratePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen bg-gray-950" />}>
      <GeneratePageContent />
    </Suspense>
  )
}
