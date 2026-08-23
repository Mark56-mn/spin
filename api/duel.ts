import { getAuthenticatedUser, bodyOf, code, db, demoOnly, fail, int, key, type Request, type Response } from './_shared'

const MAX_STAKE = 5000
export default async function handler(req: Request, res: Response) {
  const blocked = demoOnly(res); if (blocked) return blocked
  const userId = await getAuthenticatedUser(req); if (!userId) return fail(res, 401, 'Authentication required')
  let sql; try { sql = db() } catch { return fail(res, 503, 'Database unavailable') }
  const input = bodyOf(req)
  if (req.method === 'GET') {
    const duelCode = typeof input.code === 'string' ? input.code.toUpperCase() : ''
    if (!duelCode) return fail(res, 400, 'Duel code required')
    const rows = await sql`select id, code, stake, status, creator_id as "creatorId", opponent_id as "opponentId", expires_at as "expiresAt" from duels where code = ${duelCode} limit 1`
    return rows.length ? res.status(200).json(rows[0]) : fail(res, 404, 'Duel not found')
  }
  if (req.method !== 'POST') return fail(res, 405, 'GET or POST required')
  if (input.action === 'create') {
    const stake = int(input.stake); const idempotencyKey = key(input.idempotencyKey)
    if (stake === null || stake < 100 || stake > MAX_STAKE || !idempotencyKey) return fail(res, 400, 'Invalid duel request')
    const existing = await sql`select id, code, stake, status, expires_at as "expiresAt" from duels where creator_id = ${userId} and idempotency_key = ${idempotencyKey} limit 1`
    if (existing.length) return res.status(200).json({ ...existing[0], replayed: true })
    const roundId = crypto.randomUUID(); const duelCode = code()
    const rows = await sql`with locked as (select user_id from wallets where user_id = ${userId} and balance >= ${stake} for update), updated as (update wallets set balance = balance - ${stake}, updated_at = now() from locked where wallets.user_id = locked.user_id returning wallets.balance), round_row as (insert into game_rounds(id, game_type, status) select ${roundId}, 'DUEL', 'OPEN' from updated), duel_row as (insert into duels(code, round_id, creator_id, stake, idempotency_key) select ${duelCode}, ${roundId}, ${userId}, ${stake}, ${idempotencyKey} from updated returning id, code, stake, status, expires_at as "expiresAt"), ledger as (insert into ledger_entries(user_id, amount, entry_type, reference_id, idempotency_key, metadata) select ${userId}, ${-stake}, 'STAKE', ${roundId}, ${idempotencyKey}, jsonb_build_object('game','DUEL','code',${duelCode})) select * from duel_row`
    return rows.length ? res.status(201).json({ ...rows[0], replayed: false }) : fail(res, 409, 'Insufficient balance')
  }
  if (input.action === 'join') {
    const duelCode = typeof input.code === 'string' ? input.code.toUpperCase() : ''; if (!/^[A-Z0-9]{5}$/.test(duelCode)) return fail(res, 400, 'Invalid duel code')
    const joined = await sql`with locked_duel as (select id, round_id, creator_id, stake from duels where code = ${duelCode} and status = 'WAITING' and expires_at > now() for update), locked_wallet as (select user_id from wallets where user_id = ${userId} and balance >= (select stake from locked_duel) for update), wallet_row as (update wallets set balance = balance - (select stake from locked_duel), updated_at = now() where user_id = ${userId} and exists(select 1 from locked_wallet) returning user_id), duel_row as (update duels set opponent_id = ${userId}, status = 'ACTIVE' where id = (select id from locked_duel) and creator_id <> ${userId} and status = 'WAITING' and exists(select 1 from wallet_row) returning id, code, stake, round_id), ledger_row as (insert into ledger_entries(user_id, amount, entry_type, reference_id, idempotency_key, metadata) select ${userId}, -stake, 'STAKE', round_id, 'duel-join-' || id::text || '-' || ${userId}, jsonb_build_object('game','DUEL','code',code) from duel_row on conflict (idempotency_key) do nothing) select id as "duelId", code, stake from duel_row`
    if (!joined.length) return fail(res, 409, 'Duel unavailable or insufficient balance')
    return res.status(200).json({ ...joined[0], status: 'ACTIVE' })
  }
  if (input.action === 'settle') {
    const duelId = typeof input.duelId === 'string' ? input.duelId : ''
    const winnerId = typeof input.winnerId === 'string' ? input.winnerId : ''
    if (!duelId || (winnerId !== userId)) return fail(res, 403, 'Settlement authorization required')
    const rows = await sql`with locked_duel as (select id, round_id, creator_id, opponent_id, stake from duels where id = ${duelId} and status = 'ACTIVE' and (${userId} = creator_id or ${userId} = opponent_id) for update), wallet_row as (update wallets set balance = balance + (select stake * 2 from locked_duel), updated_at = now() where user_id = ${winnerId} and exists(select 1 from locked_duel) returning user_id), entry as (insert into ledger_entries(user_id, amount, entry_type, reference_id, idempotency_key, metadata) select ${winnerId}, stake * 2, 'PAYOUT', round_id, 'duel-payout-' || id::text, jsonb_build_object('game','DUEL','winnerId',${winnerId}) from locked_duel on conflict (idempotency_key) do nothing returning id), duel_row as (update duels set winner_id = ${winnerId}, status = 'SETTLED', settled_at = now() where id = (select id from locked_duel) and status = 'ACTIVE' and exists(select 1 from wallet_row) returning id, stake) select * from duel_row`
    if (!rows.length) return fail(res, 409, 'Duel already settled or unavailable')
    return res.status(200).json({ duelId, status: 'SETTLED', winnerId, payout: Number(rows[0].stake) * 2 })
  }
  if (input.action === 'cancel') {
    const duelId = typeof input.duelId === 'string' ? input.duelId : ''
    const rows = await sql`with locked_duel as (select id, round_id, stake from duels where id = ${duelId} and creator_id = ${userId} and status = 'WAITING' for update), refund_ledger as (insert into ledger_entries(user_id, amount, entry_type, reference_id, idempotency_key, metadata) select ${userId}, stake, 'REFUND', round_id, 'duel-refund-' || id::text, jsonb_build_object('game','DUEL','reason','cancelled') from locked_duel on conflict (idempotency_key) do nothing returning reference_id), wallet_row as (update wallets set balance = balance + (select stake from locked_duel), updated_at = now() where user_id = ${userId} and exists(select 1 from refund_ledger) returning balance), duel_row as (update duels set status = 'CANCELLED', settled_at = now() where id = (select id from locked_duel) and status = 'WAITING' and exists(select 1 from wallet_row) returning stake) select stake from duel_row`
    if (!rows.length) return fail(res, 409, 'Duel cannot be cancelled')
    return res.status(200).json({ status: 'CANCELLED', refunded: Number(rows[0].stake) })
  }
  return fail(res, 400, 'Unknown duel action')
}
