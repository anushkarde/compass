import { NextResponse } from 'next/server'

import {
  getParallelClient,
} from '@/lib/parallel'
import {
  insertExtractRun,
  insertExtractedPage,
  listSourcesWithLatest,
  setSourceLatest,
  upsertSources,
} from '@/lib/db'

const EXTRACT_BATCH_SIZE = 10
const BASELINE_OBJECTIVE = 'Summarize key topics for later Q&A'

export async function GET() {
  try {
    const sources = listSourcesWithLatest({ includeInactive: true })
    return NextResponse.json({
      sources: sources.map((s) => ({
        id: s.id,
        url: s.url,
        created_at: s.created_at,
        updated_at: s.updated_at,
        is_active: Boolean(s.is_active),
        latest_extracted_at: s.latest_extracted_at,
        latest_title: s.latest_title,
        latest_has_full_content: Boolean(s.latest_has_full_content),
        latest_objective: s.latest_objective,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list sources'
    console.error(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as unknown
    const urlsInput = (body as { urls?: unknown })?.urls
    const runExtract = (body as { runExtract?: boolean })?.runExtract ?? true

    if (!Array.isArray(urlsInput) || urlsInput.length === 0) {
      return NextResponse.json({ error: 'urls array required and must not be empty' }, { status: 400 })
    }

    const rawUrls = urlsInput.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    if (rawUrls.length === 0) {
      return NextResponse.json({ error: 'At least one valid URL required' }, { status: 400 })
    }

    const sources = upsertSources(rawUrls)

    if (!runExtract || sources.length === 0) {
      return NextResponse.json({
        added: sources.length,
        sources: sources.map((s) => ({ id: s.id, url: s.url })),
      })
    }

    const urlToSource = new Map(sources.map((s) => [s.url, s]))
    const batches: { urls: string[]; sourceIds: number[] }[] = []
    for (let i = 0; i < sources.length; i += EXTRACT_BATCH_SIZE) {
      const chunk = sources.slice(i, i + EXTRACT_BATCH_SIZE)
      batches.push({
        urls: chunk.map((s) => s.url),
        sourceIds: chunk.map((s) => s.id),
      })
    }

    const client = getParallelClient()

    for (const batch of batches) {
      const extractResponse = await client.beta.extract({
        urls: batch.urls,
        objective: BASELINE_OBJECTIVE,
        excerpts: true,
        full_content: false,
      })

      const extractRunId = insertExtractRun({
        chatQueryId: null,
        trigger: 'add_sources',
        parallelExtractId: extractResponse.extract_id,
        warnings: extractResponse.warnings ?? null,
        usage: extractResponse.usage ?? null,
      })

      const extractedAt = new Date().toISOString()

      for (const result of extractResponse.results) {
        const source = urlToSource.get(result.url)
        if (!source) continue

        const excerpts = result.excerpts ?? []
        const fullContent = result.full_content ?? null
        const hasFullContent = fullContent != null && fullContent.length > 0

        const extractedPageId = insertExtractedPage({
          sourceId: source.id,
          extractRunId,
          extractedAt,
          title: result.title ?? null,
          publishDate: result.publish_date ?? null,
          excerpts: excerpts.length > 0 ? excerpts : null,
          fullContentMd: fullContent,
        })

        setSourceLatest({
          sourceId: source.id,
          extractedPageId,
          extractedAt,
          title: result.title ?? null,
          hasFullContent,
          objective: BASELINE_OBJECTIVE,
        })
      }

      for (const err of extractResponse.errors) {
        const source = urlToSource.get(err.url)
        if (!source) continue

        insertExtractedPage({
          sourceId: source.id,
          extractRunId,
          extractedAt,
          errorType: err.error_type,
          httpStatusCode: err.http_status_code,
          errorContent: err.content ?? null,
        })
      }
    }

    const updated = listSourcesWithLatest({ includeInactive: true })
    return NextResponse.json({
      added: sources.length,
      sources: updated.map((s) => ({
        id: s.id,
        url: s.url,
        latest_extracted_at: s.latest_extracted_at,
        latest_title: s.latest_title,
        latest_has_full_content: Boolean(s.latest_has_full_content),
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add sources'
    console.error(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
