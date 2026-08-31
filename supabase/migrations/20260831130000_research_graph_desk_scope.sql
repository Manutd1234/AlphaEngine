-- Tenant-scoped traversal over the research graph.
--
-- `20260822090000_research_tenant_scope.sql` added `filter_desk_id` to both
-- similarity-search RPCs, but graph traversal remained a full-corpus read. The
-- gateway uses the service-role key, so RLS does not narrow this function for
-- it; the predicate has to live inside the SQL the service-role session runs.
--
-- NULL IS DELIBERATELY UNSCOPED. `RESEARCH_SCOPE_TO_DESK` remains off by
-- default while this migration is rolled out. An old caller therefore keeps
-- the old result set, while a caller that explicitly supplies a desk gets a
-- walk whose seed, edges and documents all belong to that desk.
--
-- WHY EVERY PREDICATE IS PRESENT
--
-- The seed predicate stops a caller starting from another desk's document.
-- Each edge arm is scoped because the graph is read in both directions. The
-- next-document joins stop a malformed or historical cross-desk edge from
-- admitting its opposite endpoint. The final join repeats the document scope
-- at the projection boundary, so no future change to the recursive CTE can
-- turn a scoped walk into an unscoped response.
--
-- WHY DROP AND RECREATE
--
-- PostgreSQL identifies a function by name and argument types. Adding a
-- defaulted argument with `create or replace` would create an overload, and a
-- PostgREST request using only the old arguments could then be ambiguous. Drop
-- the exact old signature first, then recreate one callable shape.

drop function if exists public.traverse_research_graph(
  uuid, integer, public.research_relation[], integer
);

create or replace function public.traverse_research_graph(
  start_id uuid,
  max_depth int default 2,
  relations public.research_relation[] default null,
  match_count int default 20,
  filter_desk_id uuid default null
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
  arrived_by public.research_relation,
  evidence text,
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
      and (filter_desk_id is null or d.desk_id = filter_desk_id)

    union all

    select
      step.next_id,
      w.depth + 1,
      step.rel,
      step.ev,
      w.path || step.next_id
    from walk w
    cross join lateral (
      select e.dst_id as next_id, e.relation as rel, e.evidence as ev
        from public.research_edges e
        join public.research_documents next_document
          on next_document.id = e.dst_id
       where e.src_id = w.id
         and (filter_desk_id is null or e.desk_id = filter_desk_id)
         and (filter_desk_id is null or next_document.desk_id = filter_desk_id)
      union all
      select e.src_id, e.relation, e.evidence
        from public.research_edges e
        join public.research_documents next_document
          on next_document.id = e.src_id
       where e.dst_id = w.id
         and (filter_desk_id is null or e.desk_id = filter_desk_id)
         and (filter_desk_id is null or next_document.desk_id = filter_desk_id)
    ) step
    where w.depth < least(greatest(max_depth, 1), 4)
      and not (step.next_id = any(w.path))
      and (relations is null or step.rel = any(relations))
  )
  select
    d.id, d.kind, d.source_ref, d.symbol, d.strategy, d.occurred_at, d.title,
    w.depth, w.arrived_by, w.evidence, w.path
  from (
    select distinct on (id) id, depth, arrived_by, evidence, path
      from walk
     where depth > 0
     order by id, depth, arrived_by
  ) w
  join public.research_documents d
    on d.id = w.id
   and (filter_desk_id is null or d.desk_id = filter_desk_id)
  order by w.depth, d.occurred_at desc
  limit greatest(1, least(match_count, 100));
$$;

comment on function public.traverse_research_graph(
  uuid, integer, public.research_relation[], integer, uuid
) is
  'Documents reachable over research_edges, shortest depth first. '
  'filter_desk_id optionally scopes the seed, both edge directions, every '
  'reached document and the final projection; null preserves unscoped behaviour.';

-- Dropping the old function dropped its ACL, and PostgreSQL grants EXECUTE on
-- a new function to PUBLIC by default. State the complete intended ACL: only
-- the service-role gateway may call this RPC directly.
revoke execute on function public.traverse_research_graph(
  uuid, integer, public.research_relation[], integer, uuid
) from public, anon, authenticated;
grant execute on function public.traverse_research_graph(
  uuid, integer, public.research_relation[], integer, uuid
) to service_role;

notify pgrst, 'reload schema';
