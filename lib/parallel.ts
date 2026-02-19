import 'server-only'

import Parallel from 'parallel-web'

import { getParallelApiKey } from './env'

declare global {
  var __parallelClient: Parallel | undefined
}

export function getParallelClient(): Parallel {
  if (globalThis.__parallelClient) return globalThis.__parallelClient

  const client = new Parallel({ apiKey: getParallelApiKey() })

  // Avoid creating a new client on every HMR update in dev.
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__parallelClient = client
  }

  return client
}
