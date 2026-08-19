-- Walk-forward folds, and the gap that makes them honest.
--
-- A time-series cross-validation that splits at random leaks: a bar in the
-- training set can sit inside the label horizon of a bar in the test set, so
-- the model is scored partly on information it was fitted on. The result is a
-- Sharpe that cannot be reproduced out of sample and nobody can explain.
--
-- Two columns exist to make that impossible to hide rather than merely
-- unlikely. `purge_bars` is how many bars were dropped from the END of the
-- training window because their labels reach into the test window.
-- `embargo_bars` is how many were dropped from the START of the training
-- window that FOLLOWS a test window, because serial correlation runs both ways.
-- Both are NOT NULL: a fold that cannot state its purge is a fold whose
-- leakage is unknown, and unknown leakage is indistinguishable from none.
--
-- Zero is a legal value and an explicit claim — "this fold purged nothing" —
-- which is very different from a NULL that means "nobody recorded it".

create table public.ml_folds (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ml_runs(id) on delete cascade,
  --: 0-based, in time order. The ordering is the point of a walk-forward.
  fold_index int not null,

  train_start timestamptz not null,
  train_end timestamptz not null,
  test_start timestamptz not null,
  test_end timestamptz not null,
  train_rows int not null,
  test_rows int not null,

  --: See the note above. Both required, both meaningful at zero.
  purge_bars int not null,
  embargo_bars int not null,

  --: Out-of-sample only. An in-sample number on a fold row would be read as
  --: an out-of-sample one by the first person to sort this table.
  oos_return double precision,
  oos_sharpe double precision,
  oos_max_drawdown double precision,
  trades int,

  created_at timestamptz not null default now(),

  constraint ml_folds_train_window_is_ordered check (train_end > train_start),
  constraint ml_folds_test_window_is_ordered check (test_end > test_start),
  -- The test window follows the training window. A fold that trains on the
  -- future is the leak this whole table exists to prevent, so it is refused by
  -- the database rather than caught in review.
  constraint ml_folds_tests_after_it_trains check (test_start >= train_end),
  constraint ml_folds_gaps_are_not_negative check (purge_bars >= 0 and embargo_bars >= 0),
  constraint ml_folds_are_ordered unique (run_id, fold_index)
);

create index idx_ml_folds_run on public.ml_folds (run_id, fold_index);

alter table public.ml_folds enable row level security;
revoke all on public.ml_folds from anon;

-- Reachable exactly when its run is. The fold rows carry no user_id of their
-- own: duplicating the owner is how two rows end up disagreeing about who owns
-- one experiment.
create policy "Traders read folds of their own runs"
  on public.ml_folds for select
  to authenticated
  using (exists (
    select 1 from public.ml_runs r
    where r.id = ml_folds.run_id and r.user_id = (select auth.uid())
  ));
