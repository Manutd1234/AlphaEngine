-- An OPTIONAL tenant predicate on the two retrieval functions.
--
-- WHAT WAS ACTUALLY WRONG
--
-- `20260808120400_pgvector_research_documents.sql` enables row level security on
-- research_documents and writes the policy "Traders read own research documents"
-- as `(select auth.uid()) = user_id`. Three separate facts make that policy
-- decorative rather than protective today:
--
--   * the writer never sets `user_id`. `modules/research_rag/writer.py` stamps
--     `desk_id` on every row it inserts and nothing else, so `user_id` is NULL
--     corpus-wide and the policy's predicate is NULL = uuid, which is NULL,
--     which is not true — the policy would refuse EVERY row rather than the
--     right ones, if it were ever consulted;
--   * it is not consulted. The gateway reads with the service role key, and the
--     service role bypasses RLS by design. A policy nobody's session evaluates
--     is a comment with a syntax;
--   * neither retrieval function takes a tenant argument at all, so even a
--     caller that wanted to scope a search had no way to say so. A search spans
--     every row in the table, whoever wrote it.
--
-- The third is the one this migration fixes, because it is the one that has to
-- be fixed FIRST: RLS on a service-role connection cannot be turned back on
-- without taking every reader offline, whereas a predicate inside the function
-- scopes the read on the connection the gateway actually uses. The first two
-- remain owed — the writer must set `user_id`, and the gateway should read
-- through a user JWT rather than the service role — and neither is undone by
-- what is added here.
--
-- WHY THE PREDICATE IS OPTIONAL, AND WHY THAT IS NOT A HALF MEASURE
--
-- `filter_desk_id` and `filter_user_id` both default to null, and null means
-- "do not scope" rather than "match rows whose column is null". A deployment
-- that passes neither gets byte-for-byte today's result set, which is what lets
-- this land before `modules/research_rag/retrieval.py` learns to pass them and
-- before the route is switched on. A required argument would have made this
-- migration and two Python files one atomic change across three owners, and the
-- rejected version of that is a scoped RPC deployed against a caller that does
-- not pass the argument — an immediate 404 on every search.
--
-- DESK BEFORE USER, and the order is evidence rather than preference.
-- `desk_id` is `not null` with a default and IS populated on every row the
-- writer has ever inserted. `user_id` is populated on none of them. So
-- `filter_desk_id` is the predicate that can be switched on today and
-- `filter_user_id` is the one that becomes useful the day the writer starts
-- stamping it. Both are here because adding the second parameter later would
-- mean a second drop-and-recreate of two functions, and because a caller that
-- passes `filter_user_id` against today's corpus gets an EMPTY result — which
-- is honest ("no row belongs to you") rather than a silent full-corpus read.
--
-- WHY DROP AND RECREATE RATHER THAN `create or replace`
--
-- `create or replace function` matches on the argument list. Adding two
-- defaulted parameters therefore creates an OVERLOAD, and a PostgREST call
-- naming only the original arguments then matches both candidates and fails
-- with "function is not unique" — every search 300s at once. Dropping the old
-- signature by its exact argument types is what makes the replacement a
-- replacement. Nothing is lost: these are stable SQL functions holding no data.
--
-- DROPPING A FUNCTION DROPS ITS ACL. `20260812091000_close_authenticated_writes.sql`
-- revoked execute on both of these from anon and authenticated, and a fresh
-- function is created with execute granted to PUBLIC. The revokes are repeated
-- at the bottom of this file for that reason — leaving them out would reopen,
-- as a side effect of adding a tenancy predicate, exactly the grant that
-- migration closed.

drop function if exists public.match_research_documents(
  extensions.vector, integer, double precision, public.research_doc_kind
);

create or replace function public.match_research_documents(
  query_embedding extensions.vector(384),
  match_count int default 3,
  min_similarity float default 0.0,
  filter_kind public.research_doc_kind default null,
  filter_desk_id uuid default null,
  filter_user_id uuid default null
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
    -- `is null or` and never `d.desk_id is not distinct from filter_desk_id`:
    -- the second reads as an equality that also matches nulls, which would turn
    -- an unscoped call into a search for rows with no desk. Null here means
    -- "the caller did not ask to be scoped", not "match the rows with no owner".
    and (filter_desk_id is null or d.desk_id = filter_desk_id)
    and (filter_user_id is null or d.user_id = filter_user_id)
    and 1 - (d.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by d.embedding operator(extensions.<=>) query_embedding
  limit greatest(1, least(match_count, 20));
$$;

drop function if exists public.match_research_documents_hybrid(
  extensions.vector, text, integer, public.research_doc_kind, integer
);

create or replace function public.match_research_documents_hybrid(
  query_embedding extensions.vector(384),
  query_text text,
  match_count int default 5,
  filter_kind public.research_doc_kind default null,
  rrf_k int default 60,
  filter_desk_id uuid default null,
  filter_user_id uuid default null
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
    -- THE PREDICATE GOES HERE, in `candidates`, and that placement is the whole
    -- correctness argument of this function. Both rankings below are computed
    -- over this CTE, and `lexical_rank`/`vector_rank` are positions WITHIN it.
    -- Filtering after the ranks were taken would return this desk's rows
    -- carrying ranks that counted another desk's documents ahead of them —
    -- fusion scores derived from a population the caller may not see, and a
    -- "rank 4 of 5" that silently means "rank 4 of everybody". Scoping first
    -- makes every rank a statement about the rows the caller was allowed.
    select d.*,
           1 - (d.embedding operator(extensions.<=>) query_embedding) as sim
      from public.research_documents d
     where d.embedding is not null
       and d.embedding_status = 'ready'
       and (filter_kind is null or d.kind = filter_kind)
       and (filter_desk_id is null or d.desk_id = filter_desk_id)
       and (filter_user_id is null or d.user_id = filter_user_id)
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

comment on function public.match_research_documents is
  'Dense similarity search. filter_desk_id / filter_user_id are OPTIONAL tenant '
  'predicates: null means unscoped, never "rows whose owner is null".';

comment on function public.match_research_documents_hybrid is
  'Vector and lexical rankings fused by Reciprocal Rank Fusion (k=60). '
  'Returns both source ranks so a caller can show WHY a document surfaced. '
  'filter_desk_id / filter_user_id scope the CANDIDATE set, so every rank is a '
  'position among rows the caller was allowed to see; null means unscoped.';

-- Re-applied, not decorative: the drops above discarded the ACL these two
-- statements installed in 20260812091000, and a newly created function is
-- executable by PUBLIC. The gateway reads with the service role, which is
-- unaffected by either statement.
revoke execute on function public.match_research_documents(
  extensions.vector, integer, double precision, public.research_doc_kind, uuid, uuid
) from anon, authenticated;
revoke execute on function public.match_research_documents_hybrid(
  extensions.vector, text, integer, public.research_doc_kind, integer, uuid, uuid
) from anon, authenticated;
