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
  assert.match(lowRisk, /idempotencyKey/)
  assert.match(market, /action === 'resolve'/)
  assert.match(duel, /action === 'join'/)
})
