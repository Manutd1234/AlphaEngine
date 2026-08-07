-- Two write paths with two honesty levels.
--
-- record_alphaengine_decision(jsonb): the GATEWAY's path. Takes a decision the
-- Python engine already made and appends it verbatim — measured latency, full
-- check vector, every gate that rejected. Service-role only.
--
-- submit_alphaengine_order(...): the blueprint's RPC, kept under its original
-- name but redefined as an explicitly-labelled SANDBOX decider, in the same
-- family as the browser sandbox in web/lib/blotter.ts — two gates instead of
-- fifteen, rows stamped decided_by='supabase_rpc', never mistakable for the
-- desk's decision. It exists so the schema is exercisable from SQL alone.

create or replace function public.record_alphaengine_decision(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.order_blotter (
    desk_id, decided_by, gateway_order_id, client_order_id, symbol, side,
    order_type, quantity, notional, venue, fill_price, filled_notional,
    slippage_bps, fee_usd, latency_ms, verdict, rejected_by, checks, status,
    strategy_tag, source, decided_at, occurred_at
  )
  values (
    coalesce((payload->>'desk_id')::uuid, '00000000-0000-0000-0000-000000000001'),
    'gateway',
    payload->>'gateway_order_id',
    payload->>'client_order_id',
    payload->>'symbol',
    (payload->>'side')::public.order_side,
    payload->>'order_type',
    (payload->>'quantity')::numeric,
    (payload->>'notional')::numeric,
    payload->>'venue',
    (payload->>'fill_price')::numeric,
    (payload->>'filled_notional')::numeric,
    (payload->>'slippage_bps')::numeric,
    (payload->>'fee_usd')::numeric,
    (payload->>'latency_ms')::numeric,
    (payload->>'verdict')::public.order_verdict,
    coalesce(
      (select array_agg(value::public.order_verdict)
         from jsonb_array_elements_text(payload->'rejected_by')),
      '{}'
    ),
    payload->'checks',
    payload->>'status',
    payload->>'strategy_tag',
    payload->>'source',
    (payload->>'decided_at')::timestamptz,
    coalesce((payload->>'occurred_at')::timestamptz, now())
  )
  on conflict on constraint unique_decider_order do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.record_alphaengine_decision(jsonb) from public;
revoke execute on function public.record_alphaengine_decision(jsonb) from anon;
-- service_role bypasses RLS and carries execute by default; nothing else does.

create or replace function public.submit_alphaengine_order(
  p_symbol text,
  p_side public.order_side,
  p_notional numeric,
  p_strategy_tag text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_limits public.desk_risk_limits%rowtype;
  v_verdict public.order_verdict := 'ACCEPTED';
begin
  if v_user_id is null then
    raise exception 'Unauthenticated request';
  end if;

  select * into v_limits
  from public.desk_risk_limits
  where user_id = v_user_id and desk_symbol = p_symbol and is_active = true;

  if not found then
    v_limits.max_order_notional_usd := 50000.00;
  end if;

  if p_notional > v_limits.max_order_notional_usd then
    v_verdict := 'max_order_notional';
  end if;

  insert into public.order_blotter (
    user_id, decided_by, symbol, side, notional, verdict, rejected_by,
    strategy_tag, status, source
  )
  values (
    v_user_id, 'supabase_rpc', p_symbol, p_side, p_notional, v_verdict,
    case when v_verdict = 'ACCEPTED'
      then '{}'::public.order_verdict[]
      else array[v_verdict]
    end,
    p_strategy_tag,
    case when v_verdict = 'ACCEPTED' then 'FILLED' else 'REJECTED' end,
    'sandbox_rpc'
  );

  return jsonb_build_object(
    'decided_by', 'supabase_rpc',
    'sandbox', true,
    'verdict', v_verdict,
    'status', case when v_verdict = 'ACCEPTED' then 'SENT' else 'REJECTED' end,
    'note', 'Two-gate SQL sandbox — the fifteen-gate decision is the gateway''s alone.'
  );
end;
$$;

revoke execute on function public.submit_alphaengine_order(text, public.order_side, numeric, text) from public;
revoke execute on function public.submit_alphaengine_order(text, public.order_side, numeric, text) from anon;
grant execute on function public.submit_alphaengine_order(text, public.order_side, numeric, text) to authenticated;
