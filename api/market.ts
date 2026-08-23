import { getAuthenticatedUser, bodyOf, db, demoOnly, fail, int, key, serverSeed, type Request, type Response } from './_shared'

const MAX_STAKE = 5000
const duration = 15

export default async function handler(req: Request, res: Response) {
  const blocked = demoOnly(res); if (blocked) return blocked
  const userId = await getAuthenticatedUser(req); if (!userId) return fail(res, 401, 'Authentication required')
  let sql; try { sql = db() } catch { return fail(res, 503, 'Database unavailable') }
  const input = bodyOf(req)
  if (req.method === 'GET') {
    const rows = await sql`select id, status, opening_price as "openingPrice", closing_price as "closingPrice", outcome, duration_seconds as "durationSeconds", created_at as "createdAt" from game_rounds where game_type = 'MARKET' and status in ('OPEN','LOCKED') order by created_at desc limit 1`
    return res.status(200).json(rows[0] ?? { status: 'NONE' })
  }
  if (req.method !== 'POST') return fail(res, 405, 'GET or POST required')
  const action = input.action
  if (action === 'create') {
    const idempotencyKey = key(input.idempotencyKey); if (!idempotencyKey) return fail(res, 400, 'Invalid idempotency key')
    const existing = await sql`select id, status, opening_price as "openingPrice", created_at as "createdAt" from game_rounds where idempotency_key = ${idempotencyKey} limit 1`
    if (existing.length) return res.status(200).json({ ...existing[0], replayed: true })
    const roundId = crypto.randomUUID(); const seed = serverSeed(); const opening = 100
    const rows = await sql`insert into game_rounds(id, game_type, status, seed_hash, opening_price, duration_seconds, idempotency_key) values(${roundId}, 'MARKET', 'OPEN', encode(digest(${seed}, 'sha256'), 'hex'), ${opening}, ${duration}, ${idempotencyKey}) returning id, status, opening_price as "openingPrice", created_at as "createdAt"`
    await sql`insert into market_ticks(round_id, price, tick_no) values(${roundId}, ${opening}, 0)`
    return res.status(201).json({ ...rows[0], replayed: false })
  }
  if (action === 'participate') {
    const roundId = typeof input.roundId === 'string' ? input.roundId : ''; const stake = int(input.stake); const side = input.side
    const idempotencyKey = key(input.idempotencyKey)
    if (!roundId || !idempotencyKey || (side !== 'UP' && side !== 'DOWN') || stake === null || stake < 100 || stake > MAX_STAKE) return fail(res, 400, 'Invalid market position')
    const duplicate = await sql`select metadata from ledger_entries where user_id = ${userId} and idempotency_key = ${idempotencyKey} limit 1`
    if (duplicate.length) return res.status(200).json({ ...(duplicate[0].metadata as object), replayed: true })
    const rows = await sql`with locked as (select user_id from wallets where user_id = ${userId} and balance >= ${stake} for update), updated as (update wallets set balance = balance - ${stake}, updated_at = now() from locked where wallets.user_id = locked.user_id returning wallets.balance), entry as (insert into game_entries(round_id, user_id, stake, choice, result, payout) select ${roundId}, ${userId}, ${stake}, ${side}, 'PENDING', 0 from updated returning id), ledger as (insert into ledger_entries(user_id, amount, entry_type, reference_id, idempotency_key, metadata) select ${userId}, ${-stake}, 'STAKE', ${roundId}, ${idempotencyKey}, jsonb_build_object('game','MARKET','side',${side},'stake',${stake}) from updated) select balance from updated`
    if (!rows.length) return fail(res, 409, 'Insufficient balance or round unavailable')
    return res.status(201).json({ roundId, side, stake, balance: Number(rows[0].balance), status: 'PENDING' })
  }
  if (action === 'resolve') {
    const roundId = typeof input.roundId === 'string' ? input.roundId : ''; if (!roundId) return fail(res, 400, 'Round required')
    const rows = await sql`select id, opening_price as "openingPrice", status from game_rounds where id = ${roundId} and game_type = 'MARKET' limit 1`
    if (!rows.length) return fail(res, 404, 'Round not found')
    if (rows[0].status === 'SETTLED') return res.status(200).json({ status: 'SETTLED', roundId })
    const closing = Number(rows[0].openingPrice) + (crypto.getRandomValues(new Uint32Array(1))[0] % 200 - 95) / 100
    const outcome = closing >= Number(rows[0].openingPrice) ? 'UP' : 'DOWN'
    await sql`update game_rounds set status = 'SETTLED', closing_price = ${closing}, outcome = ${outcome}, settled_at = now() where id = ${roundId} and status <> 'SETTLED'`
    const entries = await sql`select id, user_id, stake, choice from game_entries where round_id = ${roundId} and result = 'PENDING'`
    for (const entry of entries) {
      const won = entry.choice === outcome; const payout = won ? Number(entry.stake) * 2 : 0; const profit = payout - Number(entry.stake)
      await sql`update wallets set balance = balance + ${payout}, updated_at = now() where user_id = ${entry.user_id}`
      await sql`update game_entries set result = ${won ? 'WIN' : 'LOSS'}, payout = ${payout} where id = ${entry.id}`
      if (payout) await sql`insert into ledger_entries(user_id, amount, entry_type, reference_id, metadata) values(${entry.user_id}, ${payout}, 'PAYOUT', ${roundId}, jsonb_build_object('game','MARKET','result',${won ? 'WIN' : 'LOSS'},'profit',${profit}))`
    }
    return res.status(200).json({ roundId, status: 'SETTLED', closing, outcome })
  }
  return fail(res, 400, 'Unknown market action')
}
