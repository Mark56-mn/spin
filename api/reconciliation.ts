import { getAuthenticatedUser, db, fail, type Request, type Response } from './_shared'

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'GET') return fail(res, 405, 'GET required')
  const userId = await getAuthenticatedUser(req)
  if (!userId) return fail(res, 401, 'Authentication required')
  let sql
  try { sql = db() } catch { return fail(res, 503, 'Database unavailable') }
  try {
    const rows = await sql`
      select
        w.balance,
        coalesce((select sum(amount) from ledger_entries where user_id = ${userId}), 0) as "ledgerBalance",
        (select count(*) from ledger_entries where user_id = ${userId} and amount = 0) as "zeroEntries",
        (select count(*) from game_entries where user_id = ${userId} and payout < 0) as "negativePayouts"
      from wallets w where w.user_id = ${userId}`
    if (!rows.length) return fail(res, 404, 'Wallet not found')
    const balance = Number(rows[0].balance)
    const ledgerBalance = Number(rows[0].ledgerBalance)
    return res.status(200).json({ balance, ledgerBalance, delta: balance - ledgerBalance, healthy: balance >= 0 && Number(rows[0].zeroEntries) === 0 && Number(rows[0].negativePayouts) === 0 })
  } catch { return fail(res, 503, 'Reconciliation unavailable') }
}
