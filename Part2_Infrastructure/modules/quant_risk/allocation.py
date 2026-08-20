"""Target weights and the trades that reach them.

The trades belong to the proposal, so they are a method on it:
``proposal.rebalance_trades(positions)`` rather than
``rebalance_trades(proposal, positions)``. Nothing about that filter makes
sense without the proposal it filters, and the free function took it first
precisely because it was one.

``propose_allocation`` itself stays a free function. It is a *factory* for
``AllocationProposal`` that may decline to build one, and its natural
receiver would be ``Covariance`` — which lives in ``covariance.py``, which
this module already imports. Hanging it there would close the import into a
cycle to buy a shorter call site.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from modules.quant_risk.covariance import Covariance

# --------------------------------------------------------------------------- #
# Allocation
#
# The gap this fills: the platform could tell a PM what the book *is* — exposure,
# concentration, risk contributions — and nothing about what it should be. A
# proposal is not an instruction, and this one is deliberately naive about
# expected return: it allocates by risk, because forecasting covariance is hard
# and forecasting returns is harder, and a proposal that pretends otherwise is
# an opinion dressed as arithmetic.
# --------------------------------------------------------------------------- #

#: Every allocation method this engine solves, in the order the desk reads them:
#: the naive one first, then the three that price risk.
ALLOCATION_METHODS: tuple[str, ...] = ("equal_weight", "inverse_vol", "equal_risk", "min_variance")

#: Both iterative solvers run a fixed number of steps rather than testing for
#: convergence. A tolerance check lets two implementations stop on different
#: iterations and disagree by more than the cross-language fixture allows; a
#: fixed count cannot.
_SOLVER_ITERATIONS = 60


def portfolio_variance(cov: Covariance, weights: Mapping[str, float]) -> float:
    """wᵀΣw for a weight map keyed by symbol — see
    :meth:`~modules.quant_risk.covariance.Covariance.portfolio_variance`.

    Kept under this name because it is a question about the matrix that callers
    ask by name, and because ``__all__`` has exported it since the module was
    one file.
    """
    return cov.portfolio_variance(weights)


@dataclass
class TargetWeight:
    symbol: str
    current_weight: float
    target_weight: float
    current_notional: float
    target_notional: float
    drift: float
    #: Which constraint, if any, held this weight below its unclipped value.
    clipped_by: str | None


@dataclass
class AllocationProposal:
    method: str
    targets: list[TargetWeight]
    gross_before: float
    gross_after: float
    #: Weights before clipping summed to one; after clipping they may not.
    clipped: bool
    note: str

    def rebalance_trades(
        self,
        positions: Sequence[Mapping[str, Any]],
        drift_band: float = 0.05,
    ) -> list[dict[str, Any]]:
        """Trades needed to reach this proposal, filtered by a drift band.

        The band is what stops a rebalance from being a fee-generating machine:
        a position 1% away from target costs more to correct than the
        correction is worth. Only positions outside it are traded, and the
        reason for each trade travels with it.

        ``positions`` is still an argument because the proposal does not carry
        which *side* each position is on, and that decides the direction of the
        trade — adding to a short means selling more of it.
        """
        sides = {str(p.get("symbol")): str(p.get("side", "LONG")).upper() for p in positions}
        trades: list[dict[str, Any]] = []
        for target in self.targets:
            if abs(target.drift) < drift_band:
                continue
            delta = target.target_notional - target.current_notional
            long_position = sides.get(target.symbol, "LONG") != "SHORT"
            # Adding to a short means selling more of it; the direction depends on
            # which side the position is already on.
            side = ("BUY" if delta > 0 else "SELL") if long_position else ("SELL" if delta > 0 else "BUY")
            trades.append({
                "symbol": target.symbol,
                "side": side,
                "notional": round(abs(delta), 2),
                "reason": (
                    f"{'over' if delta < 0 else 'under'}weight by {abs(target.drift):.1%} of gross"
                    + (f" (target clipped by {target.clipped_by})" if target.clipped_by else "")
                ),
            })
        return trades


def propose_allocation(
    positions: Sequence[Mapping[str, Any]],
    cov: Covariance,
    equity: float,
    method: str = "inverse_vol",
    max_symbol_notional: float | None = None,
    max_gross_notional: float | None = None,
) -> AllocationProposal | None:
    """Constraint-aware target weights for the current book.

    Four methods, in increasing order of what they claim to know:

    * ``equal_weight`` — 1/n. It knows nothing and says so, which makes it the
      honest baseline the other three have to beat.
    * ``inverse_vol`` — each position sized by the reciprocal of its own
      volatility, so a quiet instrument carries more notional than a violent one
      for the same risk. Ignores correlation.
    * ``equal_risk`` — equalises each position's *contribution* to book
      volatility, which accounts for correlation: two names that move together
      are collectively one bet and get sized as one.
    * ``min_variance`` — the long-only, fully-invested portfolio with the
      smallest variance the estimated covariance allows. The most concentrated
      of the four by construction, so it clips against a symbol cap most often.

    None of them forecasts a return. All four are then clipped by the same limits
    the risk gateway enforces, and each clipped weight names the constraint that
    bound it — a proposal that ignored the limits would be rejected order by
    order at the gate, which is a worse way to discover it.
    """
    index = {s: i for i, s in enumerate(cov.symbols)}
    live = [p for p in positions if str(p.get("symbol")) in index and float(p.get("notional") or 0.0)]
    if not live or equity <= 0:
        return None

    vols = {
        str(p.get("symbol")): math.sqrt(max(0.0, cov.matrix[index[str(p.get("symbol"))]][index[str(p.get("symbol"))]]))
        for p in live
    }
    if any(v <= 0 for v in vols.values()):
        return None

    # Normalised explicitly rather than by falling through an else: the returned
    # proposal names its own method, and a silent fallback would let it name one
    # thing while the caller asked for another.
    if method not in ALLOCATION_METHODS:
        method = "inverse_vol"

    if method == "equal_weight":
        # 1/n over *distinct* symbols, not len(live). Both engines key weights by
        # symbol but iterate the position list when building targets, so a
        # duplicated symbol would collect the same weight twice and silently
        # inflate gross. `vols` is already keyed by symbol, so its length is the
        # distinct count.
        count = len(vols)
        weights = {s: 1.0 / count for s in vols}
    elif method == "min_variance":
        # Minimum variance, long-only and fully invested. The KKT condition for
        # `min wᵀΣw s.t. Σw = 1, w >= 0` is that every marginal variance (Σw)ᵢ is
        # equal on the support, which gives a multiplicative update in the same
        # shape as the equal-risk solver below — one solver family in this file
        # rather than two, and no simplex projection or step size to tune.
        #
        # Seeded with inverse *variance*, which is already the exact answer when
        # the correlations are zero, so the iteration only has to undo the
        # correlation.
        weights = {s: 1.0 / (v * v) for s, v in vols.items()}
        total = sum(weights.values())
        weights = {s: w / total for s, w in weights.items()}
        # A multiplicative fixed point is not proven to decrease the objective on
        # every step. A method called "minimum variance" that returned something
        # more volatile than inverse-vol would be indefensible, so the best
        # iterate is kept rather than whichever one the loop happened to end on.
        best = weights
        best_variance = cov.portfolio_variance(weights)
        for _ in range(_SOLVER_ITERATIONS):
            vector = [weights.get(s, 0.0) for s in cov.symbols]
            marginal = cov.marginal_variance(vector)
            variance = sum(vector[i] * marginal[i] for i in range(len(cov.symbols)))
            if variance <= 0:
                break
            updated = {}
            for symbol in weights:
                i = index[symbol]
                # A negative marginal variance is a hedge: the fixed point has no
                # update for it, and sqrt() of a negative would put a NaN into
                # every weight at the next renormalisation. Held flat, exactly as
                # equal_risk holds a non-positive contribution.
                if marginal[i] <= 0:
                    updated[symbol] = weights[symbol]
                    continue
                updated[symbol] = weights[symbol] * math.sqrt(variance / marginal[i])
            total = sum(updated.values()) or 1.0
            weights = {s: w / total for s, w in updated.items()}
            candidate = cov.portfolio_variance(weights)
            if candidate < best_variance:
                best_variance = candidate
                best = weights
        weights = best
    elif method == "equal_risk":
        # Fixed-point iteration toward equal risk contribution. Converges in a
        # handful of steps for the position counts this book carries; the
        # inverse-vol solution is the natural starting point because it is
        # already correct when correlations are zero.
        weights = {s: 1.0 / v for s, v in vols.items()}
        total = sum(weights.values())
        weights = {s: w / total for s, w in weights.items()}
        for _ in range(_SOLVER_ITERATIONS):
            vector = [weights.get(s, 0.0) for s in cov.symbols]
            marginal = cov.marginal_variance(vector)
            variance = sum(vector[i] * marginal[i] for i in range(len(cov.symbols)))
            if variance <= 0:
                break
            target_rc = variance / len(weights)
            updated = {}
            for symbol in weights:
                i = index[symbol]
                contribution = vector[i] * marginal[i]
                if contribution <= 0 or marginal[i] <= 0:
                    updated[symbol] = weights[symbol]
                    continue
                updated[symbol] = weights[symbol] * math.sqrt(target_rc / contribution)
            total = sum(updated.values()) or 1.0
            weights = {s: w / total for s, w in updated.items()}
    else:
        raw = {s: 1.0 / v for s, v in vols.items()}
        total = sum(raw.values())
        weights = {s: w / total for s, w in raw.items()}

    gross_before = sum(abs(float(p.get("notional") or 0.0)) for p in live)
    budget = min(gross_before, max_gross_notional) if max_gross_notional else gross_before

    targets: list[TargetWeight] = []
    clipped = False
    for p in live:
        symbol = str(p.get("symbol"))
        current_notional = abs(float(p.get("notional") or 0.0))
        target_notional = weights[symbol] * budget
        clipped_by = None
        if max_symbol_notional and target_notional > max_symbol_notional:
            target_notional = max_symbol_notional
            clipped_by = "max_symbol_notional_usd"
            clipped = True
        targets.append(TargetWeight(
            symbol=symbol,
            current_weight=current_notional / gross_before if gross_before else 0.0,
            target_weight=target_notional / budget if budget else 0.0,
            current_notional=round(current_notional, 2),
            target_notional=round(target_notional, 2),
            drift=round((target_notional - current_notional) / gross_before, 5) if gross_before else 0.0,
            clipped_by=clipped_by,
        ))

    targets.sort(key=lambda t: -abs(t.drift))
    gross_after = sum(t.target_notional for t in targets)

    return AllocationProposal(
        method=method,
        targets=targets,
        gross_before=round(gross_before, 2),
        gross_after=round(gross_after, 2),
        clipped=clipped,
        note=(
            "Risk-based only: no expected return is forecast, so this answers "
            "'how should the risk be spread', never 'what should we own'."
        ),
    )


def rebalance_trades(
    proposal: AllocationProposal,
    positions: Sequence[Mapping[str, Any]],
    drift_band: float = 0.05,
) -> list[dict[str, Any]]:
    """Trades needed to reach ``proposal`` — see
    :meth:`AllocationProposal.rebalance_trades`, which is where it now lives.

    Kept because the callers call it: ``/rebalance`` and ``/allocate`` in
    ``modules/telegram/_mixins``, and ``tools/make_risk_fixture.py``, which
    records the trades the TypeScript suite is held to.
    """
    return proposal.rebalance_trades(positions, drift_band)
