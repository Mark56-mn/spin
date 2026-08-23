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
    const rows = await sql`with round_row as (insert into game_rounds(id, game_type, status, seed_hash, opening_price, duration_seconds, idempotency_key) values(${roundId}, 'MARKET', 'OPEN', encode(digest(${seed}, 'sha256'), 'hex'), ${opening}, ${duration}, ${idempotencyKey}) returning id, status, opening_price as "openingPrice", created_at as "createdAt"), tick_row as (insert into market_ticks(round_id, price, tick_no) select id, ${opening}, 0 from round_row) select * from round_row`
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
    const closing = 100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 200 - 95) / 100
    const outcome = closing >= 100 ? 'UP' : 'DOWN'
    const settled = await sql`with locked_round as (select id from game_rounds where id = ${roundId} and game_type = 'MARKET' and status in ('OPEN','LOCKED') for update), pending as (select id, user_id, stake, choice, (choice = ${outcome}) as won from game_entries join locked_round on locked_round.id = game_entries.round_id where result = 'PENDING' order by user_id for update), wallet_rows as (update wallets w set balance = w.balance + coalesce((select sum(case when p.won then p.stake * 2 else 0 end) from pending p where p.user_id = w.user_id), 0), updated_at = now() where w.user_id in (select user_id from pending) returning w.user_id), entry_rows as (update game_entries e set result = case when p.won then 'WIN' else 'LOSS' end, payout = case when p.won then p.stake * 2 else 0 end from pending p where e.id = p.id returning e.user_id, e.stake, e.payout, e.id), payout_rows as (insert into ledger_entries(user_id, amount, entry_type, reference_id, idempotency_key, metadata) select user_id, payout, 'PAYOUT', ${roundId}, 'market-payout-' || id::text, jsonb_build_object('game','MARKET','result',case when payout > 0 then 'WIN' else 'LOSS' end) from entry_rows where payout > 0 on conflict (idempotency_key) do nothing returning id), round_row as (update game_rounds set status = 'SETTLED', closing_price = ${closing}, outcome = ${outcome}, settled_at = now() where id = ${roundId} and exists(select 1 from locked_round) returning id) select id from round_row`
    if (!settled.length) {
      const current = await sql`select status from game_rounds where id = ${roundId} and game_type = 'MARKET'`
      if (current[0]?.status === 'SETTLED') return res.status(200).json({ status: 'SETTLED', roundId, replayed: true })
      return fail(res, current.length ? 409 : 404, current.length ? 'Round cannot be settled' : 'Round not found')
    }
    return res.status(200).json({ roundId, status: 'SETTLED', closing, outcome })
  }
  return fail(res, 400, 'Unknown market action')
}
