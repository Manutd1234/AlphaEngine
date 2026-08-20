"""
Portfolio risk, position sizing and regime — the gateway's own copy.
====================================================================

The web workspace computes VaR, correlation and risk contributions in
``web/lib/portfolio-risk.ts`` (a sibling of this package). The Telegram companion cannot reach that code: it
is a Python process talking to this gateway, and routing a chat command through
a Vercel deployment to answer a question about the gateway's own book would make
the bot's answers depend on a service that has nothing to do with the book.

So the maths lives here too, deliberately, the same way ``backtester.py`` and
``engine.ts`` are two implementations of one accounting. The conventions below
are copied from the TypeScript so a number quoted in Telegram and the same
number on the web tab cannot disagree:

* returns are simple (not log) per-bar,
* covariance is sample covariance with ``ddof=1``,
* VaR is parametric-normal at 95%: ``1.645 · σ · equity``,
* CVaR uses the normal expected-shortfall multiplier ``φ(z)/(1−α) = 2.063``,
* annualisation is ``√(bars per year)``.

Two things here have no TypeScript counterpart yet and are new to both stacks:
``kelly_fraction`` and ``volatility_regime``.


The module became a package. Nothing else changed: every name below is
re-exported so the 43 import sites across the gateway keep working, and
`from modules.quant_risk import propose_allocation` means what it always did.

Split by concern, and the concerns were already marked — the banner comments
in the single file are exactly these boundaries.
"""

from __future__ import annotations

from modules.quant_risk._common import (
    BARS_PER_YEAR,
    ES95_MULTIPLIER,
    Z95,
    returns_from_closes,
)
from modules.quant_risk.allocation import (
    ALLOCATION_METHODS,
    AllocationProposal,
    TargetWeight,
    portfolio_variance,
    propose_allocation,
    rebalance_trades,
)
from modules.quant_risk.backtest import (
    VarBacktest,
    rolling_var_backtest,
    rolling_var_path,
    var_backtest,
)
from modules.quant_risk.covariance import (
    Covariance,
    PortfolioRisk,
    RiskContribution,
    build_covariance,
    portfolio_risk,
)
from modules.quant_risk.regimes import (
    Dislocation,
    VolatilityRegime,
    find_dislocation,
    volatility_regime,
)
from modules.quant_risk.scenarios import (
    SCENARIOS,
    ScenarioLeg,
    ScenarioResult,
    apply_scenario,
    beta,
    run_scenarios,
)
from modules.quant_risk.sizing import (
    KellySizing,
    kelly_fraction,
)
from modules.quant_risk.var import (
    RESAMPLERS,
    HistoricalVaR,
    LossBand,
    MonteCarlo,
    bootstrap_terminal_distribution,
    derived_block_length,
    historical_var,
)

__all__ = [
    "ALLOCATION_METHODS",
    "AllocationProposal",
    "BARS_PER_YEAR",
    "Covariance",
    "Dislocation",
    "ES95_MULTIPLIER",
    "HistoricalVaR",
    "KellySizing",
    "LossBand",
    "MonteCarlo",
    "PortfolioRisk",
    "RESAMPLERS",
    "RiskContribution",
    "SCENARIOS",
    "ScenarioLeg",
    "ScenarioResult",
    "TargetWeight",
    "VarBacktest",
    "VolatilityRegime",
    "Z95",
    "apply_scenario",
    "beta",
    "bootstrap_terminal_distribution",
    "build_covariance",
    "derived_block_length",
    "find_dislocation",
    "historical_var",
    "kelly_fraction",
    "portfolio_risk",
    "portfolio_variance",
    "propose_allocation",
    "rebalance_trades",
    "returns_from_closes",
    "rolling_var_backtest",
    "rolling_var_path",
    "run_scenarios",
    "var_backtest",
    "volatility_regime",
]
