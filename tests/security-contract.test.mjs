import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('client has no browser authority persistence or random market engine', async () => {
  const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
  assert.equal(source.includes('localStorage'), false)
  assert.equal(source.includes('Math.random'), false)
  assert.equal(source.includes("setBalance(b => b - stake)"), false)
})

test('settlement handlers fail closed without authenticated identity', async () => {
  const [lowRisk, market, duel] = await Promise.all(['api/low-risk.ts', 'api/market.ts', 'api/duel.ts'].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')))
  for (const source of [lowRisk, market, duel]) assert.match(source, /Authentication required/)
  const shared = await readFile(new URL('../api/_shared.ts', import.meta.url), 'utf8')
  assert.match(shared, /getAuthenticatedUser/)
  assert.equal(shared.includes("req.headers['x-neon-auth-user']"), false)
  assert.match(lowRisk, /idempotencyKey/)
  assert.match(market, /action === 'resolve'/)
  assert.match(duel, /action === 'join'/)
  assert.match(market, /with locked_round/)
  assert.match(duel, /with locked_duel/)
  assert.match(shared, /safeError/)
  assert.match(market, /for update|with locked_round/)
  assert.match(duel, /for update|with locked_duel/)
  assert.match(duel, /action === 'settle'/)
  assert.match(duel, /on conflict \(idempotency_key\) do nothing/)
  assert.match(market, /on conflict \(idempotency_key\) do nothing/)
})

test('financial endpoints expose no independent settlement loops', async () => {
  const market = await readFile(new URL('../api/market.ts', import.meta.url), 'utf8')
  const duel = await readFile(new URL('../api/duel.ts', import.meta.url), 'utf8')
  assert.equal(market.includes('for (const entry'), false)
  assert.equal(duel.includes('await sql`update wallets set balance = balance +'), false)
})

test('schema prevents duplicate participation and active duel opponents', async () => {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
  assert.match(schema, /game_entries_round_user_idx/)
  assert.match(schema, /duel_opponent_unique_idx/)
  assert.match(schema, /balance bigint not null default 10000 check \(balance >= 0\)/)
})
