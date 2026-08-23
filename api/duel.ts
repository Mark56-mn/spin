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
    const rows = await sql`select id, round_id as "roundId", creator_id as "creatorId", stake, status from duels where code = ${duelCode} and status = 'WAITING' and expires_at > now() for update`
    if (!rows.length) return fail(res, 409, 'Duel unavailable')
    if (rows[0].creatorId === userId) return fail(res, 409, 'You cannot join your own duel')
    const balance = await sql`update wallets set balance = balance - ${rows[0].stake}, updated_at = now() where user_id = ${userId} and balance >= ${rows[0].stake} returning balance`
    if (!balance.length) return fail(res, 409, 'Insufficient balance')
    await sql`update duels set opponent_id = ${userId}, status = 'ACTIVE' where id = ${rows[0].id} and status = 'WAITING'`
    await sql`insert into ledger_entries(user_id, amount, entry_type, reference_id, metadata) values(${userId}, ${-Number(rows[0].stake)}, 'STAKE', ${rows[0].roundId}, jsonb_build_object('game','DUEL','code',${duelCode}))`
    return res.status(200).json({ duelId: rows[0].id, code: duelCode, status: 'ACTIVE', stake: Number(rows[0].stake) })
  }
  if (input.action === 'cancel') {
    const duelId = typeof input.duelId === 'string' ? input.duelId : ''
    const rows = await sql`update duels set status = 'CANCELLED', settled_at = now() where id = ${duelId} and creator_id = ${userId} and status = 'WAITING' returning round_id as "roundId", stake`
    if (!rows.length) return fail(res, 409, 'Duel cannot be cancelled')
    await sql`update wallets set balance = balance + ${rows[0].stake}, updated_at = now() where user_id = ${userId}`
    await sql`insert into ledger_entries(user_id, amount, entry_type, reference_id, metadata) values(${userId}, ${rows[0].stake}, 'REFUND', ${rows[0].roundId}, jsonb_build_object('game','DUEL','reason','cancelled'))`
    return res.status(200).json({ status: 'CANCELLED', refunded: Number(rows[0].stake) })
  }
  return fail(res, 400, 'Unknown duel action')
}
