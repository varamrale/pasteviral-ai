'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void }
  }
}

type PlanId = 'FREE' | 'STARTER' | 'CREATOR' | 'AGENCY'

interface PricingPlan {
  id: PlanId
  name: string
  price: number
  credits: string
  description: string
  features: string[]
  popular?: boolean
}

const PLANS: PricingPlan[] = [
  {
    id: 'FREE',
    name: 'Free',
    price: 0,
    credits: '3 total',
    description: 'Try PasteViral at no cost',
    features: ['3 lifetime credits', 'Basic reel generation', 'Watermark on videos', 'Community support'],
  },
  {
    id: 'STARTER',
    name: 'Starter',
    price: 19,
    credits: '30 / month',
    description: 'For individual creators',
    features: ['30 credits per month', 'Face swap', 'Voice cloning', 'No watermark', 'Email support'],
  },
  {
    id: 'CREATOR',
    name: 'Creator',
    price: 49,
    credits: '100 / month',
    description: 'For serious content creators',
    features: [
      '100 credits per month',
      'Everything in Starter',
      'Auto mode',
      'Performance analytics',
      'Priority support',
    ],
    popular: true,
  },
  {
    id: 'AGENCY',
    name: 'Agency',
    price: 199,
    credits: 'Unlimited',
    description: 'For teams and agencies',
    features: [
      'Unlimited credits',
      'Everything in Creator',
      'Client workspaces',
      'Team management',
      'Dedicated support',
    ],
  },
]

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.getElementById('razorpay-checkout-js')) {
      resolve(true)
      return
    }
    const script = document.createElement('script')
    script.id = 'razorpay-checkout-js'
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export default function PricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState<PlanId | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadRazorpayScript()
  }, [])

  async function handleCheckout(planId: PlanId) {
    if (planId === 'FREE') {
      router.push('/auth/signup')
      return
    }

    setLoading(planId)
    setError(null)

    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })

      if (res.status === 401) {
        router.push(`/auth/signin?callbackUrl=/pricing`)
        return
      }

      const data = (await res.json()) as { subscriptionId?: string; keyId?: string; error?: string }

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }

      if (!data.subscriptionId || !data.keyId) {
        setError('Payment configuration error. Please try again.')
        return
      }

      const loaded = await loadRazorpayScript()
      if (!loaded || !window.Razorpay) {
        setError('Failed to load payment gateway. Please try again.')
        return
      }

      const rzp = new window.Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: 'PasteViral',
        description: `${planId} Plan`,
        handler: () => {
          router.push('/dashboard?subscription=success')
        },
        modal: {
          ondismiss: () => {
            setLoading(null)
          },
        },
      })
      rzp.open()
    } catch {
      setError('Network error. Please try again.')
      setLoading(null)
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white py-20 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold tracking-tight mb-4">Simple, transparent pricing</h1>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            Start free and scale as your content grows. Cancel anytime.
          </p>
        </div>

        {error && (
          <div className="mb-8 p-4 bg-red-950/60 border border-red-800 rounded-xl text-red-300 text-center text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                plan.popular
                  ? 'border-violet-500 bg-violet-950/20 shadow-lg shadow-violet-500/10'
                  : 'border-zinc-800 bg-zinc-900/40'
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-violet-500 text-white text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
                  Most Popular
                </span>
              )}

              <div className="mb-6">
                <h2 className="text-xl font-semibold mb-1">{plan.name}</h2>
                <p className="text-zinc-400 text-sm mb-5">{plan.description}</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">
                    {plan.price === 0 ? 'Free' : `₹${plan.price}`}
                  </span>
                  {plan.price > 0 && <span className="text-zinc-400 text-sm">/month</span>}
                </div>
                <p className="text-zinc-500 text-sm mt-1">{plan.credits} credits</p>
              </div>

              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-zinc-300">
                    <svg
                      className="w-4 h-4 text-violet-400 shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => void handleCheckout(plan.id)}
                disabled={loading !== null}
                className={`w-full py-3 px-4 rounded-xl font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  plan.popular
                    ? 'bg-violet-500 hover:bg-violet-400 text-white'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                }`}
              >
                {loading === plan.id
                  ? 'Opening...'
                  : plan.id === 'FREE'
                    ? 'Get Started Free'
                    : `Choose ${plan.name}`}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-zinc-600 text-sm mt-12">
          All paid plans include a 7-day money-back guarantee. No questions asked.
        </p>
      </div>
    </main>
  )
}
