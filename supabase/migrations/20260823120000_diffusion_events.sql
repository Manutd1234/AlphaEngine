-- The announcement ledger: two stages per event, and two clocks per row.
--
-- The Postgres half of a table that must also exist on a desk with no Supabase
-- configured. `modules/coherence/diffusion/events.py` carries the SQLite DDL
-- and this mirrors it column for column, the way `data_quality_findings` does:
-- the gateway picks a backend with DATA_OPS_BACKEND and the wire shape does
-- not change under it.
--
-- WHY TWO TIMESTAMPS AND NOT ONE. `release_at` is the vendor's claim about
-- when the announcement happened; `first_seen_at` is when this gateway wrote
-- the row. They differ, and they differ in the direction that matters:
-- publishers revise a scheduled time after the fact, so a study that scores an
-- event against a timestamp revised later has look-ahead in it. `release_at`
-- may move and `revised_count` counts each time it did; `first_seen_at` is
-- written once and never updated, by any path.
--
-- `release_timing` keeps the vendor's own session-placement word rather than
-- folding it into the timestamp. BMO, AMC, TAS and TNS are the only signal a
-- free calendar gives about whether a release lands before an open or after a
-- close, and an anchor placed without it is placed by guesswork. `exact` is
-- ours, for a decision timed to the minute.
--
-- No enum type. A CHECK on TEXT keeps every value in one migration file
-- instead of forcing the one-`alter type`-per-file rule, and these vocabularies
-- are still moving.

create table if not exists public.diffusion_events (
    source_ref          text primary key,
    desk_id             text not null default 'default',
    kind                text not null check (kind in ('earnings', 'fomc', 'macro')),
    symbol              text,
    title               text not null,
    release_at          double precision not null,
    release_at_source   text not null check (release_at_source in ('vendor', 'fed_seed', 'recorded')),
    release_timing      text check (release_timing in ('BMO', 'AMC', 'TAS', 'TNS', 'exact')),
    call_at             double precision,
    call_at_source      text check (call_at_source in ('fed_seed', 'estimated_offset', 'parsed_release', 'recorded')),
    call_offset_min     double precision,
    eps_estimate        double precision,
    eps_actual          double precision,
    surprise_pct        double precision,
    scheduled           integer not null default 1,
    statement_url       text,
    first_seen_at       double precision not null,
    last_seen_at        double precision not null,
    revised_count       integer not null default 0,
    verified_at         double precision,
    constraint diffusion_events_call_after_release check (call_at is null or call_at >= release_at),
    constraint diffusion_events_offset_needs_a_call check (call_offset_min is null or call_at is not null)
);

create index if not exists diffusion_events_by_release on public.diffusion_events (desk_id, release_at);
create index if not exists diffusion_events_by_symbol on public.diffusion_events (desk_id, symbol, release_at);

comment on table public.diffusion_events is
    'Timestamped announcements with both of their stages. One row per source_ref.';
comment on column public.diffusion_events.first_seen_at is
    'The point-in-time clock: when this gateway first wrote the row. Never updated.';
comment on column public.diffusion_events.release_at is
    'What the vendor says now. May be revised; revised_count records that it was.';
comment on column public.diffusion_events.release_timing is
    'The vendor session-placement word, verbatim. Never folded into release_at.';
comment on column public.diffusion_events.verified_at is
    'Null until an operator confirmed the row against the issuing source.';

alter table public.diffusion_events enable row level security;
revoke all on public.diffusion_events from anon, authenticated;
