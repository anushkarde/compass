import { NextResponse } from 'next/server'

import {
  getActiveSources,
  insertChatQuery,
  insertExtractRun,
  insertExtractedPage,
  setSourceLatest,
  upsertChatQueryExtractParams,
} from '@/lib/db'
import { generateChatAnswer } from '@/lib/chat-answer'
import { getParallelClient } from '@/lib/parallel'
import { routeExtractParamsForChat } from '@/lib/routing'

const EXTRACT_BATCH_SIZE = 10

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as unknown
    const question = typeof (body as { question?: unknown })?.question === 'string' ? (body as { question: string }).question : ''
    const fullPage = Boolean((body as { fullPage?: boolean })?.fullPage)

    if (!question.trim()) {
      return NextResponse.json({ error: 'Question required' }, { status: 400 })
    }

    const sources = getActiveSources()
    const urlCount = sources.length

    if (urlCount === 0) {
      return NextResponse.json(
        {
          error: 'No sources configured',
          message: 'Add URLs in Sources before asking questions.',
          answer: null,
          citations: [],
        },
        { status: 400 }
      )
    }

    const routed = await routeExtractParamsForChat({
      question: question.trim(),
      fullPage,
      urlCount,
    })

    const chatQueryId = insertChatQuery({
      question: question.trim(),
      fullPage,
      routerReason: routed.routerReasonJson,
    })

    upsertChatQueryExtractParams(chatQueryId, {
      objective: routed.objective,
      searchQueries: routed.searchQueries,
      excerpts: routed.excerpts,
      fullContent: routed.fullContent,
      fetchPolicy: null,
    })

    const urlToSource = new Map(sources.map((s) => [s.url, s]))
    const sourceEvidence: { url: string; content: string }[] = []

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
      const extractParams = {
        urls: batch.urls,
        objective: routed.objective,
        search_queries: routed.searchQueries,
        excerpts: true,
        full_content: routed.fullContent,
      }

      const extractResponse = await client.beta.extract(extractParams)

      const extractRunId = insertExtractRun({
        chatQueryId,
        trigger: 'chat',
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
        const contentForDb = fullContent ?? excerpts.join('\n\n')
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
          objective: routed.objective,
        })

        sourceEvidence.push({
          url: result.url,
          content: contentForDb,
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

    if (sourceEvidence.length === 0) {
      return NextResponse.json({
        answer: 'No content could be extracted from the configured sources. Please check that the URLs are valid and accessible.',
        citations: [],
        chatQueryId,
      })
    }

    const { answer, citations } = await generateChatAnswer(question.trim(), sourceEvidence)

    return NextResponse.json({
      answer,
      citations,
      chatQueryId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to process chat request'
    console.error(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
