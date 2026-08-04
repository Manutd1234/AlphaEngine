"""AlphaEngine Trading Automation modules.

A — tca_engine  : cross-venue L2 order book ingest, VWAP / slippage, smart routing
B — risk_proxy  : pre-trade validation, circuit breakers, emergency kill switch
C — backtester  : parametric sweeps with multiple-testing correction

Support: audit (DuckDB), jobs (async queue), telegram (independent text-only
updates), schemas (shared contracts).
"""

__all__ = ["audit", "backtester", "jobs", "risk_proxy", "schemas", "tca_engine", "telegram"]
