-- E3.2 — data_quality_escalations in Postgres.
--
-- `acknowledged_at`/`acknowledged_by` are declared here rather than added by a
-- later ALTER. The SQLite store has no migration table, so it grows columns
-- conditionally at construction (`_ESCALATION_COLUMNS`); Postgres has proper
-- migrations, so the column exists from the start. NULL carries the same
-- meaning on both sides: nobody has acknowledged this.

create table if not exists public.data_quality_escalations (
  id              bigint generated always as identity primary key,
  desk_id         text     not null default 'default',
  rule            text     not null,
  provider        text     not null,
  opened_at       double precision not null,
  window_minutes  integer  not null,
  count           integer  not null,
  evaluated       integer,
  detail          text     not null,
  notified_at     double precision,
  channel         text,
  resolved_at     double precision,
  acknowledged_at double precision,
  acknowledged_by text
);

create index if not exists ix_dq_esc_rule
  on public.data_quality_escalations (desk_id, rule, provider, opened_at);

-- Open escalations are the ones every read path asks for, and they are a small
-- minority of the table once a desk has been running. Partial index rather than
-- a scan.
create index if not exists ix_dq_esc_open
  on public.data_quality_escalations (desk_id, provider)
  where resolved_at is null;

alter table public.data_quality_escalations enable row level security;
