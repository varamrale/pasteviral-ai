'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const AD_FORMATS = [
  { value: 'ugc', label: 'UGC Style', desc: 'Authentic user-generated look' },
  { value: 'demo', label: 'Product Demo', desc: 'Show features in action' },
  { value: 'testimonial', label: 'Testimonial', desc: 'Social proof format' },
  { value: 'comparison', label: 'Before/After', desc: 'Comparison story' },
] as const

type AdFormat = 'ugc' | 'demo' | 'testimonial' | 'comparison'

export default function ProductAdsPage() {
  const router = useRouter()
  const [productUrl, setProductUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [adFormat, setAdFormat] = useState<AdFormat>('ugc')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/product-ads/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productUrl, productName, adFormat }),
      })
      const data = await res.json() as { reelId?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')
      router.push(`/dashboard/reels/${data.reelId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Product Ad Creator</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generate scroll-stopping ads from any product URL — no filming required.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Product URL
          </label>
          <input
            type="url"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder="https://your-store.com/product"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Product Name
          </label>
          <input
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. Glow Serum Pro"
            required
            maxLength={100}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Ad Format
          </label>
          <div className="grid grid-cols-2 gap-2">
            {AD_FORMATS.map((fmt) => (
              <button
                key={fmt.value}
                type="button"
                onClick={() => setAdFormat(fmt.value)}
                className={`text-left border rounded-xl px-3 py-2.5 transition-colors ${
                  adFormat === fmt.value
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-purple-300'
                }`}
              >
                <p className="text-sm font-medium text-gray-800">{fmt.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{fmt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !productUrl || !productName}
          className="w-full bg-purple-600 text-white text-sm font-semibold py-3 rounded-xl disabled:opacity-50 hover:bg-purple-700 transition-colors"
        >
          {loading ? 'Generating…' : 'Generate Ad'}
        </button>
      </form>
    </div>
  )
}
