-- Desk risk limits + order blotter (mirror).
--
-- Deviations from the blueprint, each with its reason:
--  * user_id is NULLABLE and desk_id fixed: there is no login UI yet; adding
--    Supabase Auth later is a backfill, not a migration rewrite.
--  * numeric DEFAULTs mirror config.py's real limits (not the blueprint's
--    invented 250k/500k) — tests/test_supabase_schema.py pins the equality.
--  * rejected_by[] + checks jsonb: an order routinely fails several gates at
--    once, and the DuckDB blotter can say WHICH gate — a Postgres blotter
--    that cannot would be a downgrade.
--  * latency_ms is the measured RiskDecision.latency_ms. The blueprint
--    hardcoded 0.19 — a fabricated measurement, removed on principle.
--  * decided_at vs occurred_at: a resting order fills hours after it was
--    decided; one timestamp cannot carry both facts.

create table public.desk_risk_limits (
  id uuid primary key default uuid_generate_v4(),
  desk_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid references auth.users(id) on delete cascade,
  desk_symbol text not null,
  authority_level public.desk_authority not null default 'PAPER_ONLY',
  max_order_notional_usd numeric(15, 2) not null default 50000.00,
  max_gross_exposure_usd numeric(15, 2) not null default 500000.00,
  max_symbol_notional_usd numeric(15, 2) not null default 150000.00,
  max_daily_drawdown_pct numeric(8, 5) not null default 0.05,
  max_est_slippage_bps numeric(8, 2) not null default 75.00,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_desk_user_symbol unique nulls not distinct (desk_id, user_id, desk_symbol)
);

create table public.order_blotter (
  id uuid primary key default uuid_generate_v4(),
  desk_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid references auth.users(id) on delete cascade,
  decided_by public.desk_decider not null,
  gateway_order_id text,
  client_order_id text,
  symbol text not null,
  side public.order_side not null,
  order_type text,
  quantity numeric(24, 10),
  notional numeric(15, 2),
  venue text,
  fill_price numeric(18, 8),
  filled_notional numeric(15, 2) default 0.00,
  slippage_bps numeric(10, 4),
  fee_usd numeric(12, 4),
  latency_ms numeric(10, 3),
  verdict public.order_verdict not null,
  rejected_by public.order_verdict[] not null default '{}',
  checks jsonb,
  status text,
  strategy_tag text,
  source text,
  decided_at timestamptz,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- A retried mirror write must be idempotent, never a duplicate fill.
  constraint unique_decider_order unique nulls not distinct (decided_by, gateway_order_id)
);

create index idx_blotter_desk_time on public.order_blotter (desk_id, occurred_at desc);
create index idx_blotter_symbol_time on public.order_blotter (symbol, occurred_at desc);
create index idx_blotter_verdict on public.order_blotter (verdict);

-- The DuckDB log is append-only by convention; here it can be by constraint.
create or replace function public.reject_blotter_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'order_blotter is append-only';
end;
$$;

create trigger order_blotter_append_only
  before update or delete on public.order_blotter
  for each row execute function public.reject_blotter_mutation();
