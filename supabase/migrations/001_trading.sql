-- Trading platform schema
-- Run via: supabase db push

create table if not exists signals (
  id          uuid primary key,
  ts          timestamptz not null,
  symbol      text not null,
  kind        text not null,
  side        text not null check (side in ('BUY','SELL')),
  strength    numeric not null,
  confidence  numeric not null,
  suggested_entry  numeric not null,
  suggested_stop   numeric not null,
  suggested_target numeric not null,
  meta        jsonb default '{}'
);

create table if not exists orders (
  id              uuid primary key,
  signal_id       uuid references signals(id),
  symbol          text not null,
  side            text not null check (side in ('BUY','SELL')),
  type            text not null,
  qty             numeric not null,
  limit_price     numeric,
  stop_price      numeric,
  status          text not null,
  filled_qty      numeric default 0,
  avg_fill_price  numeric default 0,
  slippage        numeric default 0,
  created_at      timestamptz not null,
  updated_at      timestamptz not null
);

create table if not exists portfolio_snapshots (
  id          bigserial primary key,
  ts          timestamptz not null,
  cash        numeric not null,
  equity      numeric not null,
  daily_pnl   numeric not null,
  total_pnl   numeric not null,
  positions   jsonb default '[]'
);

-- Enable realtime for live dashboard updates
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table portfolio_snapshots;

-- Row-level security (enable after adding auth)
alter table signals           enable row level security;
alter table orders            enable row level security;
alter table portfolio_snapshots enable row level security;
