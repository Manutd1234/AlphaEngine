-- Fail closed before the data-ops factory starts enforcing SUPABASE_DESK_ID.
--
-- Older PostgREST stores used the constructor default `default` because the
-- factory did not pass its configured desk.  Silently changing the read scope
-- would hide those rows and permit duplicate business keys under the real
-- desk.  SQL cannot infer which desk owns an ambiguous legacy row, so the
-- migration refuses and tells the operator to map it deliberately.
--
-- This source migration deliberately has no BEGIN/COMMIT. `supabase db push`
-- owns the transaction that also records migration history, so authoring a
-- nested COMMIT here could persist the schema while leaving history
-- unrecorded. For a manual SQL Editor run, use apply_all.generated.sql; its
-- generator adds a transaction around this section.

-- Hold old writers outside the preflight/DDL window.  Without this lock a
-- process using the former column default could recreate an ambiguous row
-- after the count and before the defaults were removed.
lock table
  public.data_quality_findings,
  public.data_quality_escalations,
  public.data_schedule_runs,
  public.data_work_items,
  public.diffusion_events,
  public.diffusion_runs,
  public.diffusion_texts,
  public.diffusion_studies
in access exclusive mode;

do $$
declare
  relation_name text;
  legacy_rows bigint;
begin
  foreach relation_name in array array[
    'data_quality_findings',
    'data_quality_escalations',
    'data_schedule_runs',
    'data_work_items',
    'diffusion_events',
    'diffusion_runs',
    'diffusion_texts',
    'diffusion_studies'
  ]
  loop
    execute format(
      'select count(*) from public.%I where desk_id = %L',
      relation_name,
      'default'
    ) into legacy_rows;
    if legacy_rows > 0 then
      raise exception using
        errcode = 'check_violation',
        message = format(
          'desk-scope migration refused: public.%I has %s row(s) with desk_id=default',
          relation_name,
          legacy_rows
        ),
        hint = format(
          'Map those rows to the configured SUPABASE_DESK_ID explicitly, for example: UPDATE public.%I SET desk_id = ''<configured-desk-id>'' WHERE desk_id = ''default''; then rerun the migration.',
          relation_name
        );
    end if;
  end loop;
end
$$;

-- Once the preflight is clean, omitted tenant ownership is an error.  The
-- PostgREST adapter stamps the configured desk on every insert and patch.
alter table public.data_quality_findings alter column desk_id drop default;
alter table public.data_quality_escalations alter column desk_id drop default;
alter table public.data_schedule_runs alter column desk_id drop default;
alter table public.data_work_items alter column desk_id drop default;
alter table public.diffusion_events alter column desk_id drop default;
alter table public.diffusion_runs alter column desk_id drop default;
alter table public.diffusion_texts alter column desk_id drop default;
alter table public.diffusion_studies alter column desk_id drop default;

-- Refuse the legacy sentinel even when an older writer sends it explicitly.
-- The lock keeps each check true from the preflight through installation.
alter table public.data_quality_findings
  drop constraint if exists data_quality_findings_desk_id_not_default,
  add constraint data_quality_findings_desk_id_not_default check (desk_id <> 'default');
alter table public.data_quality_escalations
  drop constraint if exists data_quality_escalations_desk_id_not_default,
  add constraint data_quality_escalations_desk_id_not_default check (desk_id <> 'default');
alter table public.data_schedule_runs
  drop constraint if exists data_schedule_runs_desk_id_not_default,
  add constraint data_schedule_runs_desk_id_not_default check (desk_id <> 'default');
alter table public.data_work_items
  drop constraint if exists data_work_items_desk_id_not_default,
  add constraint data_work_items_desk_id_not_default check (desk_id <> 'default');
alter table public.diffusion_events
  drop constraint if exists diffusion_events_desk_id_not_default,
  add constraint diffusion_events_desk_id_not_default check (desk_id <> 'default');
alter table public.diffusion_runs
  drop constraint if exists diffusion_runs_desk_id_not_default,
  add constraint diffusion_runs_desk_id_not_default check (desk_id <> 'default');
alter table public.diffusion_texts
  drop constraint if exists diffusion_texts_desk_id_not_default,
  add constraint diffusion_texts_desk_id_not_default check (desk_id <> 'default');
alter table public.diffusion_studies
  drop constraint if exists diffusion_studies_desk_id_not_default,
  add constraint diffusion_studies_desk_id_not_default check (desk_id <> 'default');

notify pgrst, 'reload schema';
