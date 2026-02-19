import 'server-only'

import { getParallelApiKey } from './env'

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
    const objStart = cleaned.indexOf('{')
    const arrStart = cleaned.indexOf('[')
    const start = [objStart, arrStart].filter((n) => n >= 0).sort((a, b) => a - b)[0]
    if (start === undefined) throw new Error('Failed to parse JSON from model output.')
    const candidate = cleaned.slice(start).trim()
    return JSON.parse(candidate) as T
  }
}

export type SourceEvidence = {
  url: string
  content: string
}

export type ChatAnswerResult = {
  answer: string
  citations: string[]
}

export async function generateChatAnswer(
  question: string,
  sources: SourceEvidence[]
): Promise<ChatAnswerResult> {
  const apiKey = getParallelApiKey()

  const schema = {
    name: 'chat_answer_schema',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: {
          type: 'string',
          description: 'The answer to the user question, grounded in the provided sources.',
        },
        citations: {
          type: 'array',
          items: { type: 'string' },
          description: 'URLs from the sources that were actually used to support the answer.',
        },
      },
      required: ['answer', 'citations'],
    },
  }

  const contextParts = sources.map((s, i) => {
    return `Source${i + 1}: ${s.url}\n\n${s.content}`
  })
  const context = contextParts.join('\n\n---\n\n')

  const system = [
    'You answer the user question using only the provided source content.',
    'Be concise and accurate. Cite sources by including their URLs in the citations array.',
    'Only include URLs in citations that you actually used to support your answer.',
    'Return valid JSON matching the schema.',
  ].join('\n')

  const user = [
    `Question: ${question}`,
    '',
    'Sources:',
    context,
  ].join('\n')

  const response = await fetch('https://api.parallel.ai/v1beta/chat/completions', {
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
    const errText = await response.text()
    throw new Error(`Chat API error: ${response.status} ${errText}`)
  }

  const json = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('Empty response from Chat API')
  }

  const parsed = safeJsonParse<{ answer?: string; citations?: unknown }>(content)
  const answer = typeof parsed.answer === 'string' ? parsed.answer : 'No answer generated.'
  const citations = Array.isArray(parsed.citations)
    ? parsed.citations.filter((c): c is string => typeof c === 'string')
    : []

  return { answer, citations }
}
