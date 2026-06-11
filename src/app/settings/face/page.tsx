'use client'

import { useState, useEffect, useRef, useCallback, DragEvent, ChangeEvent } from 'react'
import Image from 'next/image'

type Plan = 'FREE' | 'STARTER' | 'CREATOR' | 'AGENCY'

type FaceStatus = {
  plan: Plan
  hasFacePhoto: boolean
  signedUrl: string | null
  consentDate: string | null
}

const CONSENT_TEXT =
  'I consent to PasteViral using this photo to create personalised reels. I confirm I own the rights to this photo and am over 18.'

const CREATOR_PLANS: Plan[] = ['CREATOR', 'AGENCY']

export default function FacePage() {
  const [status, setStatus] = useState<FaceStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function fetchStatus() {
    try {
      const res = await fetch('/api/profile/face')
      const data = (await res.json()) as FaceStatus & { error?: string }
      if (data.error) {
        setError(data.error)
        return
      }
      setStatus(data)
    } catch {
      setError('Failed to load face photo status')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchStatus()
  }, [])

  const handleFileChange = useCallback((file: File) => {
    if (!file.type.startsWith('image/jpeg') && !file.type.startsWith('image/png') && file.type !== 'image/jpg') {
      setError('Only JPEG and PNG files are accepted')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10 MB')
      return
    }
    setError(null)
    setSelectedFile(file)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
  }, [])

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFileChange(file)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileChange(file)
  }

  async function handleUpload() {
    if (!selectedFile || !consentChecked) return
    setIsUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('photo', selectedFile)
      formData.append('consentAccepted', 'true')

      const res = await fetch('/api/profile/face', { method: 'POST', body: formData })
      const data = (await res.json()) as { success?: boolean; error?: string; facePhotoUrl?: string }

      if (!res.ok || data.error) {
        setError(data.error ?? 'Upload failed')
        return
      }

      setSelectedFile(null)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setConsentChecked(false)
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
      const res = await fetch('/api/profile/face', { method: 'DELETE' })
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

  const planAllowed = status ? CREATOR_PLANS.includes(status.plan) : false

  return (
    <main className="min-h-screen bg-zinc-950 text-white px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Face Avatar</h1>
        <p className="text-zinc-400 text-sm mb-8">
          Upload your photo to personalise generated reels with your face.
        </p>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {!planAllowed ? (
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-8 text-center">
            <div className="mb-4 text-4xl">✨</div>
            <h2 className="text-lg font-semibold text-white mb-2">Face swap requires Creator plan</h2>
            <p className="text-zinc-400 text-sm mb-6">
              Upgrade to Creator ($49/mo) to personalise your reels with AI face swap.
            </p>
            <a
              href="/settings/billing"
              className="inline-block rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
            >
              Upgrade to Creator
            </a>
          </div>
        ) : (
          <div className="space-y-6">
            {status?.hasFacePhoto && status.signedUrl && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
                <p className="text-sm font-medium text-zinc-300 mb-4">Current face photo</p>
                <div className="flex items-center gap-5">
                  <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-zinc-700 flex-shrink-0">
                    <Image
                      src={status.signedUrl}
                      alt="Current face photo"
                      fill
                      className="object-cover"
                      sizes="80px"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    {status.consentDate && (
                      <p className="text-xs text-zinc-500 mb-3">
                        Uploaded {new Date(status.consentDate).toLocaleDateString()}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isDeleting}
                      className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]"
                    >
                      {isDeleting ? 'Removing…' : 'Remove my face'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-sm font-medium text-zinc-300 mb-4">
                {status?.hasFacePhoto ? 'Replace photo' : 'Upload photo'}
              </p>

              {previewUrl ? (
                <div className="mb-4 relative">
                  <div className="relative h-48 w-full overflow-hidden rounded-xl border border-zinc-700">
                    <Image
                      src={previewUrl}
                      alt="Preview"
                      fill
                      className="object-contain"
                      sizes="(max-width: 672px) 100vw, 672px"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(previewUrl)
                      setPreviewUrl(null)
                      setSelectedFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 transition"
                  >
                    Choose a different photo
                  </button>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 cursor-pointer transition ${
                    isDragging
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
                    <svg className="h-6 w-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-zinc-300">Drop a photo here</p>
                    <p className="text-xs text-zinc-500 mt-1">or click to browse — JPEG / PNG, max 10 MB</p>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleInputChange}
                className="hidden"
              />

              <label className="mt-5 flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-zinc-600 bg-zinc-800 text-violet-600 accent-violet-600"
                />
                <span className="text-xs leading-relaxed text-zinc-400 group-hover:text-zinc-300 transition">
                  {CONSENT_TEXT}
                </span>
              </label>

              <button
                type="button"
                onClick={() => void handleUpload()}
                disabled={!selectedFile || !consentChecked || isUploading}
                className="mt-5 w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40 min-h-[44px]"
              >
                {isUploading ? 'Uploading…' : 'Upload photo'}
              </button>
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
              <h3 className="text-base font-semibold text-white mb-2">Remove face photo?</h3>
              <p className="text-sm text-zinc-400 mb-6">
                This will permanently delete your face photo and disable face swap on future reels.
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
