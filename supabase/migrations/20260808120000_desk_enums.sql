-- AlphaEngine desk enums.
--
-- `order_verdict` carries every gate name the Python engine can emit
-- (modules/risk_proxy.py, the fifteen `add("...")` calls) plus ACCEPTED and
-- the two aliases the original blueprint used. Six blueprint labels would
-- have forced the mirror to RELABEL a rejection — worse than not mirroring
-- it. tests/test_supabase_schema.py asserts this list against the engine.

create extension if not exists "uuid-ossp";

create type public.order_side as enum ('BUY', 'SELL');

create type public.order_verdict as enum (
  'ACCEPTED',
  -- the fifteen real gates, in engine order
  'kill_switch',
  'symbol_halt',
  'symbol_whitelist',
  'duplicate_order',
  'rate_limit',
  'price_available',
  'order_sized',
  'max_order_notional',
  'symbol_concentration',
  'gross_exposure',
  'price_band',
  'working_book',
  'daily_drawdown',
  'reduce_only',
  'est_slippage',
  -- blueprint aliases, kept so blueprint-derived clients keep parsing
  'FAT_FINGER',
  'DRAWDOWN_HALT'
);

create type public.desk_authority as enum ('PAPER_ONLY', 'LIVE_GATED', 'FULL_LIVE');

-- Provenance: which implementation decided. This single column is what keeps
-- the SQL sandbox decider from ever being read as the desk's decision.
create type public.desk_decider as enum ('gateway', 'supabase_rpc');
