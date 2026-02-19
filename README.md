# Research Agent

Minimal Next.js App Router app with a search interface and SQLite backend.

## Setup

```bash
npm install
# create/update .env.local with your API key
cp -n .env.example .env.local || true
# then edit .env.local and set PARALLEL_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Structure

- **`app/page.tsx`** - Single search text box; submits to `/api/search`
- **`app/api/search/route.ts`** - POST handler that saves queries to SQLite
- **`lib/db.ts`** - SQLite connection and schema (`searches` table)
- **`data/research.db`** - SQLite database (created on first run)

## Extending for Search APIs

In `app/api/search/route.ts`, call your search APIs after saving the query. Example:

```ts
// After saveSearch(query), add:
// const results = await fetchYourSearchAPI(query)
// saveResults(queryId, results)
```

Add new columns or tables in `lib/db.ts` as needed for storing API results.
