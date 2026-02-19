import 'server-only'

import { getParallelApiKey } from './env'

export type RouterDecision =
  | { mode: 'objective_only'; reason: string; signals: Record<string, boolean | number | string> }
  | { mode: 'generate_search_queries'; reason: string; signals: Record<string, boolean | number | string> }

export type RoutedExtractParams = {
  objective: string
  searchQueries: string[] | null
  excerpts: true
  fullContent: boolean
  routerDecision: RouterDecision
  routerReasonJson: string
}

function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g)
  return words ? words.length : 0
}

function hasAmbiguousReference(question: string): boolean {
  const q = ` ${question.toLowerCase()} `
  const refs = [' it ', ' they ', ' this ', ' that ', ' these ', ' those ', ' there ', ' here ']
  const hit = refs.some((w) => q.includes(w))
  if (!hit) return false
  // If the question is long, a single "this/that" is less likely to be ambiguous.
  return wordCount(question) <= 12
}

function isKeywordish(question: string): boolean {
  const wc = wordCount(question)
  if (wc <= 3) return true
  const trimmed = question.trim()
  if (trimmed.length <= 30 && !/[?.!]$/.test(trimmed)) return true
  return false
}

function needsBroadCoverage(question: string): boolean {
  const q = question.toLowerCase()
  const broadPhrases = [
    'compare',
    'comparison',
    'overview',
    'summarize',
    'summary',
    'pros and cons',
    'pros/cons',
    'tradeoffs',
    'everything about',
    'all about',
    'list',
    'bullet',
    'timeline',
    'pricing',
  ]
  return broadPhrases.some((p) => q.includes(p))
}

export function decideRouter(input: { question: string; urlCount: number }): RouterDecision {
  const question = input.question.trim()
  const wc = wordCount(question)
  const isShort = wc < 9 || question.length < 60
  const ambiguous = hasAmbiguousReference(question)
  const keywordish = isKeywordish(question)
  const broad = needsBroadCoverage(question)
  const manySources = input.urlCount > 5
  const noSources = input.urlCount === 0

  const signals = {
    word_count: wc,
    char_count: question.length,
    url_count: input.urlCount,
    short_question: isShort,
    ambiguous_reference: ambiguous,
    keywordish,
    broad_question: broad,
    many_sources: manySources,
    no_sources: noSources,
  }

  if (noSources) {
    return {
      mode: 'objective_only',
      reason: 'No active sources; skipping search_queries generation.',
      signals,
    }
  }

  const shouldGenerate = isShort || ambiguous || keywordish || broad || manySources
  if (!shouldGenerate) {
    return {
      mode: 'objective_only',
      reason: 'Heuristics indicate objective-only extraction is sufficient.',
      signals,
    }
  }

  const reasons: string[] = []
  if (isShort) reasons.push('short_question')
  if (ambiguous) reasons.push('ambiguous_reference')
  if (keywordish) reasons.push('keywordish')
  if (broad) reasons.push('broad_question')
  if (manySources) reasons.push('many_sources')

  return {
    mode: 'generate_search_queries',
    reason: `Heuristics triggered: ${reasons.join(', ') || 'unknown'}.`,
    signals,
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim()
}

function safeJsonParse<T>(text: string): T {
  const cleaned = stripCodeFences(text)
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // Best-effort: extract the first JSON object/array substring.
    const objStart = cleaned.indexOf('{')
    const arrStart = cleaned.indexOf('[')
    const start = [objStart, arrStart].filter((n) => n >= 0).sort((a, b) => a - b)[0]
    if (start === undefined) throw new Error('Failed to parse JSON from model output.')
    const candidate = cleaned.slice(start).trim()
    return JSON.parse(candidate) as T
  }
}

export async function generateSearchQueries(question: string): Promise<string[]> {
  try {
    const apiKey = getParallelApiKey()

    const schema = {
      name: 'search_queries_schema',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          search_queries: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string' },
            description: '1-3 short keyword queries to focus web extraction',
          },
        },
        required: ['search_queries'],
      },
    }

    const system = [
      'You generate keyword-style search queries to focus web page extraction.',
      'Return only valid JSON matching the schema.',
      'Queries should be short (2-6 words), specific, and non-redundant.',
      'Do not include quotes unless the phrase must be exact.',
    ].join('\n')

    const user = [
      'Generate 1-3 keyword search queries that would help extract relevant snippets from a set of web pages.',
      `Question: ${question}`,
    ].join('\n')

    const response = await fetch('https://api.parallel.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'speed',
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: schema,
        },
      }),
    })

    if (!response.ok) {
      return []
    }

    const json = (await response.json().catch(() => null)) as any
    const content: string | undefined = json?.choices?.[0]?.message?.content
    if (!content) return []

    let parsed: { search_queries?: unknown } | null = null
    try {
      parsed = safeJsonParse<{ search_queries: unknown }>(content)
    } catch {
      parsed = null
    }

    const arr = parsed?.search_queries
    if (!Array.isArray(arr)) return []

    const cleaned = arr
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean)
      .slice(0, 3)

    if (cleaned.length < 1) return []

    return cleaned
  } catch {
    return []
  }
}

export async function routeExtractParamsForChat(input: {
  question: string
  fullPage: boolean
  urlCount: number
}): Promise<RoutedExtractParams> {
  const objective = input.question.trim()
  const routerDecision = decideRouter({ question: input.question, urlCount: input.urlCount })

  let searchQueries: string[] | null = null
  let finalDecision: RouterDecision = routerDecision

  if (routerDecision.mode === 'generate_search_queries') {
    const generated = await generateSearchQueries(objective)
    if (generated.length > 0) {
      searchQueries = generated
    } else {
      finalDecision = {
        mode: 'objective_only',
        reason: 'Search query generation returned no usable queries; falling back to objective-only.',
        signals: { ...routerDecision.signals, generation_failed: true },
      }
      searchQueries = null
    }
  }

  const routerReasonJson = JSON.stringify({
    decision: finalDecision.mode,
    reason: finalDecision.reason,
    signals: finalDecision.signals,
    model: finalDecision.mode === 'generate_search_queries' ? 'speed' : undefined,
    search_query_count: searchQueries?.length ?? 0,
  })

  return {
    objective,
    searchQueries,
    excerpts: true,
    fullContent: input.fullPage,
    routerDecision: finalDecision,
    routerReasonJson,
  }
}

