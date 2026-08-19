-- The ML run ledger: what was trained, on which bars, with which parameters.
--
-- The desk already records rule-based sweeps in the audit log's backtest_runs
-- and renders each into the pgvector corpus. An ML run needs the same
-- provenance and two things a sweep does not have: a model that was FITTED
-- rather than specified, and folds that must not leak.
--
-- `data_hash` carries the same meaning it does everywhere else in this project
-- — the exact bars the run saw — so an ML run and a sweep over the same window
-- are comparable rather than merely adjacent. `git_sha` is beside it because a
-- fitted model is a function of the code that fitted it in a way a moving
-- average is not: two runs with the same data_hash and different shas are two
-- different experiments, and without this column nothing would say so.
--
-- `seed` is not optional and has no default. A run that cannot say which seed
-- produced it cannot be re-run, and an irreproducible ML result is an anecdote.

create table public.ml_runs (
  id uuid primary key default gen_random_uuid(),
  desk_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid references auth.users(id) on delete cascade,

  model text not null,
  symbol text not null,
  interval text not null,
  --: The exact bars this run saw. Same meaning as BacktestResult.data_hash.
  data_hash text not null,
  --: Hyperparameters as given, not as defaulted, so a re-run is exact.
  params jsonb not null default '{}',
  seed bigint not null,
  --: The tree that fitted it. A fitted model is a function of its code.
  git_sha text,
  --: Whether the optional scikit-learn extra was present. A run that fell back
  --: to the hand-rolled engine is a different run and must say so rather than
  --: being silently comparable to one that did not.
  engine text not null default 'numpy' check (engine in ('numpy', 'sklearn')),

  --: Headline out-of-sample metrics, mirroring the sweep vocabulary so the two
  --: kinds of run can be ranked in one list.
  oos_sharpe double precision,
  deflated_sharpe double precision,
  pbo double precision,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  --: Why it failed, when it did. Never NULL on a failed row.
  error text,

  created_at timestamptz not null default now(),
  constraint ml_runs_failed_rows_say_why
    check (status <> 'failed' or error is not null)
);

create index idx_ml_runs_desk_time on public.ml_runs (desk_id, started_at desc);
create index idx_ml_runs_data_hash on public.ml_runs (data_hash);

alter table public.ml_runs enable row level security;
revoke all on public.ml_runs from anon;

create policy "Traders read own ML runs"
  on public.ml_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);
