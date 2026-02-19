import 'server-only'

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Add it to .env.local (see .env.example).`
    )
  }
  return value
}

export function getParallelApiKey(): string {
  return requireEnv('PARALLEL_API_KEY')
}
