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
    1 - (d.embedding <=> query_embedding) as similarity
  from public.research_documents d
  where d.embedding is not null
    and d.embedding_status = 'ready'
    and (filter_kind is null or d.kind = filter_kind)
    and 1 - (d.embedding <=> query_embedding) >= min_similarity
  order by d.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;
