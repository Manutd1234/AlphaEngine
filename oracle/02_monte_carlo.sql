-- AlphaEngine — in-database Monte Carlo VaR.
--
-- The master blueprint's Phase 4 listing has four defects. All four are fixed
-- here, and the differences are load-bearing rather than stylistic:
--
--  1. `FORALL i IN 1..p_simulations PARALLEL` is not valid PL/SQL. FORALL
--     iterates a bound COLLECTION and has no PARALLEL clause; the block does
--     not compile. Replaced with a set-based generator.
--
--  2. `monte_carlo_runs` is referenced but never created anywhere in the
--     blueprint.
--
--  3. The percentile was taken over the WHOLE of that table with no predicate,
--     so two callers — or the same caller twice — read each other's paths and
--     the reported VaR drifts further from the truth on every invocation. That
--     is a wrong number that looks plausible, which is the worst kind.
--
--  4. It persisted 100,000 rows per call. This procedure is reachable from a
--     public serverless route, so persisting made it a way for anonymous
--     traffic to fill the tablespace of an Always Free instance. Nothing is
--     written now: the paths are generated in an inline view, the percentile is
--     taken over that view, and the whole thing disappears when the statement
--     ends. No table, no run key, no cleanup, no growth.
--
-- The model is unchanged from the blueprint — GBM terminal value under the
-- risk-neutral-style drift adjustment:
--     S_T = S_0 · exp( (mu − ½σ²)·T  +  σ·√T·Z )
-- VaR 99 is the initial equity less the 1st percentile of the terminal
-- distribution. Note this is a TERMINAL-value VaR: it says nothing about the
-- path, so it is not comparable to a max-drawdown figure and must not be
-- presented as one.

CREATE OR REPLACE PROCEDURE run_monte_carlo_portfolio(
  p_initial_equity IN  NUMBER,
  p_mu             IN  NUMBER,   -- expected annual return, e.g. 0.08
  p_sigma          IN  NUMBER,   -- annual volatility, e.g. 0.45
  p_days           IN  NUMBER,   -- forecast horizon in days
  p_simulations    IN  NUMBER,   -- paths; capped below
  p_var_99         OUT NUMBER,   -- 99% Value at Risk, in currency
  p_expected       OUT NUMBER,   -- mean terminal equity
  p_paths_used     OUT NUMBER    -- what the cap actually allowed
) AS
  -- The cap is enforced HERE and not only in the caller. The route can be
  -- changed by anyone editing TypeScript; the database is the last line that
  -- decides how much CPU one anonymous request may spend.
  c_max_paths CONSTANT NUMBER := 50000;
  c_min_paths CONSTANT NUMBER := 100;

  v_dt        NUMBER := 1 / 365;
  v_horizon   NUMBER;
  v_drift     NUMBER;
  v_diffusion NUMBER;
  v_floor     NUMBER;
BEGIN
  IF p_initial_equity IS NULL OR p_initial_equity <= 0 THEN
    RAISE_APPLICATION_ERROR(-20001, 'p_initial_equity must be positive');
  END IF;
  IF p_sigma IS NULL OR p_sigma < 0 THEN
    RAISE_APPLICATION_ERROR(-20002, 'p_sigma must be non-negative');
  END IF;
  IF p_days IS NULL OR p_days <= 0 THEN
    RAISE_APPLICATION_ERROR(-20003, 'p_days must be positive');
  END IF;

  p_paths_used := LEAST(GREATEST(NVL(p_simulations, 10000), c_min_paths), c_max_paths);

  v_horizon   := p_days * v_dt;
  v_drift     := (p_mu - 0.5 * POWER(p_sigma, 2)) * v_horizon;
  v_diffusion := p_sigma * SQRT(v_horizon);

  SELECT PERCENTILE_CONT(0.01) WITHIN GROUP (ORDER BY final_equity ASC),
         AVG(final_equity)
    INTO v_floor, p_expected
    FROM (
      SELECT p_initial_equity
               * EXP(v_drift + v_diffusion * DBMS_RANDOM.NORMAL) AS final_equity
        FROM dual
      CONNECT BY LEVEL <= p_paths_used
    );

  -- Reported as a loss: positive means "this much equity at risk". A simulated
  -- 1st percentile above the starting equity is possible with a large positive
  -- drift, and reporting that as a negative VaR would be honest but useless, so
  -- it floors at zero and the caller sees p_expected for the upside.
  p_var_99 := GREATEST(p_initial_equity - v_floor, 0);
END;
/
