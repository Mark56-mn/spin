-- SPIN V1 PostgreSQL schema for Neon
create extension if not exists pgcrypto;

create table if not exists profiles (
  id text primary key,
  username text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists wallets (
  user_id text primary key,
  currency text not null default 'SPIN',
  balance bigint not null default 10000 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  amount bigint not null,
  entry_type text not null check (entry_type in ('WELCOME','STAKE','PAYOUT','REFUND','ADJUSTMENT')),
  reference_id text,
  idempotency_key text unique,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists game_rounds (
  id uuid primary key default gen_random_uuid(),
  game_type text not null check (game_type in ('LOW_RISK','MARKET','DUEL')),
  status text not null default 'OPEN' check (status in ('OPEN','LOCKED','SETTLED','CANCELLED')),
  seed_hash text,
  seed_reveal text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  opening_price numeric(18,8),
  closing_price numeric(18,8),
  outcome text,
  duration_seconds integer,
  idempotency_key text unique
);

create table if not exists game_entries (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references game_rounds(id),
  user_id text not null,
  stake bigint not null check (stake > 0),
  choice text,
  result text,
  payout bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists market_ticks (
  id bigserial primary key,
  round_id uuid not null references game_rounds(id),
  price numeric(18,8) not null,
  tick_no integer not null,
  created_at timestamptz not null default now()
);

create table if not exists duels (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  round_id uuid unique not null references game_rounds(id),
  creator_id text not null,
  opponent_id text,
  stake bigint not null check (stake > 0),
  status text not null default 'WAITING' check (status in ('WAITING','ACTIVE','SETTLED','CANCELLED','EXPIRED')),
  creator_choice text,
  opponent_choice text,
  winner_id text,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  idempotency_key text unique
);

create unique index if not exists duel_active_creator_idx on duels(creator_id) where status in ('WAITING','ACTIVE');
create index if not exists duels_code_idx on duels(code);
create index if not exists duels_expires_idx on duels(expires_at) where status = 'WAITING';

create index if not exists ledger_user_created_idx on ledger_entries(user_id, created_at desc);
create index if not exists entries_round_idx on game_entries(round_id);
create unique index if not exists game_entries_round_user_idx on game_entries(round_id, user_id);
create index if not exists ticks_round_idx on market_ticks(round_id, tick_no);
create unique index if not exists duel_opponent_unique_idx on duels(opponent_id) where opponent_id is not null and status in ('ACTIVE','SETTLED');
