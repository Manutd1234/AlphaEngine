-- The chart's PIXELS, durable — and deliberately UNREACHABLE from any retrieval.
--
-- THE LIMIT THIS CLOSES
--
-- `modules/research_generate_vision.py` shows the model the equity curve while
-- it answers, and it was MEASURED reading a -34% drawdown injection back off
-- those pixels. But the bytes only ever existed in one place: the finished
-- `JobRecord` held in the gateway process that ran the sweep. So the resolver
-- walked corpus row -> `<job id>:<chart>` -> `modules.jobs` -> `result
-- ["equity_curve_png"]`, and reported the typed state `job_not_retained`
-- whenever that record was not in THIS process's memory.
--
-- That is honest and it is also exactly backwards. `job_not_retained` is rare
-- on a laptop with the in-process pool and is the NORMAL answer under the
-- Celery backend, after any restart, and on every replica that did not happen
-- to serve the sweep — that is, the feature was absent precisely on the
-- deployment that scales. A capability that only works on the developer's
-- machine is the shape of defect this repository keeps a scar about.
--
-- WHAT WAS CHOSEN, AND THE TWO THAT WERE NOT
--
-- (a) REJECTED: a `png_b64` column on `research_documents`. It is the simplest
--     change by a wide margin and the corpus already has the row. It was
--     rejected on the HARD constraint: a MEASURED equity-curve PNG is 150,111
--     bytes (200,148 base64 characters), and `research_documents` is the table
--     every retrieval reads. Postgres would TOAST the value out of line, so the
--     cost is not paid by a `select id, title` — but PostgREST's `select=*` IS
--     that column, `select *` in a future RPC IS that column, and a `returns
--     table` written by somebody who copied the column list IS that column. The
--     protection would be a convention that every present and FUTURE query
--     names its columns, and a convention is not a mechanism. One forgetful
--     projection and a corpus panel listing twenty documents ships four
--     megabytes of base64 to a browser that wanted twenty titles.
--
-- (b) REJECTED FOR NOW: Supabase Storage, with a `storage_path` on the row.
--     Genuinely better at scale — object storage is what object storage is for,
--     the row stays small, and a CDN could serve it. It loses on failure
--     surface for the size this desk actually has: a second service to
--     authenticate against, a bucket and its policies to keep in step with the
--     corpus's own RLS, an object that can be deleted or replaced while every
--     row still claims to describe what it used to be, and a delete path that
--     is no longer a foreign key. The door is left OPEN rather than argued
--     shut: `storage_path` exists below and the check constraint accepts a row
--     that uses it instead of `png_b64`, so moving a large artefact out is a
--     writer change and not a migration. This is `ml_artefacts`' split, and it
--     is here for that table's reason: deciding later means two tables later.
--
-- (c) CHOSEN: this side table, read as a FALLBACK behind the in-process job
--     queue. The job record stays the fast path — it is a dict lookup, it costs
--     nothing, and on a healthy single-process desk it still answers first.
--     What changes is that its absence is no longer the end of the road.
--
-- HOW THE HARD CONSTRAINT IS ENFORCED, RATHER THAN INTENDED
--
-- The bytes are not in `research_documents`. That is the whole mechanism, and
-- it is structural rather than disciplinary:
--
--   * `match_research_documents`, `match_research_documents_hybrid` and
--     `match_research_document_images` each declare an explicit `returns table`
--     over columns of `research_documents`. None of them can name a column of a
--     table they do not read, so no retrieval can return these bytes even by
--     accident, and no future `select *` over the corpus can either;
--   * PostgREST will only embed this table in a corpus read if a caller writes
--     `select=*,research_chart_images(*)`. Nothing does, and
--     `tests/test_research_vision_durable.py` asserts that no request the
--     gateway builds names this table except the one that fetches ONE image BY
--     DOCUMENT ID;
--   * the grants below mean a browser cannot select it at all.
--
-- The read is therefore a targeted `document_id=eq.<uuid>` for at most
-- `RESEARCH_VISION_MAX_IMAGES` documents, and only for the handful that are
-- about to be shown to a model. A search that returns forty chart documents
-- transfers exactly as many bytes as it did before this migration existed.
--
-- ONE IMAGE PER DOCUMENT, AND THE KEY SAYS SO
--
-- `document_id` is the primary key, not a column with an index. A chart
-- document IS one figure — that is why `research_cards` writes one document per
-- chart rather than appending chart text to the run card — so two rows here
-- would be two answers to "what does this document look like", and the answer
-- the resolver picked would depend on row order. The foreign key cascades:
-- deleting a corpus document takes its pixels with it, because a 200-kilobyte
-- orphan nothing can name is exactly the kind of thing that quietly becomes the
-- largest table in the database.
--
-- `sha256` and `byte_length` are over the bytes AS STORED, whichever home they
-- landed in — `ml_artefacts`' reason: a Storage object can be replaced and
-- every row still claims to describe what it used to be. Here they earn a
-- second keep: an answer written off an image is only reproducible if the
-- reader can prove which image it was, and `[chart:<id>]` names the document,
-- not the pixels.

create table if not exists public.research_chart_images (
  document_id uuid primary key
    references public.research_documents(id) on delete cascade,

  --: `<job id>:<chart>` — the corpus's own key for this chart, copied so an
  --: operator can find the row from a job id without joining, and so a
  --: re-indexed corpus can be reconciled against the images it used to hold.
  source_ref text not null,
  --: Which figure this is: the key of `research_image_store.CHART_PNG_FIELDS`.
  --: Stored rather than parsed back out of `source_ref`, because a chart this
  --: desk cannot NAME is one whose image must not be guessed at.
  chart text not null,

  --: Inline base64, exactly the string the backtest result carried. NULL when
  --: the artefact lives in Storage instead — see (b) above.
  png_b64 text,
  --: Storage object path. NULL when the artefact is inline. Unused today and
  --: deliberately present: see (b).
  storage_path text,

  content_type text not null default 'image/png',
  --: The DECODED length, so a reader can bound the fetch before decoding it.
  --: `> 0` because a zero-byte image is not a small image, it is an absent one,
  --: and absence belongs in the absence of a row.
  byte_length integer not null check (byte_length > 0),
  sha256 text not null,

  created_at timestamptz not null default now(),

  --: Exactly one home. Both would be two answers to "where are the pixels";
  --: neither would be a row describing nothing. `ml_artefacts`' constraint,
  --: for `ml_artefacts`' reason.
  constraint research_chart_images_have_exactly_one_home
    check ((png_b64 is null) <> (storage_path is null))
);

-- Not unique, and that is a judgement rather than an oversight.
-- `research_documents` is unique on `(desk_id, kind, source_ref)`, so two desks
-- may legitimately hold the same `<job id>:<chart>` — a shared fixture, a
-- replayed backfill — and a unique index here would make the second desk's
-- ingest fail on a row the first desk happened to write first. The lookup this
-- index serves is an operator's, by job id; the resolver looks up by
-- `document_id`, which is the primary key.
create index if not exists idx_research_chart_images_source_ref
  on public.research_chart_images (source_ref);

alter table public.research_chart_images enable row level security;

-- NO POLICY, AND THE REVOKE IS THE POINT.
--
-- Every other table in this corpus grants `authenticated` a select policy
-- scoped to the owner, because a trader's browser reads those rows. Nothing in
-- the workspace reads THIS table: the images exist to be handed to a model
-- inside the gateway, and the panel renders the chart's DESCRIPTION. A grant
-- here would create a surface where a browser could walk the corpus pulling
-- 200 kilobytes per document — which is the hard constraint this whole design
-- exists to satisfy, arriving through the front door instead.
--
-- So the grant is refused rather than a policy written to constrain it, and
-- writing the policy anyway was the rejected alternative: a policy with no
-- grant behind it is a capability with no caller, and the next reader would
-- take it as evidence that the browser path was intended.
--
-- The gateway reads and writes with the service role, which is unaffected by
-- RLS. RLS is still enabled so that the table is closed by default if a later
-- migration grants it.
revoke all on public.research_chart_images from anon, authenticated;

comment on table public.research_chart_images is
  'The rendered PNG for one chart document, kept OUT of research_documents so '
  'that no retrieval projection can return image bytes. Read only by the '
  'gateway, by document_id, for the one or two charts about to be shown to a '
  'model. Never granted to anon or authenticated.';

comment on column public.research_chart_images.png_b64 is
  'Base64 PNG, inline. NULL when the artefact lives in Storage (storage_path). '
  'Exactly one of the two is set.';

comment on column public.research_chart_images.sha256 is
  'Over the bytes as stored, either home. An answer read off an image is only '
  'reproducible if the reader can prove which image it was.';
