'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function Home() {
  const [query, setQuery] = useState('')
  const [fullPage, setFullPage] = useState(false)
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [citations, setCitations] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setError(null)
    setAnswer(null)
    setCitations([])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: query.trim(),
          fullPage,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? data.message ?? 'Request failed')
        if (data.answer) {
          setAnswer(data.answer)
          setCitations(data.citations ?? [])
        }
        return
      }

      setAnswer(data.answer ?? null)
      setCitations(Array.isArray(data.citations) ? data.citations : [])
      setQuery('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
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
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Research Chat</h1>
          <Link
            href="/sources"
            style={{
              fontSize: '0.875rem',
              color: '#2563eb',
              textDecoration: 'none',
            }}
          >
            Manage sources
          </Link>
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: '1.5rem' }}>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question about your sources..."
            disabled={loading}
            rows={3}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={fullPage}
                onChange={(e) => setFullPage(e.target.checked)}
                disabled={loading}
              />
              Full page
            </label>
            {fullPage && (
              <span style={{ fontSize: '0.75rem', color: '#b45309' }}>
                Slower and uses more tokens
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              background: loading ? '#f3f4f6' : '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Processing...' : 'Ask'}
          </button>
        </form>

        {error && (
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
            {error}
          </div>
        )}

        {answer && (
          <div
            style={{
              padding: '1rem',
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              whiteSpace: 'pre-wrap',
              fontSize: '0.9375rem',
              lineHeight: 1.6,
            }}
          >
            {answer}
          </div>
        )}

        {citations.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 500, color: '#6b7280', marginBottom: '0.5rem' }}>
              Citations
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8125rem' }}>
              {citations.map((url, i) => (
                <li key={i} style={{ marginBottom: '0.25rem' }}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#2563eb', wordBreak: 'break-all' }}
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  )
}
