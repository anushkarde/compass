import 'server-only'

import crypto from 'crypto'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const dbPath = path.join(process.cwd(), 'data', 'research.db')

declare global {
  // eslint-disable-next-line no-var
  var __researchDb: Database.Database | undefined
  // eslint-disable-next-line no-var
  var __researchDbInitialized: boolean | undefined
}

function initSchema(db: Database.Database) {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TRIGGER IF NOT EXISTS trg_sources_updated_at
    AFTER UPDATE ON sources
    FOR EACH ROW
    BEGIN
      UPDATE sources SET updated_at = datetime('now') WHERE id = NEW.id;
    END;

    CREATE TABLE IF NOT EXISTS chat_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      full_page INTEGER NOT NULL,
      router_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_query_extract_params (
      chat_query_id INTEGER UNIQUE NOT NULL,
      objective TEXT NOT NULL,
      search_queries_json TEXT,
      excerpts_json TEXT NOT NULL,
      full_content_json TEXT NOT NULL,
      fetch_policy_json TEXT,
      parallel_beta_header TEXT NOT NULL DEFAULT 'search-extract-2025-10-10',
      FOREIGN KEY (chat_query_id) REFERENCES chat_queries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS extract_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_query_id INTEGER,
      trigger TEXT NOT NULL,
      parallel_extract_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      warnings_json TEXT,
      usage_json TEXT,
      FOREIGN KEY (chat_query_id) REFERENCES chat_queries(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS extracted_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      extract_run_id INTEGER NOT NULL,
      extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
      title TEXT,
      publish_date TEXT,
      excerpts_json TEXT,
      full_content_md TEXT,
      content_sha256 TEXT,
      error_type TEXT,
      http_status_code INTEGER,
      error_content TEXT,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
      FOREIGN KEY (extract_run_id) REFERENCES extract_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS source_latest (
      source_id INTEGER PRIMARY KEY,
      latest_extracted_page_id INTEGER NOT NULL,
      latest_extracted_at TEXT NOT NULL,
      latest_title TEXT,
      latest_has_full_content INTEGER NOT NULL,
      latest_objective TEXT,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
      FOREIGN KEY (latest_extracted_page_id) REFERENCES extracted_pages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_extracted_pages_source_extracted_at
      ON extracted_pages(source_id, extracted_at DESC);

    CREATE INDEX IF NOT EXISTS idx_extract_runs_chat_query_id
      ON extract_runs(chat_query_id);

    -- Legacy table used by the initial scaffolded /api/search endpoint.
    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

function getDb(): Database.Database {
  if (globalThis.__researchDb && globalThis.__researchDbInitialized) {
    return globalThis.__researchDb
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = globalThis.__researchDb ?? new Database(dbPath)
  globalThis.__researchDb = db

  if (!globalThis.__researchDbInitialized) {
    initSchema(db)
    globalThis.__researchDbInitialized = true
  }

  return db
}

function canonicalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  const parsed = new URL(trimmed)
  parsed.hash = ''

  parsed.protocol = parsed.protocol.toLowerCase()
  parsed.hostname = parsed.hostname.toLowerCase()

  if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
    parsed.port = ''
  }

  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  }

  return parsed.toString()
}

function toJson(value: unknown): string {
  return JSON.stringify(value)
}

function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

export type SourceRow = {
  id: number
  url: string
  created_at: string
  updated_at: string
  is_active: number
}

export type SourceWithLatestRow = SourceRow & {
  latest_extracted_page_id: number | null
  latest_extracted_at: string | null
  latest_title: string | null
  latest_has_full_content: number | null
  latest_objective: string | null
}

export type ChatQueryRow = {
  id: number
  question: string
  created_at: string
  full_page: number
  router_reason: string | null
}

export type ExtractRunTrigger = 'chat' | 'add_sources' | 'refresh'

export function upsertSource(rawUrl: string, opts?: { isActive?: boolean }): SourceRow {
  const db = getDb()
  const url = canonicalizeUrl(rawUrl)
  const isActive = opts?.isActive ?? true

  const stmt = db.prepare(`
    INSERT INTO sources (url, is_active)
    VALUES (@url, @is_active)
    ON CONFLICT(url) DO UPDATE SET
      is_active = excluded.is_active,
      updated_at = datetime('now')
  `)

  stmt.run({ url, is_active: isActive ? 1 : 0 })

  return db
    .prepare(
      `SELECT id, url, created_at, updated_at, is_active
       FROM sources
       WHERE url = ?`
    )
    .get(url) as SourceRow
}

export function upsertSources(rawUrls: string[], opts?: { isActive?: boolean }): SourceRow[] {
  const db = getDb()
  const isActive = opts?.isActive ?? true

  const insert = db.prepare(`
    INSERT INTO sources (url, is_active)
    VALUES (@url, @is_active)
    ON CONFLICT(url) DO UPDATE SET
      is_active = excluded.is_active,
      updated_at = datetime('now')
  `)

  const select = db.prepare(
    `SELECT id, url, created_at, updated_at, is_active
     FROM sources
     WHERE url = ?`
  )

  const tx = db.transaction((urls: string[]) => {
    const rows: SourceRow[] = []
    for (const rawUrl of urls) {
      const url = canonicalizeUrl(rawUrl)
      insert.run({ url, is_active: isActive ? 1 : 0 })
      rows.push(select.get(url) as SourceRow)
    }
    return rows
  })

  return tx(rawUrls)
}

export function listSourcesWithLatest(opts?: { includeInactive?: boolean }): SourceWithLatestRow[] {
  const db = getDb()
  const includeInactive = opts?.includeInactive ?? false

  const rows = db
    .prepare(
      `
      SELECT
        s.id, s.url, s.created_at, s.updated_at, s.is_active,
        sl.latest_extracted_page_id,
        sl.latest_extracted_at,
        sl.latest_title,
        sl.latest_has_full_content,
        sl.latest_objective
      FROM sources s
      LEFT JOIN source_latest sl ON sl.source_id = s.id
      WHERE (@include_inactive = 1 OR s.is_active = 1)
      ORDER BY s.updated_at DESC, s.id DESC
      `
    )
    .all({ include_inactive: includeInactive ? 1 : 0 }) as SourceWithLatestRow[]

  return rows
}

export function getActiveSources(): SourceRow[] {
  const db = getDb()
  return db
    .prepare(`SELECT id, url, created_at, updated_at, is_active FROM sources WHERE is_active = 1 ORDER BY id ASC`)
    .all() as SourceRow[]
}

export function insertChatQuery(input: {
  question: string
  fullPage: boolean
  routerReason?: string | null
}): number {
  const db = getDb()
  const result = db
    .prepare(`INSERT INTO chat_queries (question, full_page, router_reason) VALUES (@question, @full_page, @router_reason)`)
    .run({
      question: input.question,
      full_page: input.fullPage ? 1 : 0,
      router_reason: input.routerReason ?? null,
    })

  return Number(result.lastInsertRowid)
}

export type ExtractParamsInput = {
  objective: string
  searchQueries: string[] | null
  excerpts: true | Record<string, unknown>
  fullContent: boolean | Record<string, unknown>
  fetchPolicy: Record<string, unknown> | null
  parallelBetaHeader?: string
}

export function upsertChatQueryExtractParams(chatQueryId: number, params: ExtractParamsInput) {
  const db = getDb()
  db.prepare(
    `
    INSERT INTO chat_query_extract_params (
      chat_query_id,
      objective,
      search_queries_json,
      excerpts_json,
      full_content_json,
      fetch_policy_json,
      parallel_beta_header
    ) VALUES (
      @chat_query_id,
      @objective,
      @search_queries_json,
      @excerpts_json,
      @full_content_json,
      @fetch_policy_json,
      @parallel_beta_header
    )
    ON CONFLICT(chat_query_id) DO UPDATE SET
      objective = excluded.objective,
      search_queries_json = excluded.search_queries_json,
      excerpts_json = excluded.excerpts_json,
      full_content_json = excluded.full_content_json,
      fetch_policy_json = excluded.fetch_policy_json,
      parallel_beta_header = excluded.parallel_beta_header
    `
  ).run({
    chat_query_id: chatQueryId,
    objective: params.objective,
    search_queries_json: params.searchQueries ? toJson(params.searchQueries) : null,
    excerpts_json: toJson(params.excerpts),
    full_content_json: toJson(params.fullContent),
    fetch_policy_json: params.fetchPolicy ? toJson(params.fetchPolicy) : null,
    parallel_beta_header: params.parallelBetaHeader ?? 'search-extract-2025-10-10',
  })
}

export function insertExtractRun(input: {
  chatQueryId: number | null
  trigger: ExtractRunTrigger
  parallelExtractId: string
  warnings: unknown | null
  usage: unknown | null
}): number {
  const db = getDb()
  const result = db
    .prepare(
      `
      INSERT INTO extract_runs (chat_query_id, trigger, parallel_extract_id, warnings_json, usage_json)
      VALUES (@chat_query_id, @trigger, @parallel_extract_id, @warnings_json, @usage_json)
      `
    )
    .run({
      chat_query_id: input.chatQueryId,
      trigger: input.trigger,
      parallel_extract_id: input.parallelExtractId,
      warnings_json: input.warnings ? toJson(input.warnings) : null,
      usage_json: input.usage ? toJson(input.usage) : null,
    })

  return Number(result.lastInsertRowid)
}

export type InsertExtractedPageInput = {
  sourceId: number
  extractRunId: number
  extractedAt?: string
  title?: string | null
  publishDate?: string | null
  excerpts?: string[] | null
  fullContentMd?: string | null
  errorType?: string | null
  httpStatusCode?: number | null
  errorContent?: string | null
}

export function insertExtractedPage(input: InsertExtractedPageInput): number {
  const db = getDb()

  const excerptsJson = input.excerpts ? toJson(input.excerpts) : null
  const fullContent = input.fullContentMd ?? null

  const contentForHash = [
    input.title ?? '',
    input.publishDate ?? '',
    excerptsJson ?? '',
    fullContent ?? '',
  ].join('\n---\n')

  const contentSha = contentForHash.trim() ? sha256Hex(contentForHash) : null

  const result = db
    .prepare(
      `
      INSERT INTO extracted_pages (
        source_id,
        extract_run_id,
        extracted_at,
        title,
        publish_date,
        excerpts_json,
        full_content_md,
        content_sha256,
        error_type,
        http_status_code,
        error_content
      ) VALUES (
        @source_id,
        @extract_run_id,
        @extracted_at,
        @title,
        @publish_date,
        @excerpts_json,
        @full_content_md,
        @content_sha256,
        @error_type,
        @http_status_code,
        @error_content
      )
      `
    )
    .run({
      source_id: input.sourceId,
      extract_run_id: input.extractRunId,
      extracted_at: input.extractedAt ?? new Date().toISOString(),
      title: input.title ?? null,
      publish_date: input.publishDate ?? null,
      excerpts_json: excerptsJson,
      full_content_md: fullContent,
      content_sha256: contentSha,
      error_type: input.errorType ?? null,
      http_status_code: input.httpStatusCode ?? null,
      error_content: input.errorContent ?? null,
    })

  return Number(result.lastInsertRowid)
}

export function setSourceLatest(input: {
  sourceId: number
  extractedPageId: number
  extractedAt: string
  title: string | null
  hasFullContent: boolean
  objective: string | null
}) {
  const db = getDb()
  db.prepare(
    `
    INSERT INTO source_latest (
      source_id,
      latest_extracted_page_id,
      latest_extracted_at,
      latest_title,
      latest_has_full_content,
      latest_objective
    ) VALUES (
      @source_id,
      @latest_extracted_page_id,
      @latest_extracted_at,
      @latest_title,
      @latest_has_full_content,
      @latest_objective
    )
    ON CONFLICT(source_id) DO UPDATE SET
      latest_extracted_page_id = excluded.latest_extracted_page_id,
      latest_extracted_at = excluded.latest_extracted_at,
      latest_title = excluded.latest_title,
      latest_has_full_content = excluded.latest_has_full_content,
      latest_objective = excluded.latest_objective
    `
  ).run({
    source_id: input.sourceId,
    latest_extracted_page_id: input.extractedPageId,
    latest_extracted_at: input.extractedAt,
    latest_title: input.title,
    latest_has_full_content: input.hasFullContent ? 1 : 0,
    latest_objective: input.objective,
  })
}

export function saveSearch(query: string) {
  const db = getDb()
  const stmt = db.prepare('INSERT INTO searches (query) VALUES (?)')
  stmt.run(query)
}

export function getSearches() {
  const db = getDb()
  const stmt = db.prepare('SELECT id, query, created_at FROM searches ORDER BY id DESC LIMIT 50')
  return stmt.all() as { id: number; query: string; created_at: string }[]
}
