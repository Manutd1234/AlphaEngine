-- Scoped anon read + realtime, for the public demo desk only.
--
-- THIS REVERSES A DELIBERATE DECISION, so it states its reasoning in full.
--
-- `20260808120200_rls_policies.sql` shipped with zero `anon` policies and an
-- explicit REVOKE, and its header says that is "what makes putting
-- NEXT_PUBLIC_SUPABASE_* on Vercel a deliberate decision later instead of an
-- accident today." This is that deliberate decision. It is narrow on purpose,
-- and every clause below is load-bearing rather than defensive boilerplate:
--
--   desk_id = the public demo desk
--       The single desk this educational deployment runs. A second desk added
--       later is private by default rather than by remembering to exclude it.
--
--   user_id is null
--       Gateway-mirrored rows have no owner. The authenticated-trader story in
--       the policies above writes rows WITH a user_id, and those stay private —
--       so shipping a login later does not retroactively publish anyone's
--       blotter through this policy.
--
--   decided_by = 'gateway'
--       Same rule as `public.desk_blotter`: the labelled two-gate sandbox is
--       never served as the desk's decision, not even to an anonymous reader.
--
-- What this exposes is paper-trading decisions on generated and public market
-- data, already rendered in the deployed UI through the gateway proxy. There
-- are no accounts, no funds and no real orders behind these rows — the footer
-- of the site says so, and it remains true after this migration.
--
-- SELECT only. anon gets no INSERT, UPDATE or DELETE, and `order_blotter` is
-- append-only by trigger regardless.

create policy "Public demo desk blotter is readable anonymously"
  on public.order_blotter for select
  to anon
  using (
    desk_id = '00000000-0000-0000-0000-000000000001'::uuid
    and user_id is null
    and decided_by = 'gateway'
  );

grant select on public.order_blotter to anon;

-- Risk limits stay closed. They are the desk's configured thresholds, and
-- publishing exactly where the gates sit tells anyone how to size an order that
-- passes. The UI shows utilisation, which is the useful half, through the
-- gateway.
--
-- (No policy for anon on desk_risk_limits — the REVOKE in 20260808120200
-- stands.)

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- `postgres_changes` delivers a row only if the subscribing role could SELECT
-- it, so the policy above IS the subscription filter — an anon client cannot
-- subscribe its way past it.
--
-- REPLICA IDENTITY FULL is required for the old-row image on UPDATE/DELETE.
-- This table is append-only, so only INSERT is ever delivered; it is set anyway
-- because a table in a publication without it produces silently incomplete
-- payloads if that ever changes.

alter table public.order_blotter replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.order_blotter;
exception
  when duplicate_object then null;  -- already published; re-running is safe
  when undefined_object then
    raise notice 'supabase_realtime publication not found — enable Realtime in the dashboard first';
end $$;
