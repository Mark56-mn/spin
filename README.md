# SPIN

Mobile-first social prediction game. V1 uses free play-money SPIN credits.

## V1
- Low Risk game
- Fictional Market UP/DOWN game
- Duel UI placeholder
- 10,000 starter credits
- Neon Postgres schema ready for server settlement

## Run
```bash
npm install
npm run dev
```

## Production boundary
Real-money wagering, deposits and withdrawals are disabled in V1. Paystack integration should remain sandbox/test-only until licensing, merchant approval and compliance requirements are satisfied.

## Architecture
The browser is a presentation layer. Production outcomes and ledger settlement must be server-side and auditable.
