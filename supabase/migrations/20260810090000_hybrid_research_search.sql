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
