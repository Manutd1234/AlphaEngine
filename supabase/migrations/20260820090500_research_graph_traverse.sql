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
