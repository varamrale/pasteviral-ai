const required = [
  'DATABASE_URL',
  'UPSTASH_QUEUE_URL',
  'UPSTASH_CACHE_URL',
  'UPSTASH_SESSION_URL',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'ANTHROPIC_API_KEY',
  'FAL_API_KEY',
  'ELEVENLABS_API_KEY',
  'MAGIC_HOUR_API_KEY',
  'AYRSHARE_API_KEY',
  'SOCIAVAULT_API_KEY',
  'SUPADATA_API_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'CLOUDFLARE_R2_ACCESS_KEY',
  'CLOUDFLARE_R2_SECRET_KEY',
  'CLOUDFLARE_R2_BUCKET',
  'CLOUDFLARE_R2_ENDPOINT',
]

export function validateEnv() {
  const missing = required.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
}