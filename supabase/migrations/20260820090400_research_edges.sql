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

create table public.research_edges (
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

create index idx_research_edges_src on public.research_edges (src_id, relation);
create index idx_research_edges_dst on public.research_edges (dst_id, relation);

alter table public.research_edges enable row level security;
revoke all on public.research_edges from anon;

-- Both ends must be readable. An edge is a fact about two documents, and
-- reaching one you do not own THROUGH one you do is exactly the leak a graph
-- makes easy and a similarity search never could.
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
