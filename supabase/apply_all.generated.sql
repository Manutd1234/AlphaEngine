-- AlphaEngine — every migration, concatenated and made re-runnable.
--
-- GENERATED. Regenerate with `python3 tools/bundle_migrations.py`; do not edit
-- this file, or it drifts from the migrations it claims to be.
--
-- WHAT THIS IS FOR. The migrations in supabase/migrations/ were written and
-- committed; several were never applied to the live project. This bundle is
-- for applying them by hand, against a project whose current state nobody is
-- certain of.
--
--     Supabase dashboard -> SQL Editor -> paste -> Run
--
-- or, with the database password to hand:
--
--     supabase link --project-ref <ref> && supabase db push
--
-- SAFE TO RE-RUN, and unlike the first version of this file that is a property
-- of the generator rather than a hope. Postgres has no CREATE TYPE IF NOT
-- EXISTS, and the 2026-08-08 migrations use bare CREATE TABLE, CREATE INDEX,
-- CREATE POLICY and CREATE TRIGGER as well — so a plain concatenation stops on
-- the first statement:
--
--     ERROR: 42710: type "order_side" already exists
--
-- Every such statement below has been rewritten: enums are wrapped in a DO
-- block that swallows duplicate_object, tables and indexes gained IF NOT
-- EXISTS, and each policy and trigger is preceded by a DROP ... IF EXISTS.
--
-- ONE THING IT CANNOT DO. If a type already exists with DIFFERENT values —
-- say `order_verdict` predates a gate added to modules/risk_proxy.py — the
-- wrapped CREATE is skipped and the stale type is left as it is. Recreating a
-- type that five tables depend on is more dangerous than leaving it, so that
-- case is reported here rather than handled silently.
-- tests/test_supabase_schema.py is what catches a drifted order_verdict.


-- ========================================================================
-- 20260808120000_desk_enums.sql
-- ========================================================================

-- AlphaEngine desk enums.
--
-- `order_verdict` carries every gate name the Python engine can emit
-- (modules/risk_proxy.py, the fifteen `add("...")` calls) plus ACCEPTED and
-- the two aliases the original blueprint used. Six blueprint labels would
-- have forced the mirror to RELABEL a rejection — worse than not mirroring
-- it. tests/test_supabase_schema.py asserts this list against the engine.

create extension if not exists "uuid-ossp";

do $$ begin
  create type public.order_side as enum ('BUY', 'SELL');
exception
  when duplicate_object then null;  -- already applied
end $$;

do $$ begin
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
exception
  when duplicate_object then null;  -- already applied
end $$;

do $$ begin
  create type public.desk_authority as enum ('PAPER_ONLY', 'LIVE_GATED', 'FULL_LIVE');
exception
  when duplicate_object then null;  -- already applied
end $$;

-- Provenance: which implementation decided. This single column is what keeps
-- the SQL sandbox decider from ever being read as the desk's decision.
do $$ begin
  create type public.desk_decider as enum ('gateway', 'supabase_rpc');
exception
  when duplicate_object then null;  -- already applied
end $$;


-- ========================================================================
-- 20260808120100_desk_tables.sql
-- ========================================================================

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

create table if not exists public.desk_risk_limits (
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

create table if not exists public.order_blotter (
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

create index if not exists idx_blotter_desk_time on public.order_blotter (desk_id, occurred_at desc);
create index if not exists idx_blotter_symbol_time on public.order_blotter (symbol, occurred_at desc);
create index if not exists idx_blotter_verdict on public.order_blotter (verdict);

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

drop trigger if exists order_blotter_append_only on public.order_blotter;
create trigger order_blotter_append_only
  before update or delete on public.order_blotter
  for each row execute function public.reject_blotter_mutation();


-- ========================================================================
-- 20260808120200_rls_policies.sql
-- ========================================================================

-- Row-level security: deny-by-default.
--
-- There are deliberately ZERO `anon` policies and an explicit REVOKE — the
-- published anon key can read nothing until an authenticated-user story
-- ships. That is what makes putting NEXT_PUBLIC_SUPABASE_* on Vercel a
-- deliberate decision later instead of an accident today.

alter table public.desk_risk_limits enable row level security;
alter table public.order_blotter enable row level security;

revoke all on public.desk_risk_limits from anon;
revoke all on public.order_blotter from anon;

-- Authenticated users (future login story): own rows only.
drop policy if exists "Traders read own risk limits" on public.desk_risk_limits;
create policy "Traders read own risk limits"
  on public.desk_risk_limits for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Traders update own risk limits" on public.desk_risk_limits;
create policy "Traders update own risk limits"
  on public.desk_risk_limits for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Traders read own blotter" on public.order_blotter;
create policy "Traders read own blotter"
  on public.order_blotter for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Traders insert own blotter rows" on public.order_blotter;
create policy "Traders insert own blotter rows"
  on public.order_blotter for insert
  to authenticated
  with check ((select auth.uid()) = user_id);


-- ========================================================================
-- 20260808120300_order_mirror_rpc.sql
-- ========================================================================

-- Two write paths with two honesty levels.
--
-- record_alphaengine_decision(jsonb): the GATEWAY's path. Takes a decision the
-- Python engine already made and appends it verbatim — measured latency, full
-- check vector, every gate that rejected. Service-role only.
--
-- submit_alphaengine_order(...): the blueprint's RPC, kept under its original
-- name but redefined as an explicitly-labelled SANDBOX decider, in the same
-- family as the browser sandbox in web/lib/blotter.ts — two gates instead of
-- fifteen, rows stamped decided_by='supabase_rpc', never mistakable for the
-- desk's decision. It exists so the schema is exercisable from SQL alone.

create or replace function public.record_alphaengine_decision(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.order_blotter (
    desk_id, decided_by, gateway_order_id, client_order_id, symbol, side,
    order_type, quantity, notional, venue, fill_price, filled_notional,
    slippage_bps, fee_usd, latency_ms, verdict, rejected_by, checks, status,
    strategy_tag, source, decided_at, occurred_at
  )
  values (
    coalesce((payload->>'desk_id')::uuid, '00000000-0000-0000-0000-000000000001'),
    'gateway',
    payload->>'gateway_order_id',
    payload->>'client_order_id',
    payload->>'symbol',
    (payload->>'side')::public.order_side,
    payload->>'order_type',
    (payload->>'quantity')::numeric,
    (payload->>'notional')::numeric,
    payload->>'venue',
    (payload->>'fill_price')::numeric,
    (payload->>'filled_notional')::numeric,
    (payload->>'slippage_bps')::numeric,
    (payload->>'fee_usd')::numeric,
    (payload->>'latency_ms')::numeric,
    (payload->>'verdict')::public.order_verdict,
    coalesce(
      (select array_agg(value::public.order_verdict)
         from jsonb_array_elements_text(payload->'rejected_by')),
      '{}'
    ),
    payload->'checks',
    payload->>'status',
    payload->>'strategy_tag',
    payload->>'source',
    (payload->>'decided_at')::timestamptz,
    coalesce((payload->>'occurred_at')::timestamptz, now())
  )
  on conflict on constraint unique_decider_order do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.record_alphaengine_decision(jsonb) from public;
revoke execute on function public.record_alphaengine_decision(jsonb) from anon;
-- service_role bypasses RLS and carries execute by default; nothing else does.

create or replace function public.submit_alphaengine_order(
  p_symbol text,
  p_side public.order_side,
  p_notional numeric,
  p_strategy_tag text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits public.desk_risk_limits%rowtype;
  v_verdict public.order_verdict := 'ACCEPTED';
begin
  if v_user_id is null then
    raise exception 'Unauthenticated request';
  end if;

  select * into v_limits
  from public.desk_risk_limits
  where user_id = v_user_id and desk_symbol = p_symbol and is_active = true;

  if not found then
    v_limits.max_order_notional_usd := 50000.00;
  end if;

  if p_notional > v_limits.max_order_notional_usd then
    v_verdict := 'max_order_notional';
  end if;

  insert into public.order_blotter (
    user_id, decided_by, symbol, side, notional, verdict, rejected_by,
    strategy_tag, status, source
  )
  values (
    v_user_id, 'supabase_rpc', p_symbol, p_side, p_notional, v_verdict,
    case when v_verdict = 'ACCEPTED'
      then '{}'::public.order_verdict[]
      else array[v_verdict]
    end,
    p_strategy_tag,
    case when v_verdict = 'ACCEPTED' then 'FILLED' else 'REJECTED' end,
    'sandbox_rpc'
  );

  return jsonb_build_object(
    'decided_by', 'supabase_rpc',
    'sandbox', true,
    'verdict', v_verdict,
    'status', case when v_verdict = 'ACCEPTED' then 'SENT' else 'REJECTED' end,
    'note', 'Two-gate SQL sandbox — the fifteen-gate decision is the gateway''s alone.'
  );
end;
$$;

revoke execute on function public.submit_alphaengine_order(text, public.order_side, numeric, text) from public;
revoke execute on function public.submit_alphaengine_order(text, public.order_side, numeric, text) from anon;
grant execute on function public.submit_alphaengine_order(text, public.order_side, numeric, text) to authenticated;


-- ========================================================================
-- 20260808120400_pgvector_research_documents.sql
-- ========================================================================

-- pgvector research corpus.
--
-- `body` stores the EXACT text that was embedded — a later change to the card
-- renderer must not silently invalidate every stored vector with no way to
-- detect it. `data_hash` ties a backtest document to the exact bars its run
-- saw (same meaning as BacktestResult.data_hash).
--
-- A document whose embedding failed stays embedding_status='pending' with a
-- NULL vector — never a zero vector, which is equidistant from everything and
-- would surface as "similar" to any query.

create extension if not exists vector with schema extensions;

do $$ begin
  create type public.research_doc_kind as enum (
    'backtest_run',
    'execution_summary',
    'risk_incident'
  );
exception
  when duplicate_object then null;  -- already applied
end $$;

create table if not exists public.research_documents (
  id uuid primary key default gen_random_uuid(),
  desk_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid references auth.users(id) on delete cascade,
  kind public.research_doc_kind not null,
  source_ref text not null,          -- job_id / session_date / order_id
  symbol text,
  interval text,
  strategy text,
  occurred_at timestamptz not null,
  title text not null,
  body text not null,
  metrics jsonb not null default '{}',
  data_hash text,
  embedding extensions.vector(384),
  embedding_model text,
  embedding_status text not null default 'pending'
    check (embedding_status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  constraint unique_desk_kind_ref unique (desk_id, kind, source_ref)
);

create index if not exists idx_research_docs_embedding
  on public.research_documents
  using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists idx_research_docs_kind_time
  on public.research_documents (kind, occurred_at desc);

alter table public.research_documents enable row level security;
revoke all on public.research_documents from anon;

drop policy if exists "Traders read own research documents" on public.research_documents;
create policy "Traders read own research documents"
  on public.research_documents for select
  to authenticated
  using ((select auth.uid()) = user_id);


-- ========================================================================
-- 20260808120500_match_research_documents.sql
-- ========================================================================

-- Similarity search over the research corpus.
--
-- SECURITY INVOKER (there is no privilege to elevate — the gateway calls this
-- with the service role, which bypasses RLS anyway), STABLE, and it refuses
-- documents that are not embedding_status='ready': a pending document has no
-- position in the space and must not be ranked as if it did.

create or replace function public.match_research_documents(
  query_embedding extensions.vector(384),
  match_count int default 3,
  min_similarity float default 0.0,
  filter_kind public.research_doc_kind default null
)
returns table (
  id uuid,
  kind public.research_doc_kind,
  source_ref text,
  symbol text,
  strategy text,
  occurred_at timestamptz,
  title text,
  body text,
  metrics jsonb,
  similarity float
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    d.id, d.kind, d.source_ref, d.symbol, d.strategy, d.occurred_at,
    d.title, d.body, d.metrics,
    1 - (d.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.research_documents d
  where d.embedding is not null
    and d.embedding_status = 'ready'
    and (filter_kind is null or d.kind = filter_kind)
    and 1 - (d.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by d.embedding operator(extensions.<=>) query_embedding
  limit greatest(1, least(match_count, 20));
$$;


-- ========================================================================
-- 20260808120600_desk_blotter_view.sql
-- ========================================================================

-- The read surface for the mirrored blotter.
--
-- WHY A VIEW AND NOT A CONVENTION
--
-- `order_blotter` now has two writers. The gateway appends the desk's real
-- fifteen-gate decisions (`decided_by = 'gateway'`); the `evaluate-order` Edge
-- Function and `submit_alphaengine_order` append labelled two-gate SANDBOX
-- decisions (`decided_by = 'supabase_rpc'`). The `decided_by` column exists
-- precisely so those can never be confused.
--
-- That column only protects anything if every reader remembers to filter on it,
-- and the table is APPEND-ONLY by trigger — so a query that forgets the filter
-- produces a blended blotter that cannot be cleaned up afterwards. Today there
-- are zero readers, which makes this the cheapest possible moment to make the
-- safe path the default one instead of relying on everyone reading the column
-- comment first.
--
-- `desk_blotter` is what a reader should select from. Reaching past it to the
-- base table is then a visible, deliberate act in a diff rather than an
-- omission nobody notices.

create or replace view public.desk_blotter
with (security_invoker = true) as
select *
  from public.order_blotter
 where decided_by = 'gateway';

comment on view public.desk_blotter is
  'Desk decisions only — the fifteen-gate engine in modules/risk_proxy.py. '
  'Excludes decided_by = ''supabase_rpc'', which is the labelled SQL/Edge sandbox '
  'and is never the desk''s decision. Read this, not order_blotter.';

-- The mirror image, for anyone who genuinely wants the sandbox rows — a
-- demo, or a reconciliation that has to account for every row in the table.
create or replace view public.sandbox_blotter
with (security_invoker = true) as
select *
  from public.order_blotter
 where decided_by = 'supabase_rpc';

comment on view public.sandbox_blotter is
  'Sandbox decisions only (two gates, from SQL or the evaluate-order Edge '
  'Function). Never present these as the desk''s decisions.';

-- security_invoker keeps RLS applying as the querying role rather than the
-- view owner: without it these views would be a way around the deny-by-default
-- policies, which is the opposite of the point.
revoke all on public.desk_blotter from anon;
revoke all on public.sandbox_blotter from anon;
grant select on public.desk_blotter to authenticated;
grant select on public.sandbox_blotter to authenticated;


-- ========================================================================
-- 20260808120700_anon_demo_realtime.sql
-- ========================================================================

-- Scoped anon read + realtime, for the public demo desk only.
--
-- THIS REVERSES A DELIBERATE DECISION, so it states its reasoning in full.
--
-- `20260808120200_rls_policies.sql` shipped with zero `anon` policies and an
-- explicit REVOKE, and its header says that is "what makes putting
-- NEXT_PUBLIC_SUPABASE_* on Vercel a deliberate decision later instead of an
-- accident today." This is that deliberate decision. It is narrow on purpose,
-- and every clause below is load-bearing rather than defensive boilerplate:
--
--   desk_id = the public demo desk
--       The single desk this educational deployment runs. A second desk added
--       later is private by default rather than by remembering to exclude it.
--
--   user_id is null
--       Gateway-mirrored rows have no owner. The authenticated-trader story in
--       the policies above writes rows WITH a user_id, and those stay private —
--       so shipping a login later does not retroactively publish anyone's
--       blotter through this policy.
--
--   decided_by = 'gateway'
--       Same rule as `public.desk_blotter`: the labelled two-gate sandbox is
--       never served as the desk's decision, not even to an anonymous reader.
--
-- What this exposes is paper-trading decisions on generated and public market
-- data, already rendered in the deployed UI through the gateway proxy. There
-- are no accounts, no funds and no real orders behind these rows — the footer
-- of the site says so, and it remains true after this migration.
--
-- SELECT only. anon gets no INSERT, UPDATE or DELETE, and `order_blotter` is
-- append-only by trigger regardless.

drop policy if exists "Public demo desk blotter is readable anonymously" on public.order_blotter;
create policy "Public demo desk blotter is readable anonymously"
  on public.order_blotter for select
  to anon
  using (
    desk_id = '00000000-0000-0000-0000-000000000001'::uuid
    and user_id is null
    and decided_by = 'gateway'
  );

grant select on public.order_blotter to anon;

-- Risk limits stay closed. They are the desk's configured thresholds, and
-- publishing exactly where the gates sit tells anyone how to size an order that
-- passes. The UI shows utilisation, which is the useful half, through the
-- gateway.
--
-- (No policy for anon on desk_risk_limits — the REVOKE in 20260808120200
-- stands.)

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- `postgres_changes` delivers a row only if the subscribing role could SELECT
-- it, so the policy above IS the subscription filter — an anon client cannot
-- subscribe its way past it.
--
-- REPLICA IDENTITY FULL is required for the old-row image on UPDATE/DELETE.
-- This table is append-only, so only INSERT is ever delivered; it is set anyway
-- because a table in a publication without it produces silently incomplete
-- payloads if that ever changes.

alter table public.order_blotter replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.order_blotter;
exception
  when duplicate_object then null;  -- already published; re-running is safe
  when undefined_object then
    raise notice 'supabase_realtime publication not found — enable Realtime in the dashboard first';
end $$;


-- ========================================================================
-- 20260810090000_hybrid_research_search.sql
-- ========================================================================

-- Hybrid retrieval: lexical BM25-style ranking fused with the vector ranking.
--
-- WHY A DENSE INDEX ALONE IS NOT ENOUGH HERE
--
-- The documents in this corpus are keyed by things a sentence embedder handles
-- badly: `BTCUSDT`, a job id, an eight-character `data_hash`, a parameter pair
-- like `20/100`. gte-small maps those to whatever its subword tokeniser makes of
-- them, and a query for an exact job id can rank the right document below three
-- documents about job ids in general. Lexical search is exact on precisely the
-- tokens the dense model blurs, and blind to the paraphrases the dense model
-- handles — which is why the answer is both, fused, rather than a choice.
--
-- WHY THE COLUMN IS GENERATED
--
-- A trigger-maintained tsvector drifts the moment a row is updated by a path
-- that forgets the trigger, and this table is written by two different services.
-- A generated column cannot drift: Postgres recomputes it on every write, and
-- there is no code path that can skip it.
--
-- The weights are the standard four: title is A, the body B. `setweight` is what
-- makes a query matching a title outrank the same query matching one mention
-- deep in a body, which is the ordering a reader expects and `ts_rank_cd`
-- otherwise has no way to know.

alter table public.research_documents
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(body, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(symbol, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(strategy, '')), 'B')
  ) stored;

-- GIN rather than GiST: this table is read far more than it is written, and GIN
-- is the faster of the two for lookups at the cost of a slower build.
create index if not exists idx_research_docs_tsv
  on public.research_documents using gin (search_tsv);

-- Reciprocal Rank Fusion.
--
-- Scores are fused by RANK, not by value, and that is the whole point. A cosine
-- similarity of 0.86 and a ts_rank_cd of 0.19 are numbers on unrelated scales
-- with unrelated distributions; normalising them into a weighted sum requires
-- choosing a normalisation, and every choice is a thumb on the scale that
-- nobody can audit later. RRF only asks each retriever for an ordering, which
-- is the one thing both are actually competent to state.
--
-- k = 60 is the value from the original Cormack et al. paper, kept rather than
-- tuned: with a corpus this small any tuning would be fitting the constant to a
-- handful of documents.
create or replace function public.match_research_documents_hybrid(
  query_embedding extensions.vector(384),
  query_text text,
  match_count int default 5,
  filter_kind public.research_doc_kind default null,
  rrf_k int default 60
)
returns table (
  id uuid,
  kind public.research_doc_kind,
  source_ref text,
  symbol text,
  strategy text,
  occurred_at timestamptz,
  title text,
  body text,
  metrics jsonb,
  similarity float,
  lexical_rank int,
  vector_rank int,
  fused_score float
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with candidates as (
    -- Deliberately wider than match_count: fusing two top-5 lists can only ever
    -- surface documents that were already top-5 in one of them, which defeats
    -- the purpose. A document ranked 8th by both retrievers is a better answer
    -- than one ranked 1st by neither.
    select d.*,
           1 - (d.embedding operator(extensions.<=>) query_embedding) as sim
      from public.research_documents d
     where d.embedding is not null
       and d.embedding_status = 'ready'
       and (filter_kind is null or d.kind = filter_kind)
  ),
  vector_ranked as (
    select c.id, row_number() over (order by c.sim desc) as v_rank, c.sim
      from candidates c
     order by c.sim desc
     limit 50
  ),
  lexical_ranked as (
    select c.id,
           row_number() over (
             order by ts_rank_cd(c.search_tsv, websearch_to_tsquery('english', query_text)) desc
           ) as l_rank
      from candidates c
     where query_text is not null
       and query_text <> ''
       and c.search_tsv @@ websearch_to_tsquery('english', query_text)
     order by ts_rank_cd(c.search_tsv, websearch_to_tsquery('english', query_text)) desc
     limit 50
  )
  select c.id, c.kind, c.source_ref, c.symbol, c.strategy, c.occurred_at,
         c.title, c.body, c.metrics,
         c.sim as similarity,
         l.l_rank::int as lexical_rank,
         v.v_rank::int as vector_rank,
         -- A retriever that did not return a document contributes nothing for
         -- it, rather than a large penalty. Penalising absence would make the
         -- fusion behave like an AND across two retrievers with very different
         -- recall, and the lexical side returns nothing at all for a
         -- paraphrased query.
         coalesce(1.0 / (rrf_k + v.v_rank), 0)
           + coalesce(1.0 / (rrf_k + l.l_rank), 0) as fused_score
    from candidates c
    left join vector_ranked v on v.id = c.id
    left join lexical_ranked l on l.id = c.id
   where v.id is not null or l.id is not null
   order by fused_score desc
   limit greatest(1, least(match_count, 20));
$$;

comment on function public.match_research_documents_hybrid is
  'Vector and lexical rankings fused by Reciprocal Rank Fusion (k=60). '
  'Returns both source ranks so a caller can show WHY a document surfaced.';


-- ========================================================================
-- 20260810093000_reload_postgrest_schema.sql
-- ========================================================================

-- Tell PostgREST that the schema changed.
--
-- `supabase db push` applies DDL to Postgres and says nothing to PostgREST,
-- which serves `/rest/v1/rpc/*` from a schema cache it builds at startup. A
-- function added by a migration can therefore be invisible over HTTP until
-- something reloads that cache, and the symptom is a 404 for an RPC that
-- exists, is callable in SQL, and passes every offline contract test.
--
-- HONEST PROVENANCE: this was written to fix a live symptom it did not cause.
-- After 20260810090000 applied, a live query still came back without the hybrid
-- function's rank columns, and the 404 fallback was the obvious suspect. It was
-- the wrong suspect — `ResearchRagMatch` had no fields for those columns and
-- pydantic drops unknown keys, so the RPC was answering correctly and the
-- response model was discarding half the answer. The two failures are
-- indistinguishable from outside, which is what made the guess plausible.
--
-- Kept anyway, because the hazard it addresses is real, undetectable from the
-- test suite (every contract test here is offline and passes either way), and
-- the statement is idempotent. It stands as a final migration rather than a
-- one-off repair.
notify pgrst, 'reload schema';


-- ========================================================================
-- 20260812090000_authenticated_demo_realtime.sql
-- ========================================================================

-- Signing in must not cost the public demo tape.
--
-- Supersedes the "there is no login UI yet" notes in 20260808120100 and
-- 20260808120200: a login ships now. Those files stay as written — a migration
-- that has been applied is history, not documentation.
--
-- The demo policy in 20260808120700 is scoped `to anon`, and RLS policies are
-- role-scoped. The moment a browser carries a user JWT, PostgREST and Realtime
-- evaluate it as `authenticated`, that policy stops applying, and the only
-- authenticated SELECT policy on this table is `auth.uid() = user_id` — which
-- no gateway-mirrored row can satisfy, because they all carry user_id NULL.
-- The result would not be an error. It would be an empty tape that still
-- reports itself live: exactly the silent wrongness this project keeps trying
-- to design out.
--
-- The predicate below is the same one anon gets, verbatim. It publishes
-- nothing new: only gateway-decided, unowned rows on the fixed demo desk. A
-- signed-in trader's own rows carry their user_id and remain private under the
-- existing own-row policy.
drop policy if exists "Public demo desk blotter is readable when signed in" on public.order_blotter;
create policy "Public demo desk blotter is readable when signed in"
  on public.order_blotter for select
  to authenticated
  using (
    desk_id = '00000000-0000-0000-0000-000000000001'::uuid
    and user_id is null
    and decided_by = 'gateway'
  );

notify pgrst, 'reload schema';


-- ========================================================================
-- 20260812091000_close_authenticated_writes.sql
-- ========================================================================

-- Closing what a login opens.
--
-- Every grant below was harmless while nobody could sign in. Shipping the login
-- makes `authenticated` a role a stranger can actually hold — anyone who can
-- complete a sign-up — so each one has to be re-read as a public capability.
--
-- The headline is the first revoke. 20260808120300 removed execute on
-- record_alphaengine_decision from `public` and from `anon`, and its comment
-- concluded "service_role bypasses RLS and carries execute by default; nothing
-- else does." That is not true of `authenticated`: Supabase's project bootstrap
-- grants execute to anon, authenticated and service_role explicitly, and a
-- revoke from PUBLIC does not touch a grant made to a named role. The function
-- is SECURITY DEFINER, so it bypasses RLS; it defaults desk_id to the public
-- demo desk, hardcodes decided_by = 'gateway', and leaves user_id NULL — which
-- is precisely the shape the anon demo-tape policy publishes. A signed-in user
-- could therefore forge desk decisions (symbol, side, verdict, fill, latency)
-- into the tape every anonymous visitor watches, in an append-only table with
-- no delete path and a trigger that refuses UPDATE and DELETE.
--
-- Nothing here changes what the gateway can do: it connects with the
-- service-role key, which is exempt from RLS and unaffected by these revokes.

revoke execute on function public.record_alphaengine_decision(jsonb) from authenticated;

-- Provenance belongs to whoever did the deciding. A trader's own sandbox rows
-- are legitimate; a row claiming the gateway decided it is not something a
-- browser may assert, even about itself.
drop policy if exists "Traders insert own blotter rows" on public.order_blotter;
create policy "Traders insert own blotter rows"
  on public.order_blotter for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and decided_by = 'supabase_rpc'
  );

-- The two retrieval functions were created without any grant statement, so they
-- kept the default EXECUTE for anon and authenticated. They are SECURITY
-- INVOKER, so RLS still bounds the rows — but only the gateway's service-role
-- client is ever meant to call them, and leaving them open means a signed-in
-- browser gets a plausible `200 []` from a vector search rather than an honest
-- refusal. Empty-because-forbidden must not be indistinguishable from
-- empty-because-nothing-matched.
revoke execute on function public.match_research_documents(extensions.vector, integer, double precision, public.research_doc_kind) from anon, authenticated;
revoke execute on function public.match_research_documents_hybrid(extensions.vector, text, integer, public.research_doc_kind, integer) from anon, authenticated;

-- Defence in depth: RLS already blocks each of these (no matching policy, plus
-- the append-only trigger on order_blotter), so this changes no behaviour
-- today. It exists so that adding a policy later cannot quietly become the only
-- thing standing between a browser and a write.
revoke insert, update, delete on public.desk_risk_limits from authenticated;
revoke update, delete on public.order_blotter from authenticated;

notify pgrst, 'reload schema';


-- ========================================================================
-- 20260812100000_user_preferences.sql
-- ========================================================================

-- One row per account: the workspace preferences this browser already keeps in
-- localStorage, mirrored so signing in on another machine restores them.
--
-- Deliberately a single jsonb blob rather than a column per preference. These
-- are viewing choices — theme, detail level, which tab you left open — with no
-- relational shape and no query that ever filters on one of them; a column per
-- setting would mean a migration every time the workspace grows a toggle.
--
-- What does NOT belong here, and why, because the omissions are the design:
--   * the operator token — a credential, and it stays in sessionStorage where
--     it dies with the tab;
--   * the experiment log — up to sixty records of run history, which is a row
--     shape, not a preference, and would breach the size check below;
--   * the blotter's sandbox/live source — per-tab by intent, so two tabs can
--     watch different books.
create table if not exists public.user_preferences (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- localStorage-scale payloads only. A preference blob that grows past this
  -- is something else wearing a preference's clothes.
  constraint user_preferences_prefs_bounded check (pg_column_size(prefs) < 32768)
);

alter table public.user_preferences enable row level security;

-- Anonymous visitors keep their preferences in their own browser and never
-- reach this table. There is no demo row to read here, unlike the blotter.
revoke all on public.user_preferences from anon;

drop policy if exists "Users read own preferences" on public.user_preferences;
create policy "Users read own preferences"
  on public.user_preferences for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own preferences" on public.user_preferences;
create policy "Users insert own preferences"
  on public.user_preferences for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own preferences" on public.user_preferences;
create policy "Users update own preferences"
  on public.user_preferences for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy: dropping the account drops the row through the cascade
-- above, and there is no other reason to remove one.

notify pgrst, 'reload schema';


-- ========================================================================
-- 20260812110000_account_session_listing.sql
-- ========================================================================

-- The sessions behind "you are signed in on these devices".
--
-- `@supabase/supabase-js` has no client-side way to enumerate a user's
-- sessions — `listUserSessions` does not exist in 2.112.2, and this is not an
-- admin-gated call that a service key would unlock. `auth.sessions` is the only
-- record of them, so reading it takes a SECURITY DEFINER function that filters
-- to the caller.
--
-- TWO OUTCOMES, BOTH HANDLED HERE
--
-- Whether the migration role can actually SELECT `auth.sessions` is a property
-- of this project that the repository cannot prove: migrations elsewhere in
-- this corpus reference `auth.users` in foreign keys, which demonstrates
-- REFERENCES and says nothing about SELECT on a different table in that schema.
-- A PL/pgSQL body is not permission-checked at creation time, so guessing wrong
-- would produce a function that creates cleanly and throws on first call — in
-- the profile page, at the worst possible moment.
--
-- So it degrades instead. If the table cannot be read the function returns a
-- single row describing the current session, assembled from the caller's own
-- JWT, and stamps `source = 'jwt'`. The caller can then say "only this device
-- can be listed on this project" rather than showing a one-row list that reads
-- as "you are signed in nowhere else" — which would be a claim this function
-- had no evidence for. `source = 'sessions'` means the list is complete.
--
-- `search_path = ''` rather than `= auth, public`: with an empty path every
-- name below has to be written out, so no object can be resolved through a
-- schema someone else can create into. It satisfies the corpus-wide
-- `set search_path` guard identically.
create or replace function public.list_my_sessions()
returns table (
  session_id   uuid,
  created_at   timestamptz,
  refreshed_at timestamptz,
  user_agent   text,
  ip           text,
  is_current   boolean,
  source       text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  -- No session, no answer. A SECURITY DEFINER function reading an auth table
  -- must never run unfiltered, and `auth.uid()` is NULL for anon.
  if v_user_id is null then
    return;
  end if;

  begin
    return query
    select
      s.id,
      s.created_at::timestamptz,
      -- `refreshed_at` is `timestamp without time zone` in some GoTrue
      -- versions. Supabase runs the cluster in UTC, so the cast is exact
      -- there and is a no-op where the column is already tz-aware.
      s.refreshed_at::timestamptz,
      s.user_agent,
      -- `::text`, not `host()`. The column is `inet`, so the declared `text`
      -- return needs a cast either way — but a plain cast is also the one that
      -- survives a GoTrue version that stores this as text, where `host()`
      -- would be an undefined function.
      s.ip::text,
      coalesce(s.id = v_session, false),
      'sessions'::text
    from auth.sessions s
    where s.user_id = v_user_id
    order by coalesce(s.refreshed_at::timestamptz, s.created_at::timestamptz) desc;

    -- A signed-in caller always has at least the session they are calling
    -- with. An empty result therefore means the read was silently filtered
    -- rather than genuinely empty, and the fallback below is the honest answer.
    if found then
      return;
    end if;
  exception
    when insufficient_privilege
      or undefined_table
      or undefined_column
      or undefined_function then
      -- Fall through. Nothing about this is an error the caller can act on.
      null;
  end;

  return query
  select
    v_session,
    to_timestamp((auth.jwt() ->> 'iat')::double precision),
    to_timestamp((auth.jwt() ->> 'iat')::double precision),
    null::text,
    null::text,
    true,
    'jwt'::text;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and `anon` is a
-- member of PUBLIC. Without these two lines an anonymous visitor could call a
-- SECURITY DEFINER function that reads an auth table; it would return nothing
-- today only because `auth.uid()` is NULL, which is a coincidence of the filter
-- rather than a permission boundary.
revoke execute on function public.list_my_sessions() from public;
revoke execute on function public.list_my_sessions() from anon;
grant execute on function public.list_my_sessions() to authenticated;

-- PostgREST caches the schema. Without this the function exists and works in
-- SQL while returning 404 over HTTP, which reads as "the migration did not
-- apply" and sends you looking in the wrong place.
notify pgrst, 'reload schema';


-- ========================================================================
-- 20260812110100_avatar_bucket.sql
-- ========================================================================

-- The private bucket profile avatars live in.
--
-- PRIVATE, and that is the whole security posture. A public bucket serves
-- `/storage/v1/object/public/<bucket>/<path>` to anyone who asks, with no
-- policy evaluated on the way — and nothing in this repository probes
-- `/storage/v1/*`, so the exposure would be invisible to every check that
-- currently runs. Reads go through short-lived signed URLs instead.
--
-- Ownership is the first path segment: `<uid>/avatar.png`. Every policy below
-- compares `(storage.foldername(name))[1]` to the caller's uid, so a signed-in
-- account can write and replace exactly one folder and read nobody else's.
--
-- WHY THIS RUNS INSIDE A DO BLOCK
--
-- `storage.objects` and `storage.buckets` are owned by `supabase_storage_admin`,
-- and `create policy` requires ownership of the table. The migration role is
-- widely `postgres` and widely does own these, but that is a property of the
-- project, not something this repository can prove. `supabase db push` aborts
-- the entire job on the first failing statement — which would take the sessions
-- migration in the commit before this one, both Edge Function deploys and the
-- anonymous probe down with it, for a bucket.
--
-- So the failure is contained and, more importantly, is not silent: it raises a
-- WARNING that names the exact dashboard steps. `raise notice` would be worse
-- than useless here, because a migration that quietly does nothing is
-- indistinguishable from one that worked.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars',
    'avatars',
    false,
    2097152,                                    -- 2 MiB; an avatar is not a document
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  )
  on conflict (id) do update
    set public             = false,             -- never let a later hand flip it
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
exception
  when insufficient_privilege or undefined_table then
    raise warning using message =
      'avatars bucket not created: the migration role cannot write storage.buckets. '
      'Create it by hand: Storage -> New bucket -> name "avatars", Public OFF, '
      'file size limit 2 MB. The profile page degrades to initials until it exists.';
end;
$$;

do $$
begin
  -- Dropped first so re-applying this migration against a project that already
  -- has them is not an error. `create policy` has no `if not exists`.
  drop policy if exists "Avatars are readable by their owner"   on storage.objects;
  drop policy if exists "Avatars are writable by their owner"   on storage.objects;
  drop policy if exists "Avatars are replaceable by their owner" on storage.objects;
  drop policy if exists "Avatars are removable by their owner"  on storage.objects;

  -- SELECT is needed even though reads go through signed URLs: creating a
  -- signed URL is itself authorised against these policies.
  drop policy if exists "Avatars are readable by their owner" on storage.objects;
  create policy "Avatars are readable by their owner"
    on storage.objects for select
    to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );

  drop policy if exists "Avatars are writable by their owner" on storage.objects;
  create policy "Avatars are writable by their owner"
    on storage.objects for insert
    to authenticated
    with check (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );

  -- `using` AND `with check`: without the second clause an account could move a
  -- row it owns into somebody else's folder.
  drop policy if exists "Avatars are replaceable by their owner" on storage.objects;
  create policy "Avatars are replaceable by their owner"
    on storage.objects for update
    to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );

  drop policy if exists "Avatars are removable by their owner" on storage.objects;
  create policy "Avatars are removable by their owner"
    on storage.objects for delete
    to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    );

  -- No policy names `anon` at all. Anonymous visitors browse the whole desk
  -- without an account and have no avatar to reach; the absence is the rule.
exception
  when insufficient_privilege then
    raise warning using message =
      'avatars policies not created: the migration role does not own '
      'storage.objects. Add them by hand in Storage -> Policies on the avatars '
      'bucket, scoped to (storage.foldername(name))[1] = auth.uid()::text for '
      'select, insert, update and delete. Until then uploads are rejected, '
      'which is the safe direction to fail.';
end;
$$;


-- ========================================================================
-- 20260813120000_telegram_link.sql
-- ========================================================================

-- One row per account: the Telegram chat that account has connected, so the
-- workspace can say "Connected as @handle" after the browser that arranged it
-- has been closed.
--
-- WHAT THIS ROW IS NOT. It is not a credential and it authenticates nothing.
-- Telegram has its own allow-list, and a binding grants that Telegram user the
-- same READING a web desk pass already gives — the shared book, the shared kill
-- switch, the shared counters — over a second transport. It never grants the
-- controls: /halt, /resume, /flatten, /reduceonly and /resetbook stay behind the
-- gateway's TELEGRAM_CONTROL_USER_IDS, which lives in deployment config and is
-- not reachable from this table or from any request. Nothing here is ever read
-- in the other direction: no Telegram identity authenticates a web request.
--
-- TWO STORES, DELIBERATELY. A GUEST binding is not here. It lives in the
-- gateway's own DuckDB `subscribers` row and lapses on its own clock, because a
-- guest desk pass is a browser-session cookie with no account behind it and
-- nothing durable to hang off. This table is the signed-in half: durable, and
-- gone when the account is, through the cascade below.
--
-- The gateway writes these rows with the service role, because the gateway is
-- the only party that holds the Telegram user id. The policies below are what
-- the *account* may do with its own row from the browser.
create table if not exists public.telegram_link (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  -- Telegram ids are 64-bit and getting longer; text avoids the day one stops
  -- fitting, and nothing here does arithmetic on them.
  telegram_user_id  text not null,
  telegram_chat_id  text not null,
  -- Handles are renameable, so this is a label for display and never a key.
  telegram_username text,
  linked_at         timestamptz not null default now(),
  -- One Telegram account, one desk account. Without this a single Telegram user
  -- could be bound to several accounts at once, and the gateway's alert routing
  -- would have no way to say which desk identity a chat belongs to.
  constraint telegram_link_one_account_per_telegram_user unique (telegram_user_id)
);

alter table public.telegram_link enable row level security;

-- Anonymous visitors have no account and therefore no row here. A guest who
-- connects a chat is recorded in the gateway's store instead, and reads nothing
-- from this table.
revoke all on public.telegram_link from anon;

drop policy if exists "Users read own telegram link" on public.telegram_link;
create policy "Users read own telegram link"
  on public.telegram_link for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own telegram link" on public.telegram_link;
create policy "Users insert own telegram link"
  on public.telegram_link for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own telegram link" on public.telegram_link;
create policy "Users update own telegram link"
  on public.telegram_link for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy: closing the account drops the row through the cascade
-- above. Note what that means for revocation and do not mistake it for an
-- oversight — a binding conveys read parity with a desk pass anyone can mint,
-- so there is nothing exclusive to withdraw in a hurry.

notify pgrst, 'reload schema';


-- ========================================================================
-- 20260820090000_ml_runs.sql
-- ========================================================================

-- The ML run ledger: what was trained, on which bars, with which parameters.
--
-- The desk already records rule-based sweeps in the audit log's backtest_runs
-- and renders each into the pgvector corpus. An ML run needs the same
-- provenance and two things a sweep does not have: a model that was FITTED
-- rather than specified, and folds that must not leak.
--
-- `data_hash` carries the same meaning it does everywhere else in this project
-- — the exact bars the run saw — so an ML run and a sweep over the same window
-- are comparable rather than merely adjacent. `git_sha` is beside it because a
-- fitted model is a function of the code that fitted it in a way a moving
-- average is not: two runs with the same data_hash and different shas are two
-- different experiments, and without this column nothing would say so.
--
-- `seed` is not optional and has no default. A run that cannot say which seed
-- produced it cannot be re-run, and an irreproducible ML result is an anecdote.

create table if not exists public.ml_runs (
  id uuid primary key default gen_random_uuid(),
  desk_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid references auth.users(id) on delete cascade,

  model text not null,
  symbol text not null,
  interval text not null,
  --: The exact bars this run saw. Same meaning as BacktestResult.data_hash.
  data_hash text not null,
  --: Hyperparameters as given, not as defaulted, so a re-run is exact.
  params jsonb not null default '{}',
  seed bigint not null,
  --: The tree that fitted it. A fitted model is a function of its code.
  git_sha text,
  --: Whether the optional scikit-learn extra was present. A run that fell back
  --: to the hand-rolled engine is a different run and must say so rather than
  --: being silently comparable to one that did not.
  engine text not null default 'numpy' check (engine in ('numpy', 'sklearn')),

  --: Headline out-of-sample metrics, mirroring the sweep vocabulary so the two
  --: kinds of run can be ranked in one list.
  oos_sharpe double precision,
  deflated_sharpe double precision,
  pbo double precision,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  --: Why it failed, when it did. Never NULL on a failed row.
  error text,

  created_at timestamptz not null default now(),
  constraint ml_runs_failed_rows_say_why
    check (status <> 'failed' or error is not null)
);

create index if not exists idx_ml_runs_desk_time on public.ml_runs (desk_id, started_at desc);
create index if not exists idx_ml_runs_data_hash on public.ml_runs (data_hash);

alter table public.ml_runs enable row level security;
revoke all on public.ml_runs from anon;

drop policy if exists "Traders read own ML runs" on public.ml_runs;
create policy "Traders read own ML runs"
  on public.ml_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);


-- ========================================================================
-- 20260820090100_ml_folds.sql
-- ========================================================================

-- Walk-forward folds, and the gap that makes them honest.
--
-- A time-series cross-validation that splits at random leaks: a bar in the
-- training set can sit inside the label horizon of a bar in the test set, so
-- the model is scored partly on information it was fitted on. The result is a
-- Sharpe that cannot be reproduced out of sample and nobody can explain.
--
-- Two columns exist to make that impossible to hide rather than merely
-- unlikely. `purge_bars` is how many bars were dropped from the END of the
-- training window because their labels reach into the test window.
-- `embargo_bars` is how many were dropped from the START of the training
-- window that FOLLOWS a test window, because serial correlation runs both ways.
-- Both are NOT NULL: a fold that cannot state its purge is a fold whose
-- leakage is unknown, and unknown leakage is indistinguishable from none.
--
-- Zero is a legal value and an explicit claim — "this fold purged nothing" —
-- which is very different from a NULL that means "nobody recorded it".

create table if not exists public.ml_folds (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ml_runs(id) on delete cascade,
  --: 0-based, in time order. The ordering is the point of a walk-forward.
  fold_index int not null,

  train_start timestamptz not null,
  train_end timestamptz not null,
  test_start timestamptz not null,
  test_end timestamptz not null,
  train_rows int not null,
  test_rows int not null,

  --: See the note above. Both required, both meaningful at zero.
  purge_bars int not null,
  embargo_bars int not null,

  --: Out-of-sample only. An in-sample number on a fold row would be read as
  --: an out-of-sample one by the first person to sort this table.
  oos_return double precision,
  oos_sharpe double precision,
  oos_max_drawdown double precision,
  trades int,

  created_at timestamptz not null default now(),

  constraint ml_folds_train_window_is_ordered check (train_end > train_start),
  constraint ml_folds_test_window_is_ordered check (test_end > test_start),
  -- The test window follows the training window. A fold that trains on the
  -- future is the leak this whole table exists to prevent, so it is refused by
  -- the database rather than caught in review.
  constraint ml_folds_tests_after_it_trains check (test_start >= train_end),
  constraint ml_folds_gaps_are_not_negative check (purge_bars >= 0 and embargo_bars >= 0),
  constraint ml_folds_are_ordered unique (run_id, fold_index)
);

create index if not exists idx_ml_folds_run on public.ml_folds (run_id, fold_index);

alter table public.ml_folds enable row level security;
revoke all on public.ml_folds from anon;

-- Reachable exactly when its run is. The fold rows carry no user_id of their
-- own: duplicating the owner is how two rows end up disagreeing about who owns
-- one experiment.
drop policy if exists "Traders read folds of their own runs" on public.ml_folds;
create policy "Traders read folds of their own runs"
  on public.ml_folds for select
  to authenticated
  using (exists (
    select 1 from public.ml_runs r
    where r.id = ml_folds.run_id and r.user_id = (select auth.uid())
  ));


-- ========================================================================
-- 20260820090200_ml_features.sql
-- ========================================================================

-- The feature set a run was fitted on, versioned.
--
-- A model is its features. Two runs of "logistic regression on BTCUSDT" that
-- used different windows are different experiments, and a params blob on
-- ml_runs cannot say which — it records the model's hyperparameters, not the
-- columns that went in.
--
-- `spec` is the exact, ordered definition: name, source series, window, and any
-- transform, as the builder emitted it. `spec_hash` is a digest of that
-- canonical form, so two runs can be compared for feature identity with an
-- equality test rather than by a human reading two JSON blobs side by side —
-- which is the comparison that actually gets skipped.
--
-- Deliberately NOT stored: the computed feature values. They are a function of
-- (spec_hash, data_hash) and both are recorded, so the matrix is rebuildable.
-- Storing a few hundred thousand floats per run to save a recomputation would
-- trade a cheap rebuild for a table nobody can afford to keep.

create table if not exists public.ml_features (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ml_runs(id) on delete cascade,

  --: Ordered, and the order is part of the identity: a linear model's
  --: coefficients are meaningless against a permuted feature vector.
  spec jsonb not null,
  spec_hash text not null,
  feature_count int not null,

  --: What the model was asked to predict. Forward return over a horizon is not
  --: the same experiment as next-bar direction, and the label is the half of a
  --: supervised setup that a "model" column never captures.
  label text not null,
  label_horizon_bars int not null,

  created_at timestamptz not null default now(),

  constraint ml_features_count_is_positive check (feature_count > 0),
  constraint ml_features_horizon_is_positive check (label_horizon_bars > 0),
  --: One feature set per run. A run that changed features mid-way is two runs.
  constraint ml_features_one_set_per_run unique (run_id)
);

create index if not exists idx_ml_features_spec on public.ml_features (spec_hash);

alter table public.ml_features enable row level security;
revoke all on public.ml_features from anon;

drop policy if exists "Traders read features of their own runs" on public.ml_features;
create policy "Traders read features of their own runs"
  on public.ml_features for select
  to authenticated
  using (exists (
    select 1 from public.ml_runs r
    where r.id = ml_features.run_id and r.user_id = (select auth.uid())
  ));


-- ========================================================================
-- 20260820090300_ml_artefacts.sql
-- ========================================================================

-- What a fitted run produced: coefficients small enough to inline, and a
-- pointer to Storage for anything that is not.
--
-- A ridge over forty features is eighty doubles and belongs in the row that
-- describes it. A gradient-boosted ensemble is megabytes and belongs in object
-- storage. Putting both in one column means either bloating every row or
-- inventing a second table later, so the split is here from the start and the
-- constraint below makes "exactly one of them" a database fact.
--
-- `sha256` is over the artefact bytes as written, whichever side it landed on.
-- Without it a Storage object can be replaced and every row still claims to
-- describe what it used to be — the same failure the OpenAPI digest exists to
-- prevent between the gateway and the workspace.

create table if not exists public.ml_artefacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ml_runs(id) on delete cascade,

  kind text not null check (kind in ('coefficients', 'tree_dump', 'scaler', 'report')),
  --: Inline for anything small. NULL when the artefact lives in Storage.
  payload jsonb,
  --: Storage object path. NULL when the artefact is inline.
  storage_path text,
  bytes bigint,
  --: Over the bytes as written, either way. A Storage object can be replaced;
  --: this is what notices.
  sha256 text not null,

  created_at timestamptz not null default now(),

  --: Exactly one home. Both would be two answers to "what did this run
  --: produce"; neither would be a row describing nothing.
  constraint ml_artefacts_have_exactly_one_home
    check ((payload is null) <> (storage_path is null)),
  constraint ml_artefacts_one_kind_per_run unique (run_id, kind)
);

create index if not exists idx_ml_artefacts_run on public.ml_artefacts (run_id);

alter table public.ml_artefacts enable row level security;
revoke all on public.ml_artefacts from anon;

drop policy if exists "Traders read artefacts of their own runs" on public.ml_artefacts;
create policy "Traders read artefacts of their own runs"
  on public.ml_artefacts for select
  to authenticated
  using (exists (
    select 1 from public.ml_runs r
    where r.id = ml_artefacts.run_id and r.user_id = (select auth.uid())
  ));


-- ========================================================================
-- 20260820090400_research_edges.sql
-- ========================================================================

-- GraphRAG, in Postgres, with no graph database.
--
-- The corpus already answers "what is similar to this" — hybrid dense+lexical
-- retrieval with RRF, built in 20260810090000. What it cannot answer is
-- "what is CONNECTED to this": every run that saw the same bars, the incident
-- that followed a promotion, the regime a parameter set was fitted in. Those
-- are relations between documents, and a fused similarity ranking has no way to
-- express them.
--
-- No Neo4j. The entities here are not the open-ended kind a general extractor
-- discovers — they are the desk's own vocabulary, already structured on every
-- document: symbol, interval, strategy, data_hash, regime, incident, order id,
-- model. Extraction is therefore a read of existing columns at card-render
-- time, not an LLM call, which keeps ingest deterministic and free. A link
-- table plus a recursive CTE traverses it, and a second database would buy
-- nothing except a second thing to keep in sync.

do $$ begin
  create type public.research_relation as enum (
    --: Both documents saw the same bars. The strongest claim in the corpus:
    --: results that disagree over one data_hash disagree about method, not data.
    'same_data',
    'same_symbol',
    'same_strategy',
    'same_regime',
    --: Directional, and the reason this is a graph rather than a tag cloud:
    --: dst happened after src and is plausibly downstream of it.
    'followed_by',
    --: A promotion and the execution or incident it led to.
    'promoted_to'
  );
exception
  when duplicate_object then null;  -- already applied
end $$;

create table if not exists public.research_edges (
  id uuid primary key default gen_random_uuid(),
  desk_id uuid not null default '00000000-0000-0000-0000-000000000001',

  src_id uuid not null references public.research_documents(id) on delete cascade,
  dst_id uuid not null references public.research_documents(id) on delete cascade,
  relation public.research_relation not null,
  --: What the two share, when the relation names a value: the data_hash, the
  --: symbol, the regime label. A traversal that cannot say WHY two documents
  --: are joined is a traversal nobody will trust the second time.
  evidence text,

  created_at timestamptz not null default now(),

  --: A document is not related to itself. Without this, a recursive traversal
  --: has a one-node cycle in it before it has visited anything.
  constraint research_edges_are_not_loops check (src_id <> dst_id),
  constraint research_edges_are_unique unique (src_id, dst_id, relation)
);

create index if not exists idx_research_edges_src on public.research_edges (src_id, relation);
create index if not exists idx_research_edges_dst on public.research_edges (dst_id, relation);

alter table public.research_edges enable row level security;
revoke all on public.research_edges from anon;

-- Both ends must be readable. An edge is a fact about two documents, and
-- reaching one you do not own THROUGH one you do is exactly the leak a graph
-- makes easy and a similarity search never could.
drop policy if exists "Traders read edges between their own documents" on public.research_edges;
create policy "Traders read edges between their own documents"
  on public.research_edges for select
  to authenticated
  using (
    exists (select 1 from public.research_documents d
             where d.id = research_edges.src_id and d.user_id = (select auth.uid()))
    and
    exists (select 1 from public.research_documents d
             where d.id = research_edges.dst_id and d.user_id = (select auth.uid()))
  );


-- ========================================================================
-- 20260820090500_research_graph_traverse.sql
-- ========================================================================

-- Traversal over research_edges: the answers similarity ranking cannot give.
--
-- `match_research_documents_hybrid` answers "what is similar to this". This
-- answers "what is reachable from this, and by what path" — every run that
-- shared a data hash, the incident that followed a promotion, the chain of two
-- hops that connects a parameter set to a drawdown.
--
-- WHY A RECURSIVE CTE AND NOT A GRAPH DATABASE
--
-- The corpus is small, the edges are derived from columns the desk already has,
-- and the questions are bounded — two or three hops, never "find me all paths".
-- Postgres does this in one statement against indexes that already exist. A
-- graph database would add a query language, a second store to keep in sync,
-- and a second place for the RLS boundary to be got wrong.
--
-- DEPTH IS BOUNDED AND THE PATH IS CARRIED
--
-- `max_depth` is capped at 4 in the body regardless of what the caller asks
-- for. An unbounded traversal over a growing corpus is a query that gets slower
-- every week until someone notices; a bounded one has a worst case that can be
-- reasoned about. And every row carries the ids it travelled through, both so a
-- reader can be told WHY a document surfaced and so the walk can refuse to
-- revisit a node — an undirected reading of a directed table has cycles in it
-- the moment two documents share both a data hash and a symbol.

create or replace function public.traverse_research_graph(
  start_id uuid,
  max_depth int default 2,
  relations public.research_relation[] default null,
  match_count int default 20
)
returns table (
  id uuid,
  kind public.research_doc_kind,
  source_ref text,
  symbol text,
  strategy text,
  occurred_at timestamptz,
  title text,
  depth int,
  --: How this document was reached. The last relation traversed, so a caller
  --: can say "shares a data hash" rather than "is related".
  arrived_by public.research_relation,
  --: What that relation had in common — the hash, the symbol, the regime.
  evidence text,
  --: Every node on the way here, start first. A traversal that cannot show its
  --: path is one nobody checks the second time.
  path uuid[]
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with recursive walk as (
    select
      d.id,
      0 as depth,
      null::public.research_relation as arrived_by,
      null::text as evidence,
      array[d.id] as path
    from public.research_documents d
    where d.id = start_id

    union all

    -- Both directions in one arm. Symmetric edges are stored once, older to
    -- newer, so reading src->dst only would make the traversal depend on which
    -- of two documents the caller happened to start from.
    select
      next_id,
      w.depth + 1,
      rel,
      ev,
      w.path || next_id
    from walk w
    cross join lateral (
      select e.dst_id as next_id, e.relation as rel, e.evidence as ev
        from public.research_edges e
       where e.src_id = w.id
      union all
      select e.src_id, e.relation, e.evidence
        from public.research_edges e
       where e.dst_id = w.id
    ) step
    where w.depth < least(greatest(max_depth, 1), 4)
      -- Never revisit. Without this an undirected read of a directed table
      -- loops the moment two documents share more than one entity.
      and not (next_id = any(w.path))
      and (relations is null or rel = any(relations))
  )
  select
    d.id, d.kind, d.source_ref, d.symbol, d.strategy, d.occurred_at, d.title,
    w.depth, w.arrived_by, w.evidence, w.path
  from (
    -- One row per document, at the SHORTEST depth it was reached. A document
    -- two hops away that is also four hops away is two hops away.
    select distinct on (id) id, depth, arrived_by, evidence, path
      from walk
     where depth > 0
     order by id, depth, arrived_by
  ) w
  join public.research_documents d on d.id = w.id
  order by w.depth, d.occurred_at desc
  limit greatest(1, least(match_count, 100));
$$;

comment on function public.traverse_research_graph is
  'Documents reachable from one document over research_edges, shortest depth '
  'first, carrying the relation and the path that reached each. Depth is capped '
  'at 4 and revisits are refused.';


-- ========================================================================
-- 20260820090600_research_doc_kind_ml_run.sql
-- ========================================================================

-- 'ml_run' joins the corpus's kind vocabulary.
--
-- A supervised run is not a backtest_run. It shares the provenance — the same
-- data_hash, the same deflated Sharpe — but it also has a fitted model, a
-- feature spec and folds with a purge, and a reader filtering the corpus for
-- "what has this desk fitted" cannot get there through a kind that also means
-- "moving-average sweep". Kinds are how this corpus is filtered
-- (match_research_documents_hybrid takes filter_kind), so collapsing the two
-- would make that filter answer a question nobody asked.
--
-- ADD VALUE rather than a new type. Rewriting the enum would mean rewriting
-- every row in research_documents and every function that names the type; the
-- value is appended, which is a catalogue change and touches no data.
--
-- Postgres will not let a value added in a transaction be USED in that same
-- transaction. Supabase runs each migration file in one, so this file adds the
-- value and nothing else — the first insert that uses it necessarily happens
-- in a later statement, from the application.

alter type public.research_doc_kind add value if not exists 'ml_run';


-- ========================================================================
-- 20260820100000_data_quality_findings.sql
-- ========================================================================

-- E3.1 — data_quality_findings in Postgres.
--
-- The mirror of the SQLite table in `modules/data_quality.py`. Types are the
-- Postgres equivalents of the SQLite ones, not a redesign: the store writes
-- epoch milliseconds as REAL and booleans as 0/1 INTEGER, and changing either
-- here would make the two backends disagree about the same row. `double
-- precision` and `smallint` keep the wire shape identical.
--
-- `desk_id` is the tenancy column every other table in this project carries.
-- The gateway holds the service-role key and filters in the query rather than
-- relying on RLS, for the reason recorded on `ml_runs`: `trader_identity`
-- resolves to an access decision, not a user, so there is no `auth.uid()` for
-- a policy to compare against.

create table if not exists public.data_quality_findings (
  id             bigint generated always as identity primary key,
  desk_id        text        not null default 'default',
  instance       text        not null,
  seq            bigint      not null,
  source         text        not null,
  observed_at    double precision not null,
  received_at    double precision not null,
  capability     text        not null,
  provider       text        not null,
  symbol         text,
  key            text        not null,
  passed         smallint    not null,
  fatal          smallint    not null,
  warn           smallint    not null,
  drift          smallint    not null,
  not_evaluated  smallint    not null,
  checks_json    text        not null,
  unique (desk_id, instance, seq)
);

create index if not exists ix_dq_findings_observed
  on public.data_quality_findings (desk_id, observed_at);
create index if not exists ix_dq_findings_provider
  on public.data_quality_findings (desk_id, provider, observed_at);

alter table public.data_quality_findings enable row level security;

-- Service role only. No anon or authenticated policy is granted: these rows are
-- operational evidence written by the gateway, and the browser reaches them
-- through the gateway's own routes rather than directly.


-- ========================================================================
-- 20260820100100_data_quality_escalations.sql
-- ========================================================================

-- E3.2 — data_quality_escalations in Postgres.
--
-- `acknowledged_at`/`acknowledged_by` are declared here rather than added by a
-- later ALTER. The SQLite store has no migration table, so it grows columns
-- conditionally at construction (`_ESCALATION_COLUMNS`); Postgres has proper
-- migrations, so the column exists from the start. NULL carries the same
-- meaning on both sides: nobody has acknowledged this.

create table if not exists public.data_quality_escalations (
  id              bigint generated always as identity primary key,
  desk_id         text     not null default 'default',
  rule            text     not null,
  provider        text     not null,
  opened_at       double precision not null,
  window_minutes  integer  not null,
  count           integer  not null,
  evaluated       integer,
  detail          text     not null,
  notified_at     double precision,
  channel         text,
  resolved_at     double precision,
  acknowledged_at double precision,
  acknowledged_by text
);

create index if not exists ix_dq_esc_rule
  on public.data_quality_escalations (desk_id, rule, provider, opened_at);

-- Open escalations are the ones every read path asks for, and they are a small
-- minority of the table once a desk has been running. Partial index rather than
-- a scan.
create index if not exists ix_dq_esc_open
  on public.data_quality_escalations (desk_id, provider)
  where resolved_at is null;

alter table public.data_quality_escalations enable row level security;


-- ========================================================================
-- 20260820100200_data_schedule_runs.sql
-- ========================================================================

-- E3.3 — data_schedule_runs in Postgres.
--
-- One row per schedule, upserted. The SQLite version is
-- `INSERT … ON CONFLICT(schedule_id) DO UPDATE`; over PostgREST the same
-- operation is a POST with `Prefer: resolution=merge-duplicates`, which needs
-- the unique constraint below to have something to conflict on.

create table if not exists public.data_schedule_runs (
  desk_id       text not null default 'default',
  schedule_id   text not null,
  last_run_at   double precision,
  last_job_id   text,
  last_outcome  text,
  primary key (desk_id, schedule_id)
);

alter table public.data_schedule_runs enable row level security;


-- ========================================================================
-- 20260820100300_data_work_items.sql
-- ========================================================================

-- E3.4 — data_work_items in Postgres, and the id sequence SQLite did by hand.
--
-- `WorkItemStore.create` mints ids as
-- `MAX(CAST(substr(id, ?) AS INTEGER)) + 1` inside a transaction, per prefix.
-- That is a read-modify-write standing in for a sequence because SQLite has
-- none. Postgres does, so the prefixes get real sequences and the RPC below
-- allocates from them atomically — which is stronger than the lock it replaces,
-- not weaker.
--
-- The sequences are seeded to match the committed fixture: `test_work_items.py`
-- pins the literal next ids `BUG-095` and `REQ-188`, so they start at 95 and
-- 188. A sequence that started at 1 would pass every behavioural test and fail
-- that one, which is the test doing its job.

create table if not exists public.data_work_items (
  id          text primary key,
  desk_id     text not null default 'default',
  kind        text not null check (kind in ('request', 'ticket', 'bug')),
  priority    text not null check (priority in ('P0', 'P1', 'P2', 'P3')),
  status      text not null check (status in ('intake', 'ready', 'progress', 'resolved')),
  title       text not null,
  summary     text not null default '',
  owner       text not null default 'Unassigned',
  area        text not null default 'Pipeline',
  opened_at   double precision not null,
  sla_due_at  double precision,
  resolved_at double precision,
  created_by  text not null,
  updated_at  double precision not null,
  updated_by  text not null,
  version     integer not null default 1
);

create index if not exists ix_work_items_status
  on public.data_work_items (desk_id, status, priority, opened_at);

create sequence if not exists public.work_item_bug_seq start with 95;
create sequence if not exists public.work_item_req_seq start with 188;
create sequence if not exists public.work_item_tkt_seq start with 323;

-- One id, allocated atomically. Returns the formatted id rather than the raw
-- number so the caller cannot format it two different ways.
create or replace function public.next_work_item_id(prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  case upper(prefix)
    when 'BUG' then n := nextval('public.work_item_bug_seq');
    when 'REQ' then n := nextval('public.work_item_req_seq');
    when 'TKT' then n := nextval('public.work_item_tkt_seq');
    else raise exception 'unknown work item prefix: %', prefix;
  end case;
  return upper(prefix) || '-' || lpad(n::text, 3, '0');
end;
$$;

alter table public.data_work_items enable row level security;


-- ========================================================================
-- 20260820100400_data_quality_rollup.sql
-- ========================================================================

-- E3.10 — the aggregate half of the quality ledger, server-side.
--
-- PostgREST cannot express `SELECT provider, COUNT(*), SUM(passed) … GROUP BY
-- provider` as a filter on a table, and the honest options were a view per
-- rollup or one function that returns the whole aggregate in a single round
-- trip. This is the second: the SQLite backend builds this shape from four
-- queries against a local file, where a network backend paying four round
-- trips for one panel would be the wrong trade.
--
-- The column list mirrors `_AGGREGATE` in modules/data_quality.py exactly. If
-- one moves and the other does not, the two backends report different numbers
-- for the same window — so the Python constant and this function are a pair,
-- and `tests/test_data_quality_rollup.py` asserts they name the same columns.

create or replace function public.data_quality_rollup(
  p_desk_id text,
  p_since   double precision
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select *
      from public.data_quality_findings
     where desk_id = p_desk_id
       and observed_at >= p_since
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'evaluated', count(*),
        'passed', coalesce(sum(passed), 0),
        'fatal', coalesce(sum(fatal), 0),
        'warn', coalesce(sum(warn), 0),
        'drift', coalesce(sum(drift), 0),
        'not_evaluated', coalesce(sum(not_evaluated), 0)
      ) from scoped
    ),
    'bounds', (
      select jsonb_build_object(
        'first_at', min(observed_at),
        'last_at', max(observed_at),
        'instances', count(distinct instance)
      ) from scoped
    ),
    'by_provider', coalesce((
      select jsonb_agg(row order by row->>'provider')
        from (
          select jsonb_build_object(
            'provider', provider,
            'evaluated', count(*),
            'passed', coalesce(sum(passed), 0),
            'fatal', coalesce(sum(fatal), 0),
            'warn', coalesce(sum(warn), 0),
            'drift', coalesce(sum(drift), 0),
            'not_evaluated', coalesce(sum(not_evaluated), 0)
          ) as row
            from scoped
           group by provider
        ) p
    ), '[]'::jsonb),
    'by_capability', coalesce((
      select jsonb_agg(row order by row->>'capability')
        from (
          select jsonb_build_object(
            'capability', capability,
            'evaluated', count(*),
            'passed', coalesce(sum(passed), 0),
            'fatal', coalesce(sum(fatal), 0),
            'warn', coalesce(sum(warn), 0),
            'drift', coalesce(sum(drift), 0),
            'not_evaluated', coalesce(sum(not_evaluated), 0)
          ) as row
            from scoped
           group by capability
        ) c
    ), '[]'::jsonb)
  );
$$;


-- ========================================================================
-- 20260820100500_data_quality_provider_stats.sql
-- ========================================================================

-- E3.10 — the escalation rules' conditional aggregate, server-side.
--
-- The rule engine asks one question per provider per tick: of the findings in
-- the window, how many were evaluated, how many failed, and how many carried a
-- fatal check. In SQL that is SUM(CASE WHEN passed=0 THEN 1 ELSE 0 END), which
-- PostgREST cannot express against a table any more than it can express the
-- GROUP BY rollup beside it.
--
-- Kept separate from `data_quality_rollup` because it is asked for ONE provider
-- at a time, inside a loop over open escalations. Folding it into the panel
-- rollup would return every provider's counts to answer a question about one.

create or replace function public.data_quality_provider_stats(
  p_desk_id  text,
  p_provider text,
  p_since    double precision
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'evaluated', count(*),
    'failed', coalesce(sum(case when passed = 0 then 1 else 0 end), 0),
    'fatal_findings', coalesce(sum(case when fatal > 0 then 1 else 0 end), 0)
  )
    from public.data_quality_findings
   where desk_id = p_desk_id
     and provider = p_provider
     and observed_at >= p_since;
$$;
