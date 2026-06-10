import Anthropic from '@anthropic-ai/sdk'
import { cosineSimilarity } from './similarity'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PLATFORM_STYLE: Record<string, string> = {
  TIKTOK: 'casual, direct, fast-paced, punchy hooks',
  INSTAGRAM: 'polished, aspirational, visually descriptive, engaging',
  YOUTUBE: 'educational, structured, thorough, value-driven',
  TWITTER: 'professional, concise, insight-driven, LinkedIn-style authority',
}

interface UpgradeResult {
  upgradedScript: string
  similarityScore: number
  topic: string
  angle: string
}

interface ClaudeScriptResponse {
  upgradedScript?: string
  topic?: string
  angle?: string
}

function buildSystemPrompt(platform: string): string {
  const style = PLATFORM_STYLE[platform.toUpperCase()] ?? 'engaging and direct'
  return (
    `You are a viral content strategist. Analyse the transcript. ` +
    `Extract: topic, emotional hook, pacing, value delivery. ` +
    `Rewrite as a better script for ${platform} (style: ${style}). ` +
    `Return JSON only with no markdown fences: {"upgradedScript":"...","topic":"...","angle":"..."}`
  )
}

async function callClaude(systemPrompt: string, userContent: string): Promise<ClaudeScriptResponse> {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  })

  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  return JSON.parse(cleaned) as ClaudeScriptResponse
}

export async function upgradeScript(
  transcript: string,
  platform: string,
): Promise<UpgradeResult> {
  const systemPrompt = buildSystemPrompt(platform)
  let response = await callClaude(systemPrompt, `Transcript:\n${transcript}`)

  let upgradedScript = response.upgradedScript ?? ''
  let similarityScore = cosineSimilarity(transcript, upgradedScript)

  const MAX_RETRIES = 2
  for (let attempt = 0; attempt < MAX_RETRIES && similarityScore > 0.6; attempt++) {
    const retryPrompt =
      `Make it significantly more original. ` +
      `Current similarity to the original is too high (${(similarityScore * 100).toFixed(0)}%). ` +
      `Introduce fresh angles, different examples, new structure. ` +
      `Previous attempt:\n${upgradedScript}\n\nOriginal:\n${transcript}`

    response = await callClaude(systemPrompt, retryPrompt)
    upgradedScript = response.upgradedScript ?? upgradedScript
    similarityScore = cosineSimilarity(transcript, upgradedScript)
  }

  return {
    upgradedScript,
    similarityScore: Math.round(similarityScore * 1000) / 1000,
    topic: response.topic ?? '',
    angle: response.angle ?? '',
  }
}
