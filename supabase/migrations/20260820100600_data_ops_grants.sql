-- Closing what the data-ops migrations left open.
--
-- The four tables and three functions added in 20260820100000–100500 shipped
-- with `enable row level security` and no grant statement, which is not the
-- same as closed. This file is written rather than edited into those, because
-- they have been applied: a migration that has run is history, not
-- documentation — the same rule 20260812090000 states.
--
-- Found by probing the live project after the bundle was applied, not by
-- reading the SQL. Every other table in this schema pairs RLS with an explicit
-- REVOKE; these four did not, and the difference is invisible in review
-- because RLS makes the behaviour look identical today.
--
-- ── 1. The tables ──────────────────────────────────────────────────────────
--
-- RLS with no policy already returns nothing to anon — verified: a select
-- answers `200 []` and an insert is refused with 42501. So this changes no
-- behaviour today. It exists so that adding a policy later cannot quietly
-- become the only thing standing between a browser and these rows, which is
-- the argument 20260812091000 makes for the same revokes on order_blotter.
--
-- The gateway is unaffected: it connects with the service-role key, which is
-- exempt from RLS and from these grants.

revoke all on public.data_quality_findings    from anon, authenticated;
revoke all on public.data_quality_escalations from anon, authenticated;
revoke all on public.data_schedule_runs       from anon, authenticated;
revoke all on public.data_work_items          from anon, authenticated;

-- ── 2. The functions, which were a real hole rather than a latent one ──────
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and `anon` is a
-- member of PUBLIC. All three below are SECURITY DEFINER, so they run as their
-- owner and RLS does not apply to them at all — the protection on the tables
-- above is bypassed by design, because the gateway needs the aggregate.
--
-- `data_quality_rollup` and `data_quality_provider_stats` therefore answered an
-- anonymous caller with real counts for any `desk_id` it asked for. They read
-- zero today only because the table is empty; the leak arrives with the first
-- finding the gateway writes.
--
-- `next_work_item_id` is worse in a different way: it is not a read. Anonymous
-- callers could consume the id sequence, and two calls made while probing this
-- project's schema did exactly that — which is what section 3 repairs.

revoke execute on function public.data_quality_rollup(text, double precision) from public, anon, authenticated;
revoke execute on function public.data_quality_provider_stats(text, text, double precision) from public, anon, authenticated;
revoke execute on function public.next_work_item_id(text) from public, anon, authenticated;

-- ── 3. Re-seed the id sequences, but only on an empty table ────────────────
--
-- `test_work_items.py` pins the literal next ids BUG-095 and REQ-188 against
-- seed maxima of BUG-094 and REQ-187. `create sequence if not exists` cannot
-- correct a sequence that already exists, so a burned number stays burned and
-- the first real work item would be BUG-097.
--
-- Guarded on the table being empty, which makes this safe to re-run and
-- correct in general: once real work items exist their ids are the authority
-- and resetting the counter would mint a duplicate. Silently resetting a live
-- sequence is a far worse bug than the one being fixed.

do $$
begin
  if not exists (select 1 from public.data_work_items) then
    alter sequence public.work_item_bug_seq restart with 95;
    alter sequence public.work_item_req_seq restart with 188;
    alter sequence public.work_item_tkt_seq restart with 323;
  else
    raise notice 'work-item sequences left alone: the table already holds rows';
  end if;
end;
$$;

-- PostgREST caches the schema, and a revoked function that is still in the
-- cache keeps answering until it reloads.
notify pgrst, 'reload schema';
