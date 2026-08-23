import { neon } from '@neondatabase/serverless'

export type Request = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> }
export type Response = { status: (code: number) => Response; json: (body: unknown) => Response; setHeader?: (name: string, value: string | string[]) => void }

export async function getAuthenticatedUser(req: Request): Promise<string | null> {
  const cookie = req.headers.cookie
  const authorization = req.headers.authorization
  const baseUrl = process.env.NEON_AUTH_BASE_URL
  if (!baseUrl || (typeof cookie !== 'string' && typeof authorization !== 'string')) return null
  try {
    const response = await fetch(`${baseUrl.replace(/\\/$/, '')}/get-session`, { headers: { ...(typeof cookie === 'string' ? { cookie } : {}), ...(typeof authorization === 'string' ? { authorization } : {}) }, cache: 'no-store' })
    if (!response.ok) return null
    const payload = await response.json() as { user?: { id?: unknown } }
    const id = payload.user?.id
    return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(id) ? id : null
  } catch { return null }
}

export function bodyOf(req: Request) { return (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown> }
export function int(value: unknown) { return typeof value === 'number' && Number.isInteger(value) ? value : null }
export function key(value: unknown) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value) ? value : null }
export function db() { if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured'); return neon(process.env.DATABASE_URL) }
export function fail(res: Response, code: number, error: string) { return res.status(code).json({ error }) }
export function demoOnly(res: Response) { return process.env.REAL_MONEY_ENABLED === 'true' ? fail(res, 503, 'Demo mode is required') : null }
export function serverSeed() { return crypto.getRandomValues(new Uint32Array(4)).join('-') }
export function code() { return crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 5).toUpperCase() }
export function jsonRows(rows: unknown[]) { return rows[0] ?? null }
export function safeError(error: unknown) { return process.env.NODE_ENV === 'production' ? 'Request could not be completed' : error instanceof Error ? error.message : 'Request could not be completed' }
