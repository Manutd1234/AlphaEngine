-- E3.1 — data_quality_findings in Postgres.
--
-- The mirror of the SQLite table in `modules/data_quality.py`. Types are the
-- Postgres equivalents of the SQLite ones, not a redesign: the store writes
-- epoch milliseconds as REAL and booleans as 0/1 INTEGER, and changing either
-- here would make the two backends disagree about the same row. `double
-- precision` and `smallint` keep the wire shape identical.
--
-- `desk_id` is the tenancy column every other table in this project carries.
-- The gateway holds the service-role key and filters in the query rather than
-- relying on RLS, for the reason recorded on `ml_runs`: `trader_identity`
-- resolves to an access decision, not a user, so there is no `auth.uid()` for
-- a policy to compare against.

create table if not exists public.data_quality_findings (
  id             bigint generated always as identity primary key,
  desk_id        text        not null default 'default',
  instance       text        not null,
  seq            bigint      not null,
  source         text        not null,
  observed_at    double precision not null,
  received_at    double precision not null,
  capability     text        not null,
  provider       text        not null,
  symbol         text,
  key            text        not null,
  passed         smallint    not null,
  fatal          smallint    not null,
  warn           smallint    not null,
  drift          smallint    not null,
  not_evaluated  smallint    not null,
  checks_json    text        not null,
  unique (desk_id, instance, seq)
);

create index if not exists ix_dq_findings_observed
  on public.data_quality_findings (desk_id, observed_at);
create index if not exists ix_dq_findings_provider
  on public.data_quality_findings (desk_id, provider, observed_at);

alter table public.data_quality_findings enable row level security;

-- Service role only. No anon or authenticated policy is granted: these rows are
-- operational evidence written by the gateway, and the browser reaches them
-- through the gateway's own routes rather than directly.
