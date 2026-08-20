-- E3.10 — the aggregate half of the quality ledger, server-side.
--
-- PostgREST cannot express `SELECT provider, COUNT(*), SUM(passed) … GROUP BY
-- provider` as a filter on a table, and the honest options were a view per
-- rollup or one function that returns the whole aggregate in a single round
-- trip. This is the second: the SQLite backend builds this shape from four
-- queries against a local file, where a network backend paying four round
-- trips for one panel would be the wrong trade.
--
-- The column list mirrors `_AGGREGATE` in modules/data_quality.py exactly. If
-- one moves and the other does not, the two backends report different numbers
-- for the same window — so the Python constant and this function are a pair,
-- and `tests/test_data_quality_rollup.py` asserts they name the same columns.

create or replace function public.data_quality_rollup(
  p_desk_id text,
  p_since   double precision
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select *
      from public.data_quality_findings
     where desk_id = p_desk_id
       and observed_at >= p_since
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'evaluated', count(*),
        'passed', coalesce(sum(passed), 0),
        'fatal', coalesce(sum(fatal), 0),
        'warn', coalesce(sum(warn), 0),
        'drift', coalesce(sum(drift), 0),
        'not_evaluated', coalesce(sum(not_evaluated), 0)
      ) from scoped
    ),
    'bounds', (
      select jsonb_build_object(
        'first_at', min(observed_at),
        'last_at', max(observed_at),
        'instances', count(distinct instance)
      ) from scoped
    ),
    'by_provider', coalesce((
      select jsonb_agg(row order by row->>'provider')
        from (
          select jsonb_build_object(
            'provider', provider,
            'evaluated', count(*),
            'passed', coalesce(sum(passed), 0),
            'fatal', coalesce(sum(fatal), 0),
            'warn', coalesce(sum(warn), 0),
            'drift', coalesce(sum(drift), 0),
            'not_evaluated', coalesce(sum(not_evaluated), 0)
          ) as row
            from scoped
           group by provider
        ) p
    ), '[]'::jsonb),
    'by_capability', coalesce((
      select jsonb_agg(row order by row->>'capability')
        from (
          select jsonb_build_object(
            'capability', capability,
            'evaluated', count(*),
            'passed', coalesce(sum(passed), 0),
            'fatal', coalesce(sum(fatal), 0),
            'warn', coalesce(sum(warn), 0),
            'drift', coalesce(sum(drift), 0),
            'not_evaluated', coalesce(sum(not_evaluated), 0)
          ) as row
            from scoped
           group by capability
        ) c
    ), '[]'::jsonb)
  );
$$;
