import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const dbPath = path.join(process.cwd(), 'data', 'research.db')

function getDb() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)
  return db
}

export function saveSearch(query: string) {
  const db = getDb()
  const stmt = db.prepare('INSERT INTO searches (query) VALUES (?)')
  stmt.run(query)
  db.close()
}

export function getSearches() {
  const db = getDb()
  const stmt = db.prepare('SELECT id, query, created_at FROM searches ORDER BY id DESC LIMIT 50')
  const rows = stmt.all() as { id: number; query: string; created_at: string }[]
  db.close()
  return rows
}
