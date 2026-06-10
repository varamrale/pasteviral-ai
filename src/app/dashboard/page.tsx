'use client'

import { useState, useCallback } from 'react'
import Image from 'next/image'

interface AnalyseResult {
  platform: string
  transcript: string | null
  metadata: {
    thumbnail?: string
    views?: number
    creator?: string
    title?: string
    [key: string]: unknown
  }
  cached: boolean
}

interface SubmitResult {
  reelId: string
  jobId: string | undefined
}

type Phase = 'idle' | 'analysing' | 'submitting' | 'done' | 'error'

const PLATFORM_LABELS: Record<string, string> = {
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  YOUTUBE: 'YouTube',
  TWITTER: 'Twitter / X',
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-800 ${className ?? ''}`} />
}

function ResultCard({ result, reelId }: { result: AnalyseResult; reelId: string }) {
  const { metadata, platform } = result
  return (
    <div className="mt-8 rounded-2xl border border-gray-700 bg-gray-900 p-6">
      <div className="flex items-start gap-4">
        {metadata.thumbnail ? (
          <Image
            src={metadata.thumbnail}
            alt="Reel thumbnail"
            width={64}
            height={96}
            className="h-24 w-16 flex-shrink-0 rounded-lg object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-24 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-gray-800 text-2xl">
            {platform === 'TIKTOK' ? '🎵' : platform === 'INSTAGRAM' ? '📷' : platform === 'YOUTUBE' ? '▶️' : '🐦'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-medium text-white">
              {PLATFORM_LABELS[platform] ?? platform}
            </span>
            {result.cached && (
              <span className="rounded-full bg-gray-700 px-2.5 py-0.5 text-xs text-gray-400">cached</span>
            )}
          </div>
          {metadata.creator && (
            <p className="truncate text-sm font-medium text-white">@{metadata.creator}</p>
          )}
          {metadata.title && (
            <p className="mt-0.5 line-clamp-2 text-sm text-gray-400">{metadata.title}</p>
          )}
          {typeof metadata.views === 'number' && (
            <p className="mt-1 text-xs text-gray-500">
              {new Intl.NumberFormat().format(metadata.views)} views
            </p>
          )}
        </div>
      </div>

      {result.transcript && (
        <div className="mt-4 rounded-lg bg-gray-800 p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Transcript preview</p>
          <p className="line-clamp-3 text-sm text-gray-300">{result.transcript}</p>
        </div>
      )}

      <div className="mt-4 rounded-lg bg-indigo-950 px-4 py-3">
        <p className="text-sm text-indigo-300">
          <span className="font-semibold text-indigo-200">Reel queued</span> — your video is being generated.{' '}
          <a href={`/dashboard/reels/${reelId}`} className="underline hover:text-white">
            Track progress →
          </a>
        </p>
      </div>
    </div>
  )
}

function AnalysingState() {
  return (
    <div className="mt-8 rounded-2xl border border-gray-700 bg-gray-900 p-6">
      <div className="flex items-start gap-4">
        <Skeleton className="h-24 w-16 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <Skeleton className="mt-4 h-16 w-full" />
      <p className="mt-3 text-center text-sm text-gray-500">Analysing reel…</p>
    </div>
  )
}

export default function DashboardPage() {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [analyseResult, setAnalyseResult] = useState<AnalyseResult | null>(null)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)

  const handleSubmit = useCallback(async () => {
    const trimmed = url.trim()
    if (!trimmed) return

    setError(null)
    setAnalyseResult(null)
    setSubmitResult(null)
    setPhase('analysing')

    try {
      const analyseRes = await fetch('/api/reels/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })

      const analyseData = await analyseRes.json() as AnalyseResult & { error?: string }
      if (!analyseRes.ok) {
        setError(analyseData.error ?? 'Failed to analyse URL')
        setPhase('error')
        return
      }

      setAnalyseResult(analyseData)
      setPhase('submitting')

      const reelRes = await fetch('/api/reels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })

      const reelData = await reelRes.json() as SubmitResult & { error?: string }
      if (!reelRes.ok) {
        setError(reelData.error ?? 'Failed to queue reel')
        setPhase('error')
        return
      }

      setSubmitResult(reelData)
      setPhase('done')
    } catch {
      setError('Something went wrong. Please try again.')
      setPhase('error')
    }
  }, [url])

  const isLoading = phase === 'analysing' || phase === 'submitting'

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-3xl font-bold text-white">Create a Viral Reel</h1>
      <p className="mb-8 text-gray-400">Paste a TikTok, Instagram, YouTube, or Twitter/X URL to get started.</p>

      <div className="space-y-3">
        <textarea
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
          }}
          placeholder="https://www.tiktok.com/@creator/video/..."
          rows={3}
          disabled={isLoading}
          className="w-full resize-none rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={isLoading || !url.trim()}
          className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === 'analysing'
            ? 'Analysing…'
            : phase === 'submitting'
              ? 'Queuing reel…'
              : 'Analyse Reel'}
        </button>
      </div>

      {phase === 'error' && error && (
        <div className="mt-4 rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {(phase === 'analysing' || phase === 'submitting') && <AnalysingState />}

      {phase === 'done' && analyseResult && submitResult && (
        <ResultCard result={analyseResult} reelId={submitResult.reelId} />
      )}
    </main>
  )
}
