-- The read surface for the mirrored blotter.
--
-- WHY A VIEW AND NOT A CONVENTION
--
-- `order_blotter` now has two writers. The gateway appends the desk's real
-- fifteen-gate decisions (`decided_by = 'gateway'`); the `evaluate-order` Edge
-- Function and `submit_alphaengine_order` append labelled two-gate SANDBOX
-- decisions (`decided_by = 'supabase_rpc'`). The `decided_by` column exists
-- precisely so those can never be confused.
--
-- That column only protects anything if every reader remembers to filter on it,
-- and the table is APPEND-ONLY by trigger — so a query that forgets the filter
-- produces a blended blotter that cannot be cleaned up afterwards. Today there
-- are zero readers, which makes this the cheapest possible moment to make the
-- safe path the default one instead of relying on everyone reading the column
-- comment first.
--
-- `desk_blotter` is what a reader should select from. Reaching past it to the
-- base table is then a visible, deliberate act in a diff rather than an
-- omission nobody notices.

create or replace view public.desk_blotter
with (security_invoker = true) as
select *
  from public.order_blotter
 where decided_by = 'gateway';

comment on view public.desk_blotter is
  'Desk decisions only — the fifteen-gate engine in modules/risk_proxy.py. '
  'Excludes decided_by = ''supabase_rpc'', which is the labelled SQL/Edge sandbox '
  'and is never the desk''s decision. Read this, not order_blotter.';

-- The mirror image, for anyone who genuinely wants the sandbox rows — a
-- demo, or a reconciliation that has to account for every row in the table.
create or replace view public.sandbox_blotter
with (security_invoker = true) as
select *
  from public.order_blotter
 where decided_by = 'supabase_rpc';

comment on view public.sandbox_blotter is
  'Sandbox decisions only (two gates, from SQL or the evaluate-order Edge '
  'Function). Never present these as the desk''s decisions.';

-- security_invoker keeps RLS applying as the querying role rather than the
-- view owner: without it these views would be a way around the deny-by-default
-- policies, which is the opposite of the point.
revoke all on public.desk_blotter from anon;
revoke all on public.sandbox_blotter from anon;
grant select on public.desk_blotter to authenticated;
grant select on public.sandbox_blotter to authenticated;
