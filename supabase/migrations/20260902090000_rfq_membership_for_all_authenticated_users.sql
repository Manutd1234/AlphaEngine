-- Provision the shared RFQ desk for every Supabase Auth account.
--
-- The Makers RFQ read is account-private, so anonymous callers must remain
-- denied.  Requiring operators to insert one desk_risk_limits row per email,
-- however, made a valid sign-in look unprovisioned whenever the email lookup
-- selected no auth.users row.  Membership is an account property, not an
-- email-string property: backfill by auth.users.id and maintain the invariant
-- for every future account at signup.
--
-- The trigger function is SECURITY DEFINER because authenticated clients are
-- deliberately denied writes to desk_risk_limits.  Its empty search_path and
-- schema-qualified objects prevent object-shadowing, and EXECUTE is revoked so
-- it cannot become a browser-callable RPC.

create or replace function public.provision_default_rfq_desk_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.desk_risk_limits (
    desk_id,
    user_id,
    desk_symbol,
    authority_level,
    is_active
  )
  values (
    '00000000-0000-0000-0000-000000000001'::uuid,
    new.id,
    'BTCUSDT',
    'PAPER_ONLY'::public.desk_authority,
    true
  )
  on conflict on constraint unique_desk_user_symbol
  do update set
    is_active = true,
    updated_at = pg_catalog.now();

  return new;
end;
$$;

revoke execute on function public.provision_default_rfq_desk_membership() from public;
revoke execute on function public.provision_default_rfq_desk_membership() from anon;
revoke execute on function public.provision_default_rfq_desk_membership() from authenticated;

drop trigger if exists provision_default_rfq_desk_membership on auth.users;
create trigger provision_default_rfq_desk_membership
  after insert on auth.users
  for each row execute function public.provision_default_rfq_desk_membership();

-- Repair existing accounts in the same migration.  On conflict, preserve any
-- operator-tuned limits and authority level while restoring the membership
-- invariant requested for this shared RFQ desk.
insert into public.desk_risk_limits (
  desk_id,
  user_id,
  desk_symbol,
  authority_level,
  is_active
)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  auth_user.id,
  'BTCUSDT',
  'PAPER_ONLY'::public.desk_authority,
  true
from auth.users as auth_user
on conflict on constraint unique_desk_user_symbol
do update set
  is_active = true,
  updated_at = pg_catalog.now();

-- Do not let an apparently successful deployment leave an existing account
-- behind.  A raised exception makes the schema workflow fail and rolls the
-- migration back instead of publishing a false all-users claim.
do $$
begin
  if exists (
    select 1
    from auth.users as auth_user
    where not exists (
      select 1
      from public.desk_risk_limits as membership
      where membership.desk_id = '00000000-0000-0000-0000-000000000001'::uuid
        and membership.user_id = auth_user.id
        and membership.is_active = true
    )
  ) then
    raise exception 'RFQ desk membership backfill is incomplete';
  end if;
end;
$$;

notify pgrst, 'reload schema';
