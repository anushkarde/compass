import { NextResponse } from 'next/server'
import { saveSearch } from '@/lib/db'

export async function POST(request: Request) {
  try {
    const { query } = await request.json()
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query required' }, { status: 400 })
    }
    saveSearch(query)
    return NextResponse.json({ saved: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to save search' }, { status: 500 })
  }
}
