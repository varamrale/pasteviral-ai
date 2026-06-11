import { Platform } from '@prisma/client'

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'igshid', 'ref', 'referer', 'si',
])

const ALLOWED_HOSTS = new Map<string, Platform>([
  ['tiktok.com', Platform.TIKTOK],
  ['www.tiktok.com', Platform.TIKTOK],
  ['vm.tiktok.com', Platform.TIKTOK],
  ['instagram.com', Platform.INSTAGRAM],
  ['www.instagram.com', Platform.INSTAGRAM],
  ['youtube.com', Platform.YOUTUBE],
  ['www.youtube.com', Platform.YOUTUBE],
  ['youtu.be', Platform.YOUTUBE],
  ['twitter.com', Platform.TWITTER],
  ['www.twitter.com', Platform.TWITTER],
  ['x.com', Platform.TWITTER],
  ['www.x.com', Platform.TWITTER],
])

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key)) parsed.searchParams.delete(key)
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

export function getPlatform(url: string): Platform | null {
  try {
    const { hostname } = new URL(url)
    return ALLOWED_HOSTS.get(hostname) ?? null
  } catch {
    return null
  }
}

export function validateUrl(url: string): { valid: boolean; platform: Platform | null; error?: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, platform: null, error: 'Invalid URL format' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, platform: null, error: 'Only HTTP/HTTPS URLs are allowed' }
  }

  if (
    PRIVATE_IP_RE.test(parsed.hostname) ||
    parsed.hostname === 'localhost' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '[::1]'
  ) {
    return { valid: false, platform: null, error: 'Private or local addresses are not allowed' }
  }

  const platform = ALLOWED_HOSTS.get(parsed.hostname) ?? null
  if (!platform) {
    return { valid: false, platform: null, error: 'Unsupported platform. Paste a TikTok, Instagram, YouTube, or Twitter/X URL.' }
  }

  return { valid: true, platform }
}
