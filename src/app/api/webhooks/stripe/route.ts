import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({ message: 'Stripe webhooks are no longer active' }, { status: 410 })
}
