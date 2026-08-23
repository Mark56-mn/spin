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
  assert.match(shared, /transaction/)
  assert.match(shared, /safeError/)
  assert.match(market, /for update|transaction/)
  assert.match(duel, /for update/)
})

test('schema prevents duplicate participation and active duel opponents', async () => {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
  assert.match(schema, /game_entries_round_user_idx/)
  assert.match(schema, /duel_opponent_unique_idx/)
  assert.match(schema, /balance bigint not null default 10000 check \(balance >= 0\)/)
})
