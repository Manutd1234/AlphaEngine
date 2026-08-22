-- A FOURTH retrieval arm: the chart's PIXELS, beside the sentence about it.
--
-- WHAT IS ALREADY TRUE, AND STAYS TRUE
--
-- `20260820100700_research_doc_kind_chart.sql` made charts retrievable by
-- DESCRIPTION: a sweep writes one document per figure it drew, and the text is
-- rendered from the numbers the desk computed in order to draw that figure.
-- `modules/research_chartdoc.py` argues why that is the right FIRST answer and
-- the argument stands unaltered — a computed figure is exact where a vision
-- model is approximate, it costs nothing, and it needs no new dependency.
--
-- WHAT IT CANNOT REACH
--
-- Everything about a chart that is not a number the desk computed. The SHAPE of
-- an equity curve — one steady climb versus the same terminal multiple reached
-- by a spike and a plateau. A rendering artefact. A recovery that is visible as
-- a shape long before it is a figure in any table. No sentence built from
-- `total_return_x`, `max_drawdown` and `trades` states any of those, because
-- the desk never computed them; they are properties of the drawing.
--
-- So this migration adds the column that holds an embedding OF THE IMAGE, and
-- the function that ranks by it. It ADDS an arm. It replaces nothing: the
-- description documents, their vectors and the three arms that rank them are
-- untouched by this file, and a deployment that never populates the new column
-- retrieves exactly what it retrieves today.
--
-- WHY 512 DIMENSIONS
--
-- The gateway embeds with fastembed's shared CLIP ViT-B/32 pair —
-- `Qdrant/clip-ViT-B-32-vision` for the image and `Qdrant/clip-ViT-B-32-text`
-- for the query — which is 512-d on both sides and, crucially, ONE space. That
-- is the whole reason a text query can be compared against an image vector at
-- all. It is also the reason this column is separate from `embedding` rather
-- than being written into it: `embedding` is 384-d gte-small, and a gte-small
-- query vector compared against a CLIP image vector is not a worse ranking, it
-- is a meaningless one. Two models, two spaces, two columns, two indexes.
--
-- ONNX on the gateway's CPU, which is what makes this possible here at all. The
-- Supabase Edge runtime's `Supabase.ai.Session` exposes gte-small and takes no
-- image — the constraint `research_chartdoc.py` records — so the embedding runs
-- in the Python gateway and this table only ever sees the finished vector. No
-- new edge function, no Vertex, no GCP, no key.
--
-- THE HONEST CAVEAT, WRITTEN HERE BECAUSE IT WILL OUTLIVE THE CODE
--
-- CLIP is trained on natural images: photographs, drawings, things with
-- objects in them. A matplotlib line chart on a white ground is an odd domain
-- for it, and how much genuine retrieval quality this arm delivers on THIS
-- corpus is an EMPIRICAL question that nothing in this file settles.
-- `web/lib/retrieval-eval.ts` is where it would be measured, the same way
-- `RAG_MIN_SIMILARITY` was measured rather than chosen. Until it is, the arm
-- is optional at every layer and never displaces a ranking that is understood.
--
-- WHY `image_embedding_status` HAS A VALUE THE TEXT COLUMN DOES NOT
--
-- `embedding_status` defaults to 'pending' because every document in this
-- corpus owes a text vector. MOST documents owe no image vector at all — an
-- incident card, an ML run card, a session summary and three of the four chart
-- descriptions have no picture — so 'pending' would mark them as work the
-- backfill must one day do, and the backfill would then chase rows that will
-- never have an image. 'absent' is the typed state for "this document has no
-- image", distinct from 'pending' ("it has one and the encoder has not run"),
-- 'ready' and 'failed'. Absence with a name, rather than absence disguised as
-- a queue.
--
-- NEVER A ZERO VECTOR. A failed image embed leaves the column NULL and the
-- status 'failed' or 'pending', exactly as the text side does. A 512-d zero
-- vector is equidistant from everything under cosine distance and would be
-- returned as "similar" to every query ever asked — the defect this codebase is
-- most alert to, and it is no less a defect for being in a new column.

alter table public.research_documents
  add column if not exists image_embedding extensions.vector(512);

alter table public.research_documents
  add column if not exists image_embedding_model text;

alter table public.research_documents
  add column if not exists image_embedding_status text not null default 'absent';

-- Added separately and named, so a later migration can drop or widen it without
-- rewriting the column. `not valid` is deliberately NOT used: the table holds
-- no image rows yet, so validating costs one scan of a corpus this size and
-- buys a constraint that is trustworthy from its first day.
alter table public.research_documents
  drop constraint if exists research_documents_image_embedding_status_check;
alter table public.research_documents
  add constraint research_documents_image_embedding_status_check
  check (image_embedding_status in ('absent', 'pending', 'ready', 'failed'));

-- PARTIAL, unlike `idx_research_docs_embedding`, and the difference is the
-- population rather than a change of mind. Every row has a text vector; only a
-- chart row has an image one, and on today's corpus that is roughly one
-- document in four. An unfiltered HNSW index would build graph structure over
-- the nulls it can never return, so the predicate is both smaller and exactly
-- the predicate the ranking function below applies.
create index if not exists idx_research_docs_image_embedding
  on public.research_documents
  using hnsw (image_embedding extensions.vector_cosine_ops)
  where image_embedding is not null;

-- The image ranking. A RANKING, not a fusion, and that is the design decision
-- this function is built around.
--
-- `match_research_documents_hybrid` fuses its two arms in SQL because both of
-- them live in SQL. The third arm does not: `modules/research_bm25.py` re-scores
-- the returned rows in the gateway, so the fused score the desk actually serves
-- is computed in Python. Fusing the image arm here would mean this function
-- recomputing the vector rank, the lexical rank AND somehow the BM25 rank in
-- order to add a fourth — a second fusion, in a second language, that would
-- drift from the first the day either changed. So this returns positions and
-- similarities, the gateway adds `1/(k + image_rank)` at the SAME k = 60 the
-- other three use, and there is exactly one place that knows how the four
-- arms combine.
--
-- `min_similarity` DEFAULTS TO NULL AND NULL MEANS NO FLOOR — never "match rows
-- whose similarity is null". `match_research_documents` floors at 0.76 because
-- that number was measured against gte-small's compressed similarity range.
-- CLIP image-text cosine similarities live on a completely different and much
-- lower range, so reusing 0.76 would silently return nothing at all, and
-- inventing a CLIP number here would be exactly the unmeasured constant this
-- codebase refuses. The floor exists as an argument so it can be set once
-- somebody has measured one; unset, the arm is bounded by `match_count`
-- instead, and RRF's `1/(k + rank)` keeps a weak image match well below a
-- document three arms agreed on.
create or replace function public.match_research_document_images(
  query_embedding extensions.vector(512),
  match_count int default 5,
  filter_kind public.research_doc_kind default null,
  filter_desk_id uuid default null,
  filter_user_id uuid default null,
  min_similarity float default null
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
  image_similarity float,
  image_rank int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with candidates as (
    -- The tenant predicate goes HERE, in the candidate set, for the reason
    -- `20260822090000_research_tenant_scope.sql` spells out at length: the rank
    -- below is a position WITHIN this CTE, and scoping after the rank was taken
    -- would hand back a "rank 3" that counted another desk's documents ahead of
    -- it. Scoping first makes every rank a statement about rows the caller was
    -- allowed to see.
    select d.id, d.kind, d.source_ref, d.symbol, d.strategy, d.occurred_at,
           d.title, d.body, d.metrics,
           1 - (d.image_embedding operator(extensions.<=>) query_embedding) as sim
      from public.research_documents d
     where d.image_embedding is not null
       and d.image_embedding_status = 'ready'
       and (filter_kind is null or d.kind = filter_kind)
       and (filter_desk_id is null or d.desk_id = filter_desk_id)
       and (filter_user_id is null or d.user_id = filter_user_id)
  )
  select c.id, c.kind, c.source_ref, c.symbol, c.strategy, c.occurred_at,
         c.title, c.body, c.metrics,
         c.sim as image_similarity,
         row_number() over (order by c.sim desc)::int as image_rank
    from candidates c
   where min_similarity is null or c.sim >= min_similarity
   order by c.sim desc
   limit greatest(1, least(match_count, 20));
$$;

comment on column public.research_documents.image_embedding is
  'CLIP ViT-B/32 vision embedding (512-d) of the chart PNG. NULL when the '
  'document has no image or the encoder could not run — never a zero vector, '
  'which is equidistant from everything under cosine distance.';

comment on column public.research_documents.image_embedding_status is
  'absent = this document has no image; pending = it has one and no vector was '
  'produced; ready = the vector is usable; failed = the encoder refused it.';

comment on function public.match_research_document_images is
  'Ranks documents by CLIP image similarity to a CLIP TEXT query vector — the '
  'same 512-d space, which is what makes the comparison meaningful. Returns a '
  'rank, not a fused score: the gateway fuses all four arms at RRF k=60. '
  'filter_desk_id / filter_user_id scope the candidate set; null is unscoped. '
  'min_similarity null means no floor, never "similarity is null".';

-- The gateway reads with the service role, which is unaffected by this; anon
-- and authenticated are revoked for the reason `20260812091000` gives, and a
-- newly created function is executable by PUBLIC until somebody says otherwise.
revoke execute on function public.match_research_document_images(
  extensions.vector, integer, public.research_doc_kind, uuid, uuid, double precision
) from anon, authenticated;
