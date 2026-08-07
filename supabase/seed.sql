-- Single-tenant seed: one limits row for the fixed desk, mirroring config.py
-- defaults (pinned by tests/test_supabase_schema.py).
insert into public.desk_risk_limits (
  desk_id, user_id, desk_symbol, authority_level,
  max_order_notional_usd, max_gross_exposure_usd, max_symbol_notional_usd,
  max_daily_drawdown_pct, max_est_slippage_bps
)
values (
  '00000000-0000-0000-0000-000000000001', null, 'BTCUSDT', 'PAPER_ONLY',
  50000.00, 500000.00, 150000.00, 0.05, 75.00
)
on conflict on constraint unique_desk_user_symbol do nothing;
