'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

type SourceItem = {
  id: number
  url: string
  created_at: string
  updated_at: string
  is_active: boolean
  latest_extracted_at: string | null
  latest_title: string | null
  latest_has_full_content: boolean
  latest_objective: string | null
}

export default function SourcesPage() {
  const [urlsText, setUrlsText] = useState('')
  const [loading, setLoading] = useState(false)
  const [sources, setSources] = useState<SourceItem[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const fetchSources = async () => {
    try {
      setFetchError(null)
      const res = await fetch('/api/urls')
      const data = await res.json()
      if (!res.ok) {
        setFetchError(data.error ?? 'Failed to load sources')
        return
      }
      setSources(data.sources ?? [])
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load sources')
    }
  }

  useEffect(() => {
    fetchSources()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const lines = urlsText
      .split(/[\n\r]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length === 0) return

    setLoading(true)
    setSubmitError(null)

    try {
      const res = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: lines, runExtract: true }),
      })

      const data = await res.json()

      if (!res.ok) {
        setSubmitError(data.error ?? 'Failed to add URLs')
        return
      }

      setUrlsText('')
      await fetchSources()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to add URLs')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Never'
    try {
      const d = new Date(iso)
      return d.toLocaleString()
    } catch {
      return iso
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1.5rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Manage sources</h1>
          <Link
            href="/"
            style={{
              fontSize: '0.875rem',
              color: '#2563eb',
              textDecoration: 'none',
            }}
          >
            Back to chat
          </Link>
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
            Add URLs (one per line)
          </label>
          <textarea
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={'https://example.com/page1\nhttps://example.com/page2'}
            disabled={loading}
            rows={5}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '1rem',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="submit"
            disabled={loading || !urlsText.trim()}
            style={{
              marginTop: '0.5rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              background: loading ? '#f3f4f6' : '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Adding and extracting...' : 'Add URLs'}
          </button>
        </form>

        {submitError && (
          <div
            style={{
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: '#b91c1c',
            }}
          >
            {submitError}
          </div>
        )}

        {fetchError && (
          <div
            style={{
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: '#b91c1c',
            }}
          >
            {fetchError}
          </div>
        )}

        <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
          Sources ({sources.length})
        </div>
        {sources.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
            No sources yet. Add URLs above to get started.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {sources.map((s) => (
              <li
                key={s.id}
                style={{
                  padding: '0.75rem 1rem',
                  marginBottom: '0.5rem',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                }}
              >
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '0.875rem',
                    color: '#2563eb',
                    wordBreak: 'break-all',
                    display: 'block',
                    marginBottom: '0.25rem',
                  }}
                >
                  {s.url}
                </a>
                {s.latest_title && (
                  <div style={{ fontSize: '0.8125rem', color: '#4b5563', marginBottom: '0.25rem' }}>
                    {s.latest_title}
                  </div>
                )}
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                  Last extracted: {formatDate(s.latest_extracted_at)}
                  {s.latest_has_full_content && ' (full content)'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
