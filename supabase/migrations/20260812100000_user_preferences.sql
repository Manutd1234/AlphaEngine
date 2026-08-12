-- One row per account: the workspace preferences this browser already keeps in
-- localStorage, mirrored so signing in on another machine restores them.
--
-- Deliberately a single jsonb blob rather than a column per preference. These
-- are viewing choices — theme, detail level, which tab you left open — with no
-- relational shape and no query that ever filters on one of them; a column per
-- setting would mean a migration every time the workspace grows a toggle.
--
-- What does NOT belong here, and why, because the omissions are the design:
--   * the operator token — a credential, and it stays in sessionStorage where
--     it dies with the tab;
--   * the experiment log — up to sixty records of run history, which is a row
--     shape, not a preference, and would breach the size check below;
--   * the blotter's sandbox/live source — per-tab by intent, so two tabs can
--     watch different books.
create table public.user_preferences (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- localStorage-scale payloads only. A preference blob that grows past this
  -- is something else wearing a preference's clothes.
  constraint user_preferences_prefs_bounded check (pg_column_size(prefs) < 32768)
);

alter table public.user_preferences enable row level security;

-- Anonymous visitors keep their preferences in their own browser and never
-- reach this table. There is no demo row to read here, unlike the blotter.
revoke all on public.user_preferences from anon;

create policy "Users read own preferences"
  on public.user_preferences for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users insert own preferences"
  on public.user_preferences for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update own preferences"
  on public.user_preferences for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy: dropping the account drops the row through the cascade
-- above, and there is no other reason to remove one.

notify pgrst, 'reload schema';
