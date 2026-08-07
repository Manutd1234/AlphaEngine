-- Row-level security: deny-by-default.
--
-- There are deliberately ZERO `anon` policies and an explicit REVOKE — the
-- published anon key can read nothing until an authenticated-user story
-- ships. That is what makes putting NEXT_PUBLIC_SUPABASE_* on Vercel a
-- deliberate decision later instead of an accident today.

alter table public.desk_risk_limits enable row level security;
alter table public.order_blotter enable row level security;

revoke all on public.desk_risk_limits from anon;
revoke all on public.order_blotter from anon;

-- Authenticated users (future login story): own rows only.
create policy "Traders read own risk limits"
  on public.desk_risk_limits for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Traders update own risk limits"
  on public.desk_risk_limits for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Traders read own blotter"
  on public.order_blotter for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Traders insert own blotter rows"
  on public.order_blotter for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
