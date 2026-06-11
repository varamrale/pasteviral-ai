const FAL_BASE = 'https://fal.run'
const PAID_ENDPOINT = '/fal-ai/kling-video/v1.6/standard/text-to-video'
const FREE_ENDPOINT = '/fal-ai/wan/v2.1/text-to-video'
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 3 * 60 * 1000

function falHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${process.env.FAL_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  }
}

export async function generateVideo(
  script: string,
  _platform: string,
  mode: 'paid' | 'free',
): Promise<{ jobId: string; status: string; endpoint: string }> {
  const endpoint = mode === 'paid' ? PAID_ENDPOINT : FREE_ENDPOINT
  const body =
    mode === 'paid'
      ? { prompt: script, duration: 5, aspect_ratio: '9:16' }
      : { prompt: script, duration: 3, aspect_ratio: '9:16' }

  const res = await fetch(`${FAL_BASE}${endpoint}`, {
    method: 'POST',
    headers: falHeaders(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`fal.ai submit failed ${res.status}: ${text}`)
  }

  const data = (await res.json()) as { request_id: string; status: string }
  return { jobId: data.request_id, status: data.status ?? 'IN_QUEUE', endpoint }
}

export async function pollVideoJob(
  jobId: string,
  endpoint: string,
): Promise<{ status: string; videoUrl?: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const res = await fetch(`${FAL_BASE}${endpoint}/requests/${jobId}`, {
      headers: falHeaders(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`fal.ai poll failed ${res.status}: ${text}`)
    }

    const data = (await res.json()) as {
      status: string
      video?: { url?: string }
      output?: { video?: { url?: string }; video_url?: string }
    }

    if (data.status === 'COMPLETED') {
      const videoUrl =
        data.video?.url ?? data.output?.video?.url ?? data.output?.video_url
      return { status: 'COMPLETED', videoUrl }
    }

    if (data.status === 'FAILED') {
      return { status: 'FAILED' }
    }

    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  throw new Error('fal.ai poll timed out after 3 minutes')
}
