-- Complete the Diffusion ledger for the PostgREST backend.
--
-- The SQLite backend owns all four relations.  The first Postgres rollout only
-- declared events and studies, used a global natural-key primary key, and
-- predated the current study and stage-source fields.  This successor is safe
-- both after those migrations and on a project where the Diffusion relations
-- have not been created yet.
--
-- Natural keys are unique WITHIN a desk.  A global primary key lets one desk's
-- deterministic run/text/study id collide with another desk's identical
-- experiment before the read predicate gets a chance to protect either row.

create table if not exists public.diffusion_events (
    source_ref          text not null,
    desk_id             text not null,
    kind                text not null check (kind in ('earnings', 'fomc', 'macro')),
    symbol              text,
    title               text not null,
    release_at          double precision not null,
    release_at_source   text not null,
    release_timing      text check (release_timing in ('BMO', 'AMC', 'TAS', 'TNS', 'exact')),
    call_at             double precision,
    call_at_source      text,
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
    constraint diffusion_events_offset_needs_a_call check (call_offset_min is null or call_at is not null),
    constraint diffusion_events_pkey primary key (desk_id, source_ref)
);

alter table public.diffusion_events
    drop constraint if exists diffusion_events_release_at_source_check;
alter table public.diffusion_events
    drop constraint if exists diffusion_events_call_at_source_check;
alter table public.diffusion_events
    add constraint diffusion_events_release_at_source_check
        check (release_at_source in ('vendor', 'issuer', 'estimated_offset', 'parsed_release', 'recorded'))
        not valid;
alter table public.diffusion_events
    add constraint diffusion_events_call_at_source_check
        check (call_at_source is null or call_at_source in ('vendor', 'issuer', 'estimated_offset', 'parsed_release', 'recorded'))
        not valid;

-- Authored `fed_seed` rows may predate this migration.  They retain their true
-- provenance and remain unreadable to the application; a NOT VALID constraint
-- rejects that retired label on every new write without falsifying old rows.

alter table public.diffusion_events
    drop constraint if exists diffusion_events_pkey,
    add constraint diffusion_events_pkey primary key (desk_id, source_ref);

create index if not exists diffusion_events_by_release
    on public.diffusion_events (desk_id, release_at);
create index if not exists diffusion_events_by_symbol
    on public.diffusion_events (desk_id, symbol, release_at);

create table if not exists public.diffusion_runs (
    run_id              text not null,
    desk_id             text not null,
    source_ref          text not null,
    symbol              text not null,
    stage               text not null,
    interval            text not null,
    signal_state        text not null,
    signal_reason       text,
    terminal_return     double precision,
    sigma_pre_per_bar   double precision,
    pre_bars            integer not null default 0,
    half_life_s         double precision,
    half_life_state     text,
    half_life_vol       double precision,
    control_percentile  double precision,
    controls_used       integer not null default 0,
    measured_horizons   integer not null default 0,
    of_horizons         integer not null default 0,
    market_adjusted     integer not null default 0,
    data_hash           text,
    params_version      text not null,
    t0_ms               double precision not null,
    points_json         text not null,
    computed_at         double precision not null,
    constraint diffusion_runs_pkey primary key (desk_id, run_id)
);

alter table public.diffusion_runs
    drop constraint if exists diffusion_runs_pkey,
    add constraint diffusion_runs_pkey primary key (desk_id, run_id);

create index if not exists diffusion_runs_by_event
    on public.diffusion_runs (desk_id, source_ref);
create index if not exists diffusion_runs_by_time
    on public.diffusion_runs (desk_id, t0_ms);

create table if not exists public.diffusion_texts (
    text_id                 text not null,
    desk_id                 text not null,
    source_ref              text not null,
    stage                   text not null,
    source                  text not null,
    url                     text,
    state                   text not null,
    reason                  text,
    body                    text,
    sha256                  text,
    characters              integer not null default 0,
    verified_release_time   text,
    body_isolated           integer not null default 1,
    vote_line               text,
    first_seen_at           double precision not null,
    fetched_at              double precision not null,
    constraint diffusion_texts_pkey primary key (desk_id, text_id)
);

alter table public.diffusion_texts
    add column if not exists vote_line text;
alter table public.diffusion_texts
    drop constraint if exists diffusion_texts_pkey,
    add constraint diffusion_texts_pkey primary key (desk_id, text_id);

create index if not exists diffusion_texts_by_event
    on public.diffusion_texts (desk_id, source_ref);

create table if not exists public.diffusion_studies (
    study_id            text not null,
    desk_id             text not null,
    ran_at              double precision not null,
    conditioning        text not null,
    segment             text,
    latent_dim          integer not null,
    events              integer not null default 0,
    state               text not null check (state in ('ok', 'refused', 'unavailable')),
    verdict             text,
    verdict_reason      text,
    gate_state          text not null check (gate_state in ('passed', 'failed', 'not_assessable')),
    gate_r_squared      double precision,
    gate_floor          double precision not null default 0,
    gate_fact           text not null default '',
    gate_reason         text,
    gate_samples        integer not null default 0,
    effective_rank      double precision,
    centroid_spread     double precision,
    skill_meetings      integer not null default 0,
    skill_baseline_r2   double precision,
    skill_gain          double precision,
    skill_shuffled_p    double precision,
    skill_stage_minutes double precision,
    regressions_json    text not null,
    constraint diffusion_studies_ok_runs_scored_something
        check (state <> 'ok' or events > 0),
    constraint diffusion_studies_a_passed_gate_has_a_number
        check (gate_state <> 'passed' or gate_r_squared is not null),
    constraint diffusion_studies_pkey primary key (desk_id, study_id)
);

alter table public.diffusion_studies
    add column if not exists skill_meetings integer not null default 0;
alter table public.diffusion_studies
    add column if not exists skill_baseline_r2 double precision;
alter table public.diffusion_studies
    add column if not exists skill_gain double precision;
alter table public.diffusion_studies
    add column if not exists skill_shuffled_p double precision;
alter table public.diffusion_studies
    add column if not exists skill_stage_minutes double precision;

alter table public.diffusion_studies
    drop constraint if exists diffusion_studies_pkey,
    add constraint diffusion_studies_pkey primary key (desk_id, study_id);

create index if not exists diffusion_studies_by_time
    on public.diffusion_studies (desk_id, ran_at);

comment on table public.diffusion_runs is
    'Per-stage absorption measurements and their reproducibility evidence.';
comment on table public.diffusion_texts is
    'Point-in-time source documents and explicit fetch refusals used by Diffusion studies.';
comment on column public.diffusion_texts.first_seen_at is
    'When this desk first observed the source text; updates must not replace it.';
comment on column public.diffusion_studies.skill_baseline_r2 is
    'Out-of-sample baseline predictability, read before interpreting skill_gain.';

alter table public.diffusion_events enable row level security;
alter table public.diffusion_runs enable row level security;
alter table public.diffusion_texts enable row level security;
alter table public.diffusion_studies enable row level security;

revoke all on public.diffusion_events from anon, authenticated;
revoke all on public.diffusion_runs from anon, authenticated;
revoke all on public.diffusion_texts from anon, authenticated;
revoke all on public.diffusion_studies from anon, authenticated;

-- New relations and late columns are invisible to PostgREST until its schema
-- cache reloads.  This migration owns that refresh even when applied alone.
notify pgrst, 'reload schema';
