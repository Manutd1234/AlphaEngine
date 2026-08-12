-- The sessions behind "you are signed in on these devices".
--
-- `@supabase/supabase-js` has no client-side way to enumerate a user's
-- sessions — `listUserSessions` does not exist in 2.112.2, and this is not an
-- admin-gated call that a service key would unlock. `auth.sessions` is the only
-- record of them, so reading it takes a SECURITY DEFINER function that filters
-- to the caller.
--
-- TWO OUTCOMES, BOTH HANDLED HERE
--
-- Whether the migration role can actually SELECT `auth.sessions` is a property
-- of this project that the repository cannot prove: migrations elsewhere in
-- this corpus reference `auth.users` in foreign keys, which demonstrates
-- REFERENCES and says nothing about SELECT on a different table in that schema.
-- A PL/pgSQL body is not permission-checked at creation time, so guessing wrong
-- would produce a function that creates cleanly and throws on first call — in
-- the profile page, at the worst possible moment.
--
-- So it degrades instead. If the table cannot be read the function returns a
-- single row describing the current session, assembled from the caller's own
-- JWT, and stamps `source = 'jwt'`. The caller can then say "only this device
-- can be listed on this project" rather than showing a one-row list that reads
-- as "you are signed in nowhere else" — which would be a claim this function
-- had no evidence for. `source = 'sessions'` means the list is complete.
--
-- `search_path = ''` rather than `= auth, public`: with an empty path every
-- name below has to be written out, so no object can be resolved through a
-- schema someone else can create into. It satisfies the corpus-wide
-- `set search_path` guard identically.
create or replace function public.list_my_sessions()
returns table (
  session_id   uuid,
  created_at   timestamptz,
  refreshed_at timestamptz,
  user_agent   text,
  ip           text,
  is_current   boolean,
  source       text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  -- No session, no answer. A SECURITY DEFINER function reading an auth table
  -- must never run unfiltered, and `auth.uid()` is NULL for anon.
  if v_user_id is null then
    return;
  end if;

  begin
    return query
    select
      s.id,
      s.created_at::timestamptz,
      -- `refreshed_at` is `timestamp without time zone` in some GoTrue
      -- versions. Supabase runs the cluster in UTC, so the cast is exact
      -- there and is a no-op where the column is already tz-aware.
      s.refreshed_at::timestamptz,
      s.user_agent,
      -- `::text`, not `host()`. The column is `inet`, so the declared `text`
      -- return needs a cast either way — but a plain cast is also the one that
      -- survives a GoTrue version that stores this as text, where `host()`
      -- would be an undefined function.
      s.ip::text,
      coalesce(s.id = v_session, false),
      'sessions'::text
    from auth.sessions s
    where s.user_id = v_user_id
    order by coalesce(s.refreshed_at::timestamptz, s.created_at::timestamptz) desc;

    -- A signed-in caller always has at least the session they are calling
    -- with. An empty result therefore means the read was silently filtered
    -- rather than genuinely empty, and the fallback below is the honest answer.
    if found then
      return;
    end if;
  exception
    when insufficient_privilege
      or undefined_table
      or undefined_column
      or undefined_function then
      -- Fall through. Nothing about this is an error the caller can act on.
      null;
  end;

  return query
  select
    v_session,
    to_timestamp((auth.jwt() ->> 'iat')::double precision),
    to_timestamp((auth.jwt() ->> 'iat')::double precision),
    null::text,
    null::text,
    true,
    'jwt'::text;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and `anon` is a
-- member of PUBLIC. Without these two lines an anonymous visitor could call a
-- SECURITY DEFINER function that reads an auth table; it would return nothing
-- today only because `auth.uid()` is NULL, which is a coincidence of the filter
-- rather than a permission boundary.
revoke execute on function public.list_my_sessions() from public;
revoke execute on function public.list_my_sessions() from anon;
grant execute on function public.list_my_sessions() to authenticated;

-- PostgREST caches the schema. Without this the function exists and works in
-- SQL while returning 404 over HTTP, which reads as "the migration did not
-- apply" and sends you looking in the wrong place.
notify pgrst, 'reload schema';
