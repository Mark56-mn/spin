import { neon } from '@neondatabase/serverless'
type VercelRequest = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> }
type VercelResponse = { status: (code: number) => VercelResponse; json: (body: unknown) => VercelResponse }

type Risk = 'LOW' | 'BALANCED' | 'HIGH'
const PAYOUT_BPS: Record<Risk, { win: number; loss: number }> = {
  LOW: { win: 9000, loss: 1000 },
  BALANCED: { win: 5000, loss: 5000 },
  HIGH: { win: 7000, loss: 7000 },
}
const MAX_DEMO_STAKE = Number(process.env.MAX_DEMO_STAKE || 5000)

function getSessionUserId(req: VercelRequest): string | null {
  // The identity must be injected by the authenticated edge/session layer.
  // Never accept userId from a JSON body or query string.
  const value = req.headers['x-neon-auth-user']
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' })
  if (process.env.REAL_MONEY_ENABLED === 'true') return res.status(503).json({ error: 'Demo mode is required' })

  const userId = getSessionUserId(req)
  if (!userId) return res.status(401).json({ error: 'Authentication required' })

  const body = req.body as { risk?: unknown; stake?: unknown; idempotencyKey?: unknown } | undefined
  const risk = body?.risk
  const stake = body?.stake
  const idempotencyKey = body?.idempotencyKey
  if (!Object.hasOwn(PAYOUT_BPS, risk as string) || !Number.isInteger(stake) || Number(stake) < 100 || Number(stake) > MAX_DEMO_STAKE) {
    return res.status(400).json({ error: 'Invalid risk or stake' })
  }
  if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid idempotency key' })
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'DATABASE_URL is not configured' })

  const amount = Number(stake)
  const selectedRisk = risk as Risk
  const sql = neon(process.env.DATABASE_URL)
  const existing = await sql`select metadata, amount from ledger_entries where idempotency_key = ${idempotencyKey} limit 1`
  if (existing.length) {
    const metadata = existing[0].metadata as { roundId?: string; result?: string; profit?: number }
    const wallet = await sql`select balance from wallets where user_id = ${userId}`
    if (!wallet.length) return res.status(401).json({ error: 'Authentication required' })
    return res.status(200).json({ roundId: metadata.roundId, result: metadata.result, profit: metadata.profit, balance: Number(wallet[0].balance), replayed: true })
  }

  const roundId = crypto.randomUUID()
  const won = crypto.getRandomValues(new Uint32Array(1))[0] % 100 < 50
  const profit = won ? Math.floor(amount * PAYOUT_BPS[selectedRisk].win / 10000) : -Math.floor(amount * PAYOUT_BPS[selectedRisk].loss / 10000)
  const payout = won ? amount + profit : 0
  const rows = await sql`
    with locked as (select user_id from wallets where user_id = ${userId} and balance >= ${amount} for update),
    updated as (update wallets set balance = balance - ${amount} + ${won ? payout : 0}, updated_at = now() from locked where wallets.user_id = locked.user_id returning wallets.balance),
    round_row as (insert into game_rounds(id, game_type, status, seed_reveal, settled_at) select ${roundId}, 'LOW_RISK', 'SETTLED', ${selectedRisk}, now() from updated),
    entry_row as (insert into game_entries(round_id, user_id, stake, choice, result, payout) select ${roundId}, ${userId}, ${amount}, 'SPIN', ${won ? 'WIN' : 'LOSS'}, ${payout} from updated),
    stake_row as (insert into ledger_entries(user_id, amount, entry_type, reference_id, idempotency_key, metadata) select ${userId}, ${-amount}, 'STAKE', ${roundId}, ${idempotencyKey}, jsonb_build_object('game','LOW_RISK','risk',${selectedRisk}) from updated)
    insert into ledger_entries(user_id, amount, entry_type, reference_id, metadata) select ${userId}, ${payout}, 'PAYOUT', ${roundId}, jsonb_build_object('game','LOW_RISK','risk',${selectedRisk},'result',${won ? 'WIN' : 'LOSS'},'profit',${profit}) from updated returning amount`
  if (!rows.length) return res.status(409).json({ error: 'Insufficient balance' })
  const wallet = await sql`select balance from wallets where user_id = ${userId}`
  return res.status(200).json({ roundId, result: won ? 'WIN' : 'LOSS', profit, balance: Number(wallet[0].balance), replayed: false })
}
