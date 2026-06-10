const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'it', 'be', 'as', 'was', 'are', 'were',
  'this', 'that', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your',
  'his', 'her', 'its', 'our', 'their', 'do', 'did', 'have', 'has',
  'had', 'will', 'would', 'could', 'should', 'not', 'no', 'so', 'if',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

function computeTf(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
  const total = tokens.length
  const tf = new Map<string, number>()
  for (const [term, count] of counts) tf.set(term, count / total)
  return tf
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

function magnitude(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0))
}

export function cosineSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenize(text1)
  const tokens2 = tokenize(text2)

  if (tokens1.length === 0 || tokens2.length === 0) return 0

  const tf1 = computeTf(tokens1)
  const tf2 = computeTf(tokens2)

  // Smooth IDF over 2 documents: log(1 + 2/df)
  const vocab = new Set([...tf1.keys(), ...tf2.keys()])
  const idf = new Map<string, number>()
  for (const term of vocab) {
    const df = (tf1.has(term) ? 1 : 0) + (tf2.has(term) ? 1 : 0)
    idf.set(term, Math.log(1 + 2 / df))
  }

  const vec1: number[] = []
  const vec2: number[] = []
  for (const term of vocab) {
    const w = idf.get(term)!
    vec1.push((tf1.get(term) ?? 0) * w)
    vec2.push((tf2.get(term) ?? 0) * w)
  }

  const mag = magnitude(vec1) * magnitude(vec2)
  if (mag === 0) return 0

  return Math.min(1, Math.max(0, dotProduct(vec1, vec2) / mag))
}
