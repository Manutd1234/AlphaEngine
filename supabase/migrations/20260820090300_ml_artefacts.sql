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

create table public.ml_artefacts (
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

create index idx_ml_artefacts_run on public.ml_artefacts (run_id);

alter table public.ml_artefacts enable row level security;
revoke all on public.ml_artefacts from anon;

create policy "Traders read artefacts of their own runs"
  on public.ml_artefacts for select
  to authenticated
  using (exists (
    select 1 from public.ml_runs r
    where r.id = ml_artefacts.run_id and r.user_id = (select auth.uid())
  ));
