import { createHash } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { pvCache } from './redis'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const HOOK_CACHE_TTL = 86400 // 24 hours

export interface HookVariant {
  type: string
  hook: string
  retentionBoost: number
  openingWords: string
}

const HOOK_SYSTEM_PROMPT =
  `You are a viral content hook specialist. Given a script and platform, generate exactly 5 opening hooks. ` +
  `Each hook must be one of these types: curiosity, shock_stat, question, problem_agitate, outcome_first. ` +
  `For each hook provide: type, the full hook text, estimated retentionBoost (integer 1-100), openingWords (first 20 words). ` +
  `Return a JSON array only with no markdown fences: ` +
  `[{"type":"...","hook":"...","retentionBoost":85,"openingWords":"..."},...]`

interface RawHook {
  type?: string
  hook?: string
  retentionBoost?: number
  openingWords?: string
}

export async function generateHooks(script: string, platform: string): Promise<HookVariant[]> {
  const cacheKey = `hooks:${createHash('sha256').update(`${script}:${platform}`).digest('hex')}`

  const cached = await pvCache.get(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached) as HookVariant[]
    } catch {
      // fall through to regenerate
    }
  }

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: HOOK_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Platform: ${platform}\n\nScript:\n${script}`,
      },
    ],
  })

  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '[]'
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()

  let hooks: HookVariant[]
  try {
    const parsed = JSON.parse(cleaned) as RawHook[]
    hooks = parsed.map((h) => ({
      type: h.type ?? 'curiosity',
      hook: h.hook ?? '',
      retentionBoost: typeof h.retentionBoost === 'number' ? h.retentionBoost : 50,
      openingWords: h.openingWords ?? (h.hook ?? '').split(/\s+/).slice(0, 20).join(' '),
    }))
  } catch {
    hooks = []
  }

  hooks.sort((a, b) => b.retentionBoost - a.retentionBoost)

  await pvCache.set(cacheKey, JSON.stringify(hooks), 'EX', HOOK_CACHE_TTL)

  return hooks
}
