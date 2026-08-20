-- Two gates the engine can emit that the verdict enum never had.
--
-- WHY THIS WAS MISSED FOR THE WHOLE LIFE OF THE ENUM
--
-- `tests/test_supabase_schema.py` harvested the engine's gate names by
-- regexing the risk-proxy source for `add("...")`. That pattern can only see a
-- call whose name literal sits on the SAME LINE as the `add(`, and these two do
-- not — both carry `observed=`/`limit=` and are written across several lines.
-- So the harvest returned FIFTEEN names, and `GATE_TO_VERDICT` also held
-- fifteen keys, so a set comparison of fifteen against fifteen passed.
--
-- Both sides had drifted to the same wrong answer, which is the one
-- arrangement a set comparison cannot detect. The comment above the original
-- enum says "the fifteen real gates" — it was written from the same bad count.
--
-- WHAT IT COST, and it is not a missing label but a wrong one:
-- `verdict_for()` ends `labels[0] if labels else "kill_switch"`. An order
-- refused ONLY by one of these two produced no label at all and fell through to
-- **kill_switch** — so a paper-equity order refused for a stale reference quote
-- was recorded in Postgres as having been stopped by the desk's kill switch.
-- Both gates fire only on the paper-equity path, which is the path this desk
-- actually trades.
--
-- `unmapped_gate` is added alongside them so the next gate to arrive without a
-- verdict is VISIBLE rather than disguised as a halt. A wrong verdict that
-- reads as calm is worse than one that reads as unknown.

alter type public.order_verdict add value if not exists 'paper_execution_model';
alter type public.order_verdict add value if not exists 'reference_freshness';
alter type public.order_verdict add value if not exists 'unmapped_gate';
