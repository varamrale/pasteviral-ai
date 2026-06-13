'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

// --- Types ---
type UserData = { plan: string; creditsRemaining: number; earnedCredits: number }
type HookStat = { hookType: string; avgViewsAchieved: number } | null
type TrendingReel = {
  id: string
  platform: string
  reelUrl: string
  creatorHandle: string | null
  viewCount: number
  velocityScore: number
  hookType: string | null
  niche: string | null
  thumbnailUrl: string | null
}
type AnalyseResult = {
  platform: string
  transcript: string | null
  metadata: { thumbnail?: string; views?: number; creator?: string; title?: string; [key: string]: unknown }
  cached: boolean
}
type SubmitResult = { reelId: string; jobId: string | undefined }
type SsePayload = {
  status?: string
  videoUrl?: string | null
  processingStage?: string | null
  progress?: number
  error?: string
}
type Phase = 'idle' | 'analysing' | 'submitting' | 'ready' | 'generating' | 'done' | 'error'
type GenerationMode = 'personal' | 'faceless' | 'reference'

// --- Constants ---
const PLAN_CREDITS: Record<string, number> = { FREE: 3, STARTER: 50, CREATOR: 200, AGENCY: 500 }
const PLAN_CHIP: Record<string, string> = {
  FREE: 'bg-gray-700 text-gray-300',
  STARTER: 'bg-blue-800/60 text-blue-300',
  CREATOR: 'bg-purple-800/60 text-purple-300',
  AGENCY: 'bg-amber-700/60 text-amber-300',
}
const PLATFORM_LABELS: Record<string, string> = {
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  YOUTUBE: 'YouTube',
  TWITTER: 'Twitter / X',
}
const STAGE_LABELS: Record<string, string> = {
  generating: 'Generating video…',
  uploading: 'Uploading to storage…',
  processing_face: 'Applying face swap…',
  processing_voice: 'Cloning voice…',
}
const STAGE_PROGRESS: Record<string, number> = {
  generating: 20,
  uploading: 60,
  processing_face: 75,
  processing_voice: 85,
}
const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: '⚡' },
  { href: '/dashboard/autopilot', label: 'Autopilot', icon: '🤖' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
  { href: '/pricing', label: 'Pricing', icon: '💎' },
]

// --- Utilities ---
function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// --- Small presentational components ---
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

function CreditRing({ remaining, total }: { remaining: number; total: number }) {
  const r = 36
  const circ = 2 * Math.PI * r
  const pct = total > 0 ? Math.min(remaining / total, 1) : 0
  const dash = circ * pct
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#1f2937" strokeWidth="8" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke="#6366f1" strokeWidth="8"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
        />
        <text
          x="44" y="44"
          textAnchor="middle" dy="0.35em"
          fill="white" fontSize="16" fontWeight="bold"
        >
          {remaining}
        </text>
      </svg>
      <p className="text-xs text-gray-400">{remaining} / {total} credits</p>
    </div>
  )
}

function ThumbnailFallback({ platform }: { platform: string }) {
  const emoji =
    platform === 'TIKTOK' ? '🎵'
    : platform === 'INSTAGRAM' ? '📷'
    : platform === 'YOUTUBE' ? '▶️'
    : '🐦'
  return (
    <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-2xl">
      {emoji}
    </div>
  )
}

function ModeSelector({
  mode, onChange, disabled,
}: { mode: GenerationMode; onChange: (m: GenerationMode) => void; disabled: boolean }) {
  const modes: { value: GenerationMode; label: string; desc: string }[] = [
    { value: 'personal', label: '🎭 Personal', desc: 'Your face & voice' },
    { value: 'faceless', label: '🤖 Faceless', desc: 'AI voiceover only' },
    { value: 'reference', label: '🎬 Reference', desc: 'Style transfer' },
  ]
  return (
    <div className="flex gap-2">
      {modes.map((m) => (
        <button
          key={m.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(m.value)}
          className={`flex-1 rounded-lg border px-2 py-2 text-center transition disabled:opacity-50 ${
            mode === m.value
              ? 'border-indigo-500 bg-indigo-600/20 text-white'
              : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-white'
          }`}
        >
          <div className="text-xs font-medium">{m.label}</div>
          <div className="mt-0.5 text-[10px] opacity-60">{m.desc}</div>
        </button>
      ))}
    </div>
  )
}

function AnalysingState() {
  return (
    <div className="mt-6 rounded-2xl border border-gray-700 bg-gray-900 p-6">
      <div className="flex items-start gap-4">
        <Skeleton className="h-24 w-16 shrink-0" />
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
  analyseResult, stage, progress,
}: { analyseResult: AnalyseResult; stage: string | null; progress: number }) {
  const { metadata, platform } = analyseResult
  const displayProgress = stage ? (STAGE_PROGRESS[stage] ?? progress) : progress
  return (
    <div className="mt-6 rounded-2xl border border-gray-700 bg-gray-900 p-6">
      <div className="flex items-start gap-4">
        {metadata.thumbnail
          ? <Image src={metadata.thumbnail} alt="thumbnail" width={64} height={96}
              className="h-24 w-16 shrink-0 rounded-lg object-cover" unoptimized />
          : <ThumbnailFallback platform={platform} />}
        <div className="min-w-0 flex-1">
          <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-medium text-white">
            {PLATFORM_LABELS[platform] ?? platform}
          </span>
          {metadata.creator && (
            <p className="mt-1 truncate text-sm font-medium text-white">@{metadata.creator}</p>
          )}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{stage ? (STAGE_LABELS[stage] ?? stage) : 'Queued…'}</span>
          <span>{displayProgress}%</span>
        </div>
        <ProgressBar progress={displayProgress} />
        <div className="flex justify-between text-[10px] text-gray-600">
          {['queued', 'generating', 'uploading', 'posting', 'complete'].map((s) => (
            <span key={s} className="capitalize">{s}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function DoneCard({
  analyseResult, reelId, videoUrl,
}: { analyseResult: AnalyseResult; reelId: string; videoUrl: string | null | undefined }) {
  const [copied, setCopied] = useState(false)
  const { metadata, platform } = analyseResult
  const copyLink = useCallback(async () => {
    if (!videoUrl) return
    await navigator.clipboard.writeText(videoUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [videoUrl])
  return (
    <div className="mt-6 rounded-2xl border border-gray-700 bg-gray-900 p-6">
      <div className="flex items-start gap-4">
        {metadata.thumbnail
          ? <Image src={metadata.thumbnail} alt="" width={64} height={96}
              className="h-24 w-16 shrink-0 rounded-lg object-cover" unoptimized />
          : <ThumbnailFallback platform={platform} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-green-700 px-2.5 py-0.5 text-xs font-medium text-white">Done ✓</span>
            <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-medium text-white">
              {PLATFORM_LABELS[platform] ?? platform}
            </span>
          </div>
          {metadata.creator && (
            <p className="mt-1 truncate text-sm font-medium text-white">@{metadata.creator}</p>
          )}
        </div>
      </div>
      {videoUrl && (
        <div className="mt-4">
          <video
            src={videoUrl} controls playsInline
            className="w-full rounded-xl bg-black"
            style={{ maxHeight: '480px' }}
          />
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {videoUrl && (
          <button
            type="button"
            onClick={() => void copyLink()}
            className="flex-1 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition"
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        )}
        <a
          href={`/dashboard/reels/${reelId}`}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-500 transition"
        >
          View reel →
        </a>
      </div>
    </div>
  )
}

function ReadyCard({
  analyseResult, mode, onModeChange, onGenerate, isSubmitting,
}: {
  analyseResult: AnalyseResult
  mode: GenerationMode
  onModeChange: (m: GenerationMode) => void
  onGenerate: () => void
  isSubmitting: boolean
}) {
  const { metadata, platform, transcript } = analyseResult
  return (
    <div className="mt-6 rounded-2xl border border-gray-700 bg-gray-900 p-6">
      <div className="flex items-start gap-4">
        {metadata.thumbnail
          ? <Image src={metadata.thumbnail} alt="" width={64} height={96}
              className="h-24 w-16 shrink-0 rounded-lg object-cover" unoptimized />
          : <ThumbnailFallback platform={platform} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-medium text-white">
              {PLATFORM_LABELS[platform] ?? platform}
            </span>
            {analyseResult.cached && (
              <span className="rounded-full bg-gray-700 px-2.5 py-0.5 text-xs text-gray-400">cached</span>
            )}
          </div>
          {metadata.creator && (
            <p className="mt-1 truncate text-sm font-medium text-white">@{metadata.creator}</p>
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
          type="button" onClick={onGenerate} disabled={isSubmitting}
          className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 transition"
        >
          {isSubmitting ? 'Queuing…' : 'Generate Reel →'}
        </button>
      </div>
    </div>
  )
}

function TrendingCard({ reel, onUse }: { reel: TrendingReel; onUse: (url: string) => void }) {
  return (
    <div className="rounded-2xl border border-gray-700 bg-gray-900 p-4 flex gap-3">
      {reel.thumbnailUrl
        ? <Image src={reel.thumbnailUrl} alt="" width={56} height={84}
            className="h-24 w-14 shrink-0 rounded-lg object-cover" unoptimized />
        : <ThumbnailFallback platform={reel.platform} />}
      <div className="min-w-0 flex-1">
        {reel.creatorHandle && (
          <p className="text-sm font-medium text-white truncate">@{reel.creatorHandle}</p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">{formatViews(reel.viewCount)} views</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {reel.velocityScore > 1 && (
            <span className="rounded-full bg-amber-800/60 px-2 py-0.5 text-xs text-amber-300">
              {Math.round(reel.velocityScore)}× faster
            </span>
          )}
          {reel.hookType && (
            <span className="rounded-full bg-purple-800/60 px-2 py-0.5 text-xs text-purple-300">
              {reel.hookType}
            </span>
          )}
          {reel.niche && (
            <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
              {reel.niche}
            </span>
          )}
        </div>
        <button
          type="button" onClick={() => onUse(reel.reelUrl)}
          className="mt-3 w-full rounded-lg border border-indigo-500/40 bg-indigo-600/10 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-600/30 transition"
        >
          Create My Version
        </button>
      </div>
    </div>
  )
}

function Sidebar({ user, topHookStat }: { user: UserData; topHookStat: HookStat }) {
  const isUnlimited = user.plan === 'AGENCY'
  const totalCredits = PLAN_CREDITS[user.plan] ?? 3
  const tip = topHookStat
    ? `Your "${topHookStat.hookType}" hook performs best — avg ${formatViews(Math.round(topHookStat.avgViewsAchieved))} views. Use it today!`
    : 'Paste your first viral link to discover your best-performing hook style.'

  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-gray-800 h-screen sticky top-0 overflow-y-auto bg-gray-950">
      <div className="flex flex-col gap-6 p-5">
        <Link href="/dashboard" className="flex items-center gap-1.5">
          <span className="text-lg font-bold text-white tracking-tight">
            PasteViral<span className="text-indigo-400">.ai</span>
          </span>
        </Link>

        <nav className="space-y-0.5">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href} href={l.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition"
            >
              <span>{l.icon}</span>
              {l.label}
            </Link>
          ))}
        </nav>

        <div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PLAN_CHIP[user.plan] ?? PLAN_CHIP.FREE}`}>
            {user.plan}
          </span>
        </div>

        {isUnlimited ? (
          <div className="flex flex-col items-center gap-1">
            <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
              <circle cx="44" cy="44" r="36" fill="none" stroke="#6366f1" strokeWidth="8" />
              <text x="44" y="44" textAnchor="middle" dy="0.35em" fill="white" fontSize="20" fontWeight="bold">∞</text>
            </svg>
            <p className="text-xs text-gray-400">Unlimited credits</p>
          </div>
        ) : (
          <CreditRing remaining={user.creditsRemaining} total={totalCredits} />
        )}

        <div className="rounded-xl border border-purple-700/40 bg-purple-900/30 p-3">
          <p className="text-xs leading-relaxed text-purple-200">{tip}</p>
        </div>
      </div>
    </aside>
  )
}

function MobileBottomNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-gray-800 bg-gray-900">
      {NAV_LINKS.map((l) => (
        <Link
          key={l.href} href={l.href}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-gray-400 hover:text-white transition"
        >
          <span className="text-lg leading-none">{l.icon}</span>
          <span className="text-[10px]">{l.label}</span>
        </Link>
      ))}
    </nav>
  )
}

// --- Main export ---
export function DashboardClient({
  user, topHookStat, trendingReels,
}: {
  user: UserData
  topHookStat: HookStat
  trendingReels: TrendingReel[]
}) {
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
  const router = useRouter()

  const stopSse = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
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
            try { data = JSON.parse(raw) as SsePayload } catch { continue }
            if (data.error) { setError(data.error); setPhase('error'); controller.abort(); return }
            if (data.progress !== undefined) setSseProgress(data.progress)
            if (data.processingStage !== undefined) setSseStage(data.processingStage ?? null)
            if (data.videoUrl) setVideoUrl(data.videoUrl)
            if (data.status === 'COMPLETE') { setSseProgress(100); setPhase('done'); controller.abort(); router.refresh(); return }
            if (data.status === 'FAILED') { setError('Video generation failed.'); setPhase('error'); controller.abort(); return }
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError('Connection lost. Refresh to check status.')
          setPhase('error')
        }
      }
    })()
  }, [stopSse])

  const handleAnalyse = useCallback(async (overrideUrl?: string) => {
    const trimmed = (overrideUrl ?? url).trim()
    if (!trimmed) return
    if (overrideUrl) setUrl(overrideUrl)
    setError(null)
    setAnalyseResult(null)
    setSubmitResult(null)
    setVideoUrl(null)
    setSseProgress(0)
    setSseStage(null)
    stopSse()
    setPhase('analysing')
    try {
      const res = await fetch('/api/reels/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      const data = await res.json() as AnalyseResult & { error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to analyse URL'); setPhase('error'); return }
      setAnalyseResult(data)
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
      const res = await fetch('/api/reels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, generationMode }),
      })
      const data = await res.json() as SubmitResult & { error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to queue reel'); setPhase('error'); return }
      setSubmitResult(data)
      setSseProgress(5)
      setPhase('generating')
      startSse(data.reelId)
    } catch {
      setError('Something went wrong. Please try again.')
      setPhase('error')
    }
  }, [analyseResult, url, generationMode, startSse])

  const isLoading = phase === 'analysing' || phase === 'submitting'

  return (
    <div className="flex min-h-screen bg-gray-950 text-white pb-16 lg:pb-0">
      <Sidebar user={user} topHookStat={topHookStat} />

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-2xl px-4 py-8 lg:py-12">
          <h1 className="mb-1 text-2xl font-bold text-white">Create a Viral Reel</h1>
          <p className="mb-6 text-sm text-gray-400">
            Paste a TikTok, Instagram, YouTube, or Twitter/X URL to get started.
          </p>

          {/* Paste hero */}
          <div className="rounded-2xl border-2 border-dashed border-gray-700 bg-gray-900/50 p-5 space-y-3">
            <textarea
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleAnalyse()
              }}
              placeholder="https://www.tiktok.com/@creator/video/..."
              rows={2}
              disabled={isLoading || phase === 'generating'}
              className="w-full resize-none rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white placeholder-gray-600 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void handleAnalyse()}
              disabled={isLoading || !url.trim() || phase === 'generating'}
              className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 transition"
            >
              {phase === 'analysing' ? 'Analysing…' : 'Analyse Reel'}
            </button>
          </div>

          {/* Error */}
          {phase === 'error' && error && (
            <div className="mt-4 rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Phase cards */}
          {phase === 'analysing' && <AnalysingState />}
          {(phase === 'ready' || phase === 'submitting') && analyseResult && (
            <ReadyCard
              analyseResult={analyseResult}
              mode={generationMode}
              onModeChange={setGenerationMode}
              onGenerate={() => void handleGenerate()}
              isSubmitting={phase === 'submitting'}
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

          {/* Trending feed */}
          {trendingReels.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
                Trending Now
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {trendingReels.map((reel) => (
                  <TrendingCard
                    key={reel.id}
                    reel={reel}
                    onUse={(u) => void handleAnalyse(u)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {phase === 'idle' && trendingReels.length === 0 && (
            <div className="mt-10 rounded-2xl border border-dashed border-gray-800 p-10 text-center">
              <p className="text-4xl">📋</p>
              <p className="mt-2 text-sm font-medium text-gray-400">
                Paste your first viral link above
              </p>
              <p className="mt-1 text-xs text-gray-600">
                Trending reels will appear here as the platform grows
              </p>
            </div>
          )}
        </div>
      </main>

      <MobileBottomNav />
    </div>
  )
}
