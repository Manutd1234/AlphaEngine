-- E3.3 — data_schedule_runs in Postgres.
--
-- One row per schedule, upserted. The SQLite version is
-- `INSERT … ON CONFLICT(schedule_id) DO UPDATE`; over PostgREST the same
-- operation is a POST with `Prefer: resolution=merge-duplicates`, which needs
-- the unique constraint below to have something to conflict on.

create table if not exists public.data_schedule_runs (
  desk_id       text not null default 'default',
  schedule_id   text not null,
  last_run_at   double precision,
  last_job_id   text,
  last_outcome  text,
  primary key (desk_id, schedule_id)
);

alter table public.data_schedule_runs enable row level security;
