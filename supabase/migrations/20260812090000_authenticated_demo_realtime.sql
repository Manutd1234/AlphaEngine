-- Signing in must not cost the public demo tape.
--
-- Supersedes the "there is no login UI yet" notes in 20260808120100 and
-- 20260808120200: a login ships now. Those files stay as written — a migration
-- that has been applied is history, not documentation.
--
-- The demo policy in 20260808120700 is scoped `to anon`, and RLS policies are
-- role-scoped. The moment a browser carries a user JWT, PostgREST and Realtime
-- evaluate it as `authenticated`, that policy stops applying, and the only
-- authenticated SELECT policy on this table is `auth.uid() = user_id` — which
-- no gateway-mirrored row can satisfy, because they all carry user_id NULL.
-- The result would not be an error. It would be an empty tape that still
-- reports itself live: exactly the silent wrongness this project keeps trying
-- to design out.
--
-- The predicate below is the same one anon gets, verbatim. It publishes
-- nothing new: only gateway-decided, unowned rows on the fixed demo desk. A
-- signed-in trader's own rows carry their user_id and remain private under the
-- existing own-row policy.
create policy "Public demo desk blotter is readable when signed in"
  on public.order_blotter for select
  to authenticated
  using (
    desk_id = '00000000-0000-0000-0000-000000000001'::uuid
    and user_id is null
    and decided_by = 'gateway'
  );

notify pgrst, 'reload schema';
