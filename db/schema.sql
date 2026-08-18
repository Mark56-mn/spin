-- SPIN V1 PostgreSQL schema for Neon
create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists wallets (
  user_id uuid primary key references profiles(id) on delete cascade,
  currency text not null default 'SPIN',
  balance bigint not null default 10000 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  amount bigint not null,
  entry_type text not null check (entry_type in ('WELCOME','STAKE','PAYOUT','REFUND','ADJUSTMENT')),
  reference_id uuid,
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
  settled_at timestamptz
);

create table if not exists game_entries (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references game_rounds(id),
  user_id uuid not null references profiles(id),
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

create index if not exists ledger_user_created_idx on ledger_entries(user_id, created_at desc);
create index if not exists entries_round_idx on game_entries(round_id);
create index if not exists ticks_round_idx on market_ticks(round_id, tick_no);
