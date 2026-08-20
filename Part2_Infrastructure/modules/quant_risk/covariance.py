"""Covariance, portfolio risk and its per-position contributions.

``Covariance`` answers the questions that are *about the matrix*: the marginal
variance of a weight, the variance of a weighting, and what the book's risk
decomposes into. They are methods because a caller holding the estimate should
not have to know which free function to pass it to — and because the marginal
vector was being spelled out three times, once here and twice in the two
allocation solvers, which is three chances for the summation order to drift
away from ``web/lib/portfolio-risk.ts``.

The free functions below are kept as thin delegates. Every one of the 43 import
sites across the gateway, plus ``tools/make_risk_fixture.py`` which records the
Python↔TypeScript parity fixture, calls them by name.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from modules.quant_risk._common import (
    BARS_PER_YEAR,
    ES95_MULTIPLIER,
    Z95,
    _mean,
)


@dataclass
class Covariance:
    symbols: list[str]
    matrix: list[list[float]]
    observations: int
    annualisation: float
    correlation: list[list[float]] = field(default_factory=list)

    def marginal_variance(self, weights: Sequence[float]) -> list[float]:
        """``(Σw)ᵢ`` for a weight vector in ``symbols`` order.

        The derivative of portfolio variance with respect to weight ``i``: what
        one more unit of this position does to book variance, given everything
        else the book holds. Both allocation solvers iterate on it and
        :meth:`portfolio_risk` decomposes with it.

        Sequential summation, never ``math.fsum`` or ``numpy.dot``, for the
        reason :meth:`portfolio_variance` gives.
        """
        size = len(self.symbols)
        return [
            sum(self.matrix[i][j] * weights[j] for j in range(size))
            for i in range(size)
        ]

    def portfolio_variance(self, weights: Mapping[str, float]) -> float:
        """wᵀΣw for a weight map keyed by symbol.

        Mirrors ``portfolioVariance`` in web/lib/portfolio-risk.ts. The
        summation is sequential in both, never ``math.fsum`` or ``numpy.dot``:
        pairwise summation rounds differently from JavaScript's left-to-right
        accumulation, and the parity fixture exists to catch exactly that class
        of drift.
        """
        size = len(self.symbols)
        vector = [float(weights.get(s, 0.0)) for s in self.symbols]
        return sum(
            vector[i] * sum(self.matrix[i][j] * vector[j] for j in range(size))
            for i in range(size)
        )

    def portfolio_risk(
        self,
        positions: Sequence[Mapping[str, Any]],
        equity: float,
    ) -> PortfolioRisk | None:
        """
        Book volatility and each position's *contribution* to it.

        Share of notional is not share of risk, and the gap is the reason this
        exists. A 13% sleeve in a volatile name can carry more risk than a 42%
        one in a quiet name, and a short that hedges the book contributes a
        **negative** amount — a number a notional-weighted view cannot produce
        at all.

        Weights are signed and scaled by equity, so a short enters the
        quadratic form with a negative weight and its covariance with the longs
        subtracts.
        """
        index = {s: i for i, s in enumerate(self.symbols)}
        weights = [0.0] * len(self.symbols)
        for p in positions:
            i = index.get(str(p.get("symbol")))
            if i is None or equity <= 0:
                continue
            direction = -1.0 if str(p.get("side")).upper() == "SHORT" else 1.0
            weights[i] += direction * float(p.get("notional") or 0.0) / equity

        n = len(self.symbols)
        # Marginal contribution: (Σw)_i — the derivative of variance in weight i.
        marginal = self.marginal_variance(weights)
        variance = sum(weights[i] * marginal[i] for i in range(n))
        if variance <= 0:
            return None
        vol = math.sqrt(variance)

        gross = sum(abs(float(p.get("notional") or 0.0)) for p in positions) or 1.0
        contributions: list[RiskContribution] = []
        for p in positions:
            symbol = str(p.get("symbol"))
            i = index.get(symbol)
            if i is None:
                continue
            notional = float(p.get("notional") or 0.0)
            contribution = weights[i] * marginal[i]
            contributions.append(
                RiskContribution(
                    symbol=symbol,
                    notional=notional,
                    share_of_gross=abs(notional) / gross,
                    standalone_vol=math.sqrt(max(0.0, self.matrix[i][i])) * self.annualisation,
                    marginal=marginal[i],
                    contribution=contribution,
                    contribution_share=contribution / variance,
                )
            )
        contributions.sort(key=lambda c: c.contribution_share, reverse=True)

        # Diversification ratio: weighted standalone vol over realised book vol.
        weighted_standalone = sum(
            abs(weights[i]) * math.sqrt(max(0.0, self.matrix[i][i])) for i in range(n)
        )

        return PortfolioRisk(
            volatility=vol,
            annualised_volatility=vol * self.annualisation,
            var95=Z95 * vol * equity,
            cvar95=ES95_MULTIPLIER * vol * equity,
            observations=self.observations,
            contributions=contributions,
            diversification_ratio=(weighted_standalone / vol) if vol > 0 else None,
        )


def build_covariance(
    returns_by_symbol: Mapping[str, Sequence[float]],
    interval: str = "1d",
) -> Covariance | None:
    """
    Sample covariance over the window every symbol shares.

    Truncating to the shortest series rather than padding is the whole point: a
    symbol with a shorter history would otherwise have its missing bars treated
    as zero-return days, which understates its variance and — because the zeros
    line up across symbols — inflates every correlation toward one.
    """
    symbols = sorted(s for s, r in returns_by_symbol.items() if len(r) >= 2)
    if len(symbols) < 1:
        return None

    window = min(len(returns_by_symbol[s]) for s in symbols)
    if window < 2:
        return None
    aligned = {s: list(returns_by_symbol[s])[-window:] for s in symbols}
    means = {s: _mean(aligned[s]) for s in symbols}

    n = len(symbols)
    matrix = [[0.0] * n for _ in range(n)]
    for i, a in enumerate(symbols):
        for j in range(i, n):
            b = symbols[j]
            cov = sum(
                (aligned[a][k] - means[a]) * (aligned[b][k] - means[b])
                for k in range(window)
            ) / (window - 1)
            matrix[i][j] = cov
            matrix[j][i] = cov

    correlation = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            denom = math.sqrt(matrix[i][i] * matrix[j][j])
            correlation[i][j] = (matrix[i][j] / denom) if denom > 0 else 0.0

    return Covariance(
        symbols=symbols,
        matrix=matrix,
        observations=window,
        annualisation=math.sqrt(BARS_PER_YEAR.get(interval, 365)),
        correlation=correlation,
    )


@dataclass
class RiskContribution:
    symbol: str
    notional: float
    share_of_gross: float
    standalone_vol: float
    marginal: float
    contribution: float
    contribution_share: float


@dataclass
class PortfolioRisk:
    volatility: float
    annualised_volatility: float
    var95: float
    cvar95: float
    observations: int
    contributions: list[RiskContribution]
    diversification_ratio: float | None


def portfolio_risk(
    positions: Sequence[Mapping[str, Any]],
    cov: Covariance,
    equity: float,
) -> PortfolioRisk | None:
    """Book volatility and each position's contribution — see
    :meth:`Covariance.portfolio_risk`, which is where it now lives.

    Kept because the callers call it: ``modules/telegram/_mixins/risk.py`` for
    ``/riskcontrib`` and ``/exposure``, and the parity-fixture generator.
    """
    return cov.portfolio_risk(positions, equity)
