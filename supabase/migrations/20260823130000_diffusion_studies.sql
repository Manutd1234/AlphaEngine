-- The study ledger: one row per spectrum run, including the ones that found nothing.
--
-- The Postgres half of `modules/coherence/diffusion/studies.py`, mirroring its
-- SQLite DDL column for column so the desk runs identically with and without
-- Supabase configured — the `diffusion_events` precedent, for the same reason.
--
-- WHY A NULL RESULT IS STORED AT ALL. The instrument this table records was
-- built to test one idea: that the resolution at which a statement explains
-- the previous one predicts how fast the price finishes moving. It does not.
-- A null that lives only in the console of whoever ran it gets rediscovered,
-- and rediscovered runs drift towards whichever seed and latent width finally
-- produce a t of two. Filing the run — its verdict, its seed, its width, and
-- the regressions behind it — is what makes the second asking of the question
-- visible as a second asking.
--
-- WHY THE GATE COLUMNS ARE NOT OPTIONAL METADATA. `gate_state` records whether
-- the representation could recover a fact that is literally written in the
-- documents (the policy move, in basis points) before it was used to report
-- that the documents say nothing. A whole-statement latent fails this at an
-- out-of-fold R^2 of -0.60 while the decision sentence alone reaches +0.70, so
-- the same null means opposite things either side of that number. A row
-- without it is not interpretable and the desk marks it `not_assessable`.
--
-- `study_id` is the configuration, not a clock: re-running the same question
-- replaces its row instead of accumulating near-duplicates that a reader would
-- have to date-sort to tell apart. `ran_at` says when that last happened.
--
-- No enum type. CHECK on TEXT keeps each vocabulary in one migration file and
-- avoids the one-`alter type`-per-file rule while these words are still moving.

create table if not exists public.diffusion_studies (
    study_id            text primary key,
    desk_id             text not null default 'default',
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
    regressions_json    text not null,
    constraint diffusion_studies_ok_runs_scored_something
        check (state <> 'ok' or events > 0),
    constraint diffusion_studies_a_passed_gate_has_a_number
        check (gate_state <> 'passed' or gate_r_squared is not null)
);

create index if not exists diffusion_studies_by_time on public.diffusion_studies (desk_id, ran_at);

comment on table public.diffusion_studies is
    'Spectrum runs and their verdicts. Null results are kept, not overwritten by later ones.';
comment on column public.diffusion_studies.study_id is
    'The configuration that was run, so re-running the same question replaces rather than adds.';
comment on column public.diffusion_studies.gate_state is
    'Whether the representation recovered a fact written in the documents before being trusted.';
comment on column public.diffusion_studies.verdict is
    'What the run concluded, including does_not_predict and inadmissible.';
comment on column public.diffusion_studies.regressions_json is
    'Every regression the run measured, so a verdict can be argued with rather than taken on trust.';

alter table public.diffusion_studies enable row level security;
revoke all on public.diffusion_studies from anon, authenticated;
