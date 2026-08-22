import { neon } from '@neondatabase/serverless'

type Request = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> }
type Response = { status: (code: number) => Response; json: (body: unknown) => Response }

function getSessionUserId(req: Request): string | null {
  const value = req.headers['x-neon-auth-user']
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' })
  const userId = getSessionUserId(req)
  if (!userId) return res.status(401).json({ error: 'Authentication required' })
  const body = req.body as { username?: unknown } | undefined
  const username = typeof body?.username === 'string' ? body.username.trim().slice(0, 24) : ''
  if (username.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' })
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'DATABASE_URL is not configured' })
  try {
    const sql = neon(process.env.DATABASE_URL)
    const rows = await sql`insert into profiles(id, username) values(${userId}, ${username}) on conflict(id) do update set username = excluded.username returning id, username`
    const user = rows[0]
    await sql`insert into wallets(user_id, balance) values(${user.id}, 10000) on conflict(user_id) do nothing`
    await sql`insert into ledger_entries(user_id, amount, entry_type, metadata) select ${user.id}, 10000, 'WELCOME', jsonb_build_object('source','v1_bootstrap') where not exists(select 1 from ledger_entries where user_id = ${user.id} and entry_type = 'WELCOME')`
    const wallet = await sql`select balance from wallets where user_id = ${user.id}`
    return res.status(200).json({ username: user.username, balance: Number(wallet[0].balance) })
  } catch {
    return res.status(500).json({ error: 'Unable to load player' })
  }
}
