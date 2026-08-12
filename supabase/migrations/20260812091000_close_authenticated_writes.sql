-- Closing what a login opens.
--
-- Every grant below was harmless while nobody could sign in. Shipping the login
-- makes `authenticated` a role a stranger can actually hold — anyone who can
-- complete a sign-up — so each one has to be re-read as a public capability.
--
-- The headline is the first revoke. 20260808120300 removed execute on
-- record_alphaengine_decision from `public` and from `anon`, and its comment
-- concluded "service_role bypasses RLS and carries execute by default; nothing
-- else does." That is not true of `authenticated`: Supabase's project bootstrap
-- grants execute to anon, authenticated and service_role explicitly, and a
-- revoke from PUBLIC does not touch a grant made to a named role. The function
-- is SECURITY DEFINER, so it bypasses RLS; it defaults desk_id to the public
-- demo desk, hardcodes decided_by = 'gateway', and leaves user_id NULL — which
-- is precisely the shape the anon demo-tape policy publishes. A signed-in user
-- could therefore forge desk decisions (symbol, side, verdict, fill, latency)
-- into the tape every anonymous visitor watches, in an append-only table with
-- no delete path and a trigger that refuses UPDATE and DELETE.
--
-- Nothing here changes what the gateway can do: it connects with the
-- service-role key, which is exempt from RLS and unaffected by these revokes.

revoke execute on function public.record_alphaengine_decision(jsonb) from authenticated;

-- Provenance belongs to whoever did the deciding. A trader's own sandbox rows
-- are legitimate; a row claiming the gateway decided it is not something a
-- browser may assert, even about itself.
drop policy if exists "Traders insert own blotter rows" on public.order_blotter;
create policy "Traders insert own blotter rows"
  on public.order_blotter for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and decided_by = 'supabase_rpc'
  );

-- The two retrieval functions were created without any grant statement, so they
-- kept the default EXECUTE for anon and authenticated. They are SECURITY
-- INVOKER, so RLS still bounds the rows — but only the gateway's service-role
-- client is ever meant to call them, and leaving them open means a signed-in
-- browser gets a plausible `200 []` from a vector search rather than an honest
-- refusal. Empty-because-forbidden must not be indistinguishable from
-- empty-because-nothing-matched.
revoke execute on function public.match_research_documents(extensions.vector, integer, double precision, public.research_doc_kind) from anon, authenticated;
revoke execute on function public.match_research_documents_hybrid(extensions.vector, text, integer, public.research_doc_kind, integer) from anon, authenticated;

-- Defence in depth: RLS already blocks each of these (no matching policy, plus
-- the append-only trigger on order_blotter), so this changes no behaviour
-- today. It exists so that adding a policy later cannot quietly become the only
-- thing standing between a browser and a write.
revoke insert, update, delete on public.desk_risk_limits from authenticated;
revoke update, delete on public.order_blotter from authenticated;

notify pgrst, 'reload schema';
