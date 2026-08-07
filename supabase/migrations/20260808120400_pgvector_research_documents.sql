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

create type public.research_doc_kind as enum (
  'backtest_run',
  'execution_summary',
  'risk_incident'
);

create table public.research_documents (
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

create index idx_research_docs_embedding
  on public.research_documents
  using hnsw (embedding extensions.vector_cosine_ops);
create index idx_research_docs_kind_time
  on public.research_documents (kind, occurred_at desc);

alter table public.research_documents enable row level security;
revoke all on public.research_documents from anon;

create policy "Traders read own research documents"
  on public.research_documents for select
  to authenticated
  using ((select auth.uid()) = user_id);
