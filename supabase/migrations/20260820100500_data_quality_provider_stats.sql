-- E3.10 — the escalation rules' conditional aggregate, server-side.
--
-- The rule engine asks one question per provider per tick: of the findings in
-- the window, how many were evaluated, how many failed, and how many carried a
-- fatal check. In SQL that is SUM(CASE WHEN passed=0 THEN 1 ELSE 0 END), which
-- PostgREST cannot express against a table any more than it can express the
-- GROUP BY rollup beside it.
--
-- Kept separate from `data_quality_rollup` because it is asked for ONE provider
-- at a time, inside a loop over open escalations. Folding it into the panel
-- rollup would return every provider's counts to answer a question about one.

create or replace function public.data_quality_provider_stats(
  p_desk_id  text,
  p_provider text,
  p_since    double precision
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'evaluated', count(*),
    'failed', coalesce(sum(case when passed = 0 then 1 else 0 end), 0),
    'fatal_findings', coalesce(sum(case when fatal > 0 then 1 else 0 end), 0)
  )
    from public.data_quality_findings
   where desk_id = p_desk_id
     and provider = p_provider
     and observed_at >= p_since;
$$;
