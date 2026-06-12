'use client'

import { useState, useEffect, useCallback } from 'react'

interface Channel {
  id: string
  handle: string
  youtubeChannelId: string | null
  autoClipEnabled: boolean
  autoClipMinViews: number
  lastUploadedVideoId: string | null
  lastFetchedAt: string | null
  createdAt: string
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [inputUrl, setInputUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/channels')
      if (!res.ok) throw new Error('Failed to load channels')
      const data = await res.json() as { channels: Channel[] }
      setChannels(data.channels)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchChannels() }, [fetchChannels])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    setError(null)
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeChannelUrl: inputUrl }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to add channel')
      setInputUrl('')
      await fetchChannels()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(id: string) {
    setError(null)
    try {
      const res = await fetch(`/api/channels?id=${id}`, { method: 'DELETE' })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to remove channel')
      setChannels((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">YouTube Channels</h1>
      <p className="text-sm text-gray-500 mb-6">
        Auto-clip new uploads from monitored channels.
      </p>

      <form onSubmit={(e) => void handleAdd(e)} className="flex gap-2 mb-8">
        <input
          type="url"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          placeholder="https://youtube.com/@channelname"
          required
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <button
          type="submit"
          disabled={adding || !inputUrl}
          className="bg-purple-600 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-purple-700 transition-colors"
        >
          {adding ? 'Adding…' : 'Add Channel'}
        </button>
      </form>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : channels.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">📺</p>
          <p className="text-sm">No channels yet. Paste a YouTube channel URL above.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {channels.map((ch) => (
            <li
              key={ch.id}
              className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-gray-800">@{ch.handle}</p>
                {ch.lastUploadedVideoId && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Last clipped: {ch.lastUploadedVideoId}
                  </p>
                )}
                {ch.lastFetchedAt && (
                  <p className="text-xs text-gray-400">
                    Checked: {new Date(ch.lastFetchedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    ch.autoClipEnabled
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {ch.autoClipEnabled ? 'Auto-clip ON' : 'Paused'}
                </span>
                <button
                  onClick={() => void handleRemove(ch.id)}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
