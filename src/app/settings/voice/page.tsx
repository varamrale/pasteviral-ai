'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type Plan = 'FREE' | 'STARTER' | 'CREATOR' | 'AGENCY'

type VoiceStatus = {
  plan: Plan
  hasVoiceClone: boolean
}

const STARTER_PLANS: Plan[] = ['STARTER', 'CREATOR', 'AGENCY']
const RECORD_DURATION = 15

export default function VoicePage() {
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isRecording, setIsRecording] = useState(false)
  const [countdown, setCountdown] = useState(RECORD_DURATION)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const [isUploading, setIsUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function fetchStatus() {
    try {
      const res = await fetch('/api/profile/voice')
      const data = (await res.json()) as VoiceStatus & { error?: string }
      if (data.error) {
        setError(data.error)
        return
      }
      setStatus(data)
    } catch {
      setError('Failed to load voice clone status')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchStatus()
  }, [])

  useEffect(() => {
    return () => {
      if (playbackUrl) URL.revokeObjectURL(playbackUrl)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [playbackUrl])

  const stopRecording = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  async function startRecording() {
    setError(null)
    setRecordedBlob(null)
    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl)
      setPlaybackUrl(null)
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access denied — please allow microphone access in browser settings')
      return
    }

    chunksRef.current = []
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunksRef.current, { type: mimeType })
      setRecordedBlob(blob)
      const url = URL.createObjectURL(blob)
      setPlaybackUrl(url)
      setIsRecording(false)
      setCountdown(RECORD_DURATION)
    }

    recorder.start(100)
    setIsRecording(true)
    setCountdown(RECORD_DURATION)

    let remaining = RECORD_DURATION
    countdownRef.current = setInterval(() => {
      remaining -= 1
      setCountdown(remaining)
      if (remaining <= 0) {
        stopRecording()
      }
    }, 1000)
  }

  function togglePlayback() {
    if (!playbackUrl) return
    if (!audioRef.current) {
      audioRef.current = new Audio(playbackUrl)
      audioRef.current.onended = () => setIsPlaying(false)
    }
    if (isPlaying) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setIsPlaying(false)
    } else {
      void audioRef.current.play()
      setIsPlaying(true)
    }
  }

  function discardRecording() {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setIsPlaying(false)
    }
    setRecordedBlob(null)
    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl)
      setPlaybackUrl(null)
    }
  }

  async function handleUpload() {
    if (!recordedBlob) return
    setIsUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('recording', recordedBlob, 'voice-sample.webm')

      const res = await fetch('/api/profile/voice', { method: 'POST', body: formData })
      const data = (await res.json()) as { success?: boolean; error?: string }

      if (!res.ok || data.error) {
        setError(data.error ?? 'Upload failed')
        return
      }

      discardRecording()
      await fetchStatus()
    } catch {
      setError('Upload failed — please try again')
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    setError(null)
    setShowDeleteConfirm(false)

    try {
      const res = await fetch('/api/profile/voice', { method: 'DELETE' })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Delete failed')
        return
      }
      await fetchStatus()
    } catch {
      setError('Delete failed — please try again')
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white px-4 py-12">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="h-8 w-48 rounded-lg bg-zinc-900 animate-pulse" />
          <div className="h-4 w-96 rounded bg-zinc-900 animate-pulse" />
          <div className="h-64 rounded-2xl bg-zinc-900 animate-pulse" />
        </div>
      </main>
    )
  }

  const planAllowed = status ? STARTER_PLANS.includes(status.plan) : false

  return (
    <main className="min-h-screen bg-zinc-950 text-white px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Voice Clone</h1>
        <p className="text-zinc-400 text-sm mb-8">
          Record 15 seconds of your voice to generate narration that sounds like you.
        </p>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {!planAllowed ? (
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-8 text-center">
            <div className="mb-4 text-4xl">🎙️</div>
            <h2 className="text-lg font-semibold text-white mb-2">Voice clone requires Starter plan</h2>
            <p className="text-zinc-400 text-sm mb-6">
              Upgrade to Starter ($19/mo) or higher to create a voice clone and narrate your reels in your own voice.
            </p>
            <a
              href="/settings/billing"
              className="inline-block rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 min-h-[44px] flex items-center justify-center"
            >
              Upgrade to Starter
            </a>
          </div>
        ) : (
          <div className="space-y-6">
            {status?.hasVoiceClone && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                      <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Voice clone active</p>
                      <p className="text-xs text-zinc-500">Your reels will use your cloned voice for narration</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]"
                  >
                    {isDeleting ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-sm font-medium text-zinc-300 mb-1">
                {status?.hasVoiceClone ? 'Re-record voice sample' : 'Record voice sample'}
              </p>
              <p className="text-xs text-zinc-500 mb-6">
                Read any text aloud for 15 seconds — a news headline, paragraph, or anything natural.
              </p>

              {isRecording ? (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-red-500 bg-red-500/10">
                    <span className="text-2xl font-bold text-red-400 tabular-nums">{countdown}</span>
                    <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                  </div>
                  <p className="text-sm text-zinc-400">Recording… speak now</p>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 min-h-[44px]"
                  >
                    Stop early
                  </button>
                </div>
              ) : recordedBlob ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3">
                    <button
                      type="button"
                      onClick={togglePlayback}
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-violet-600 transition hover:bg-violet-500"
                      aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
                    >
                      {isPlaying ? (
                        <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-zinc-300">Voice sample recorded</p>
                      <p className="text-xs text-zinc-500">{RECORD_DURATION}s · WebM audio</p>
                    </div>
                    <button
                      type="button"
                      onClick={discardRecording}
                      className="text-xs text-zinc-500 hover:text-zinc-300 transition"
                    >
                      Discard
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleUpload()}
                    disabled={isUploading}
                    className="w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40 min-h-[44px]"
                  >
                    {isUploading ? 'Creating voice clone…' : 'Create voice clone'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-700 py-10 text-sm text-zinc-400 transition hover:border-violet-500/50 hover:bg-violet-500/5 hover:text-violet-400 min-h-[44px]"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                  Start 15-second recording
                </button>
              )}
            </div>

            <p className="text-xs text-zinc-600 text-center">
              Your voice recording is encrypted and stored securely. You can delete it at any time.
            </p>
          </div>
        )}

        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
              <h3 className="text-base font-semibold text-white mb-2">Remove voice clone?</h3>
              <p className="text-sm text-zinc-400 mb-6">
                This will permanently delete your voice clone. Future reels will use the default AI voice. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 rounded-xl border border-zinc-700 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white transition hover:bg-red-500 min-h-[44px]"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
