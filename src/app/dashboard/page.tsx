'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
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

interface SsePayload {
  status?: string
  videoUrl?: string | null
  processingStage?: string | null
  progress?: number
  error?: string
  createdAt?: string
}

type Phase = 'idle' | 'analysing' | 'submitting' | 'ready' | 'generating' | 'done' | 'error'
type GenerationMode = 'personal' | 'faceless'

const PLATFORM_LABELS: Record<string, string> = {
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  YOUTUBE: 'YouTube',
  TWITTER: 'Twitter / X',
}

const STAGE_LABELS: Record<string, string> = {
  generating: 'Generating video with AI…',
  uploading: 'Uploading to storage…',
  processing_face: 'Applying face swap…',
  processing_voice: 'Cloning voice…',
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-800 ${className ?? ''}`} />
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
      <div
        className="h-full rounded-full bg-indigo-500 transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}

function ModeSelector({
  mode,
  onChange,
  disabled,
}: {
  mode: GenerationMode
  onChange: (m: GenerationMode) => void
  disabled: boolean
}) {
  return (
    <div className="flex gap-2">
      {(['personal', 'faceless'] as GenerationMode[]).map((m) => (
        <button
          key={m}
          type="button"
          disabled={disabled}
          onClick={() => onChange(m)}
          className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition ${
            mode === m
              ? 'border-indigo-500 bg-indigo-600 text-white'
              : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-white'
          } disabled:opacity-50`}
        >
          {m === 'personal' ? '🎭 Personal (face + voice)' : '🤖 Faceless'}
        </button>
      ))}
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

function GeneratingCard({
  analyseResult,
  stage,
  progress,
}: {
  analyseResult: AnalyseResult
  stage: string | null
  progress: number
}) {
  const { metadata, platform } = analyseResult
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
          </div>
          {metadata.creator && (
            <p className="truncate text-sm font-medium text-white">@{metadata.creator}</p>
          )}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{stage ? (STAGE_LABELS[stage] ?? stage) : 'Queued…'}</span>
          <span>{progress}%</span>
        </div>
        <ProgressBar progress={progress} />
      </div>
    </div>
  )
}

function DoneCard({
  analyseResult,
  reelId,
  videoUrl,
}: {
  analyseResult: AnalyseResult
  reelId: string
  videoUrl: string | null | undefined
}) {
  const [copied, setCopied] = useState(false)
  const { metadata, platform } = analyseResult

  const copyLink = useCallback(async () => {
    if (!videoUrl) return
    await navigator.clipboard.writeText(videoUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [videoUrl])

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
            <span className="rounded-full bg-green-700 px-2.5 py-0.5 text-xs font-medium text-white">Done</span>
            <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-medium text-white">
              {PLATFORM_LABELS[platform] ?? platform}
            </span>
          </div>
          {metadata.creator && (
            <p className="truncate text-sm font-medium text-white">@{metadata.creator}</p>
          )}
        </div>
      </div>

      {videoUrl && (
        <div className="mt-4">
          <video
            src={videoUrl}
            controls
            playsInline
            className="w-full rounded-xl bg-black"
            style={{ maxHeight: '480px' }}
          />
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {videoUrl && (
          <button
            type="button"
            onClick={copyLink}
            className="flex-1 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-700 hover:text-white"
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        )}
        <a
          href={`/dashboard/reels/${reelId}`}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          View reel →
        </a>
      </div>
    </div>
  )
}

function ReadyCard({
  analyseResult,
  mode,
  onModeChange,
  onGenerate,
  isSubmitting,
}: {
  analyseResult: AnalyseResult
  mode: GenerationMode
  onModeChange: (m: GenerationMode) => void
  onGenerate: () => void
  isSubmitting: boolean
}) {
  const { metadata, platform, transcript } = analyseResult
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
            {analyseResult.cached && (
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

      {transcript && (
        <div className="mt-4 rounded-lg bg-gray-800 p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Transcript preview</p>
          <p className="line-clamp-3 text-sm text-gray-300">{transcript}</p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Generation mode</p>
        <ModeSelector mode={mode} onChange={onModeChange} disabled={isSubmitting} />
        <button
          type="button"
          onClick={onGenerate}
          disabled={isSubmitting}
          className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Queuing…' : 'Generate Reel →'}
        </button>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [analyseResult, setAnalyseResult] = useState<AnalyseResult | null>(null)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)
  const [generationMode, setGenerationMode] = useState<GenerationMode>('personal')
  const [sseProgress, setSseProgress] = useState(0)
  const [sseStage, setSseStage] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stopSse = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [])

  useEffect(() => () => stopSse(), [stopSse])

  const startSse = useCallback((reelId: string) => {
    stopSse()
    const controller = new AbortController()
    abortRef.current = controller

    void (async () => {
      try {
        const res = await fetch(`/api/reels/status/${reelId}`, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        })
        if (!res.ok || !res.body) return
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6)
            if (!raw.trim()) continue
            let data: SsePayload
            try {
              data = JSON.parse(raw) as SsePayload
            } catch {
              continue
            }
            if (data.error) {
              setError(data.error)
              setPhase('error')
              controller.abort()
              return
            }
            if (data.progress !== undefined) setSseProgress(data.progress)
            if (data.processingStage !== undefined) setSseStage(data.processingStage ?? null)
            if (data.videoUrl) setVideoUrl(data.videoUrl)
            if (data.status === 'COMPLETE') {
              setSseProgress(100)
              setPhase('done')
              controller.abort()
              return
            } else if (data.status === 'FAILED') {
              setError('Video generation failed. Please try again.')
              setPhase('error')
              controller.abort()
              return
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return
      }
    })()
  }, [stopSse])

  const handleAnalyse = useCallback(async () => {
    const trimmed = url.trim()
    if (!trimmed) return

    setError(null)
    setAnalyseResult(null)
    setSubmitResult(null)
    setVideoUrl(null)
    setSseProgress(0)
    setSseStage(null)
    stopSse()
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
      setPhase('ready')
    } catch {
      setError('Something went wrong. Please try again.')
      setPhase('error')
    }
  }, [url, stopSse])

  const handleGenerate = useCallback(async () => {
    if (!analyseResult) return
    const trimmed = url.trim()
    if (!trimmed) return

    setError(null)
    setPhase('submitting')

    try {
      const reelRes = await fetch('/api/reels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, generationMode }),
      })

      const reelData = await reelRes.json() as SubmitResult & { error?: string }
      if (!reelRes.ok) {
        setError(reelData.error ?? 'Failed to queue reel')
        setPhase('error')
        return
      }

      setSubmitResult(reelData)
      setSseProgress(5)
      setPhase('generating')
      startSse(reelData.reelId)
    } catch {
      setError('Something went wrong. Please try again.')
      setPhase('error')
    }
  }, [analyseResult, url, generationMode, startSse])

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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleAnalyse()
          }}
          placeholder="https://www.tiktok.com/@creator/video/..."
          rows={3}
          disabled={isLoading || phase === 'generating'}
          className="w-full resize-none rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          onClick={handleAnalyse}
          disabled={isLoading || !url.trim() || phase === 'generating'}
          className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === 'analysing' ? 'Analysing…' : 'Analyse Reel'}
        </button>
      </div>

      {phase === 'error' && error && (
        <div className="mt-4 rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {phase === 'analysing' && <AnalysingState />}

      {phase === 'ready' && analyseResult && (
        <ReadyCard
          analyseResult={analyseResult}
          mode={generationMode}
          onModeChange={setGenerationMode}
          onGenerate={handleGenerate}
          isSubmitting={false}
        />
      )}

      {phase === 'submitting' && analyseResult && (
        <ReadyCard
          analyseResult={analyseResult}
          mode={generationMode}
          onModeChange={setGenerationMode}
          onGenerate={handleGenerate}
          isSubmitting={true}
        />
      )}

      {phase === 'generating' && analyseResult && (
        <GeneratingCard
          analyseResult={analyseResult}
          stage={sseStage}
          progress={sseProgress}
        />
      )}

      {phase === 'done' && analyseResult && submitResult && (
        <DoneCard
          analyseResult={analyseResult}
          reelId={submitResult.reelId}
          videoUrl={videoUrl}
        />
      )}
    </main>
  )
}
