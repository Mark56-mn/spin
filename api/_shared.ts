import { neon } from '@neondatabase/serverless'

export type Request = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> }
export type Response = { status: (code: number) => Response; json: (body: unknown) => Response }

export function authUserId(req: Request) {
  const value = req.headers['x-neon-auth-user']
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null
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
