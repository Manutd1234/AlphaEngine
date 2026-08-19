-- The feature set a run was fitted on, versioned.
--
-- A model is its features. Two runs of "logistic regression on BTCUSDT" that
-- used different windows are different experiments, and a params blob on
-- ml_runs cannot say which — it records the model's hyperparameters, not the
-- columns that went in.
--
-- `spec` is the exact, ordered definition: name, source series, window, and any
-- transform, as the builder emitted it. `spec_hash` is a digest of that
-- canonical form, so two runs can be compared for feature identity with an
-- equality test rather than by a human reading two JSON blobs side by side —
-- which is the comparison that actually gets skipped.
--
-- Deliberately NOT stored: the computed feature values. They are a function of
-- (spec_hash, data_hash) and both are recorded, so the matrix is rebuildable.
-- Storing a few hundred thousand floats per run to save a recomputation would
-- trade a cheap rebuild for a table nobody can afford to keep.

create table public.ml_features (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ml_runs(id) on delete cascade,

  --: Ordered, and the order is part of the identity: a linear model's
  --: coefficients are meaningless against a permuted feature vector.
  spec jsonb not null,
  spec_hash text not null,
  feature_count int not null,

  --: What the model was asked to predict. Forward return over a horizon is not
  --: the same experiment as next-bar direction, and the label is the half of a
  --: supervised setup that a "model" column never captures.
  label text not null,
  label_horizon_bars int not null,

  created_at timestamptz not null default now(),

  constraint ml_features_count_is_positive check (feature_count > 0),
  constraint ml_features_horizon_is_positive check (label_horizon_bars > 0),
  --: One feature set per run. A run that changed features mid-way is two runs.
  constraint ml_features_one_set_per_run unique (run_id)
);

create index idx_ml_features_spec on public.ml_features (spec_hash);

alter table public.ml_features enable row level security;
revoke all on public.ml_features from anon;

create policy "Traders read features of their own runs"
  on public.ml_features for select
  to authenticated
  using (exists (
    select 1 from public.ml_runs r
    where r.id = ml_features.run_id and r.user_id = (select auth.uid())
  ));
