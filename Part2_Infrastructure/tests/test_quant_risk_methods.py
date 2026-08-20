"""The result types answer for themselves, and answer identically.

``modules/quant_risk`` was a package of dataclasses with no methods and ~23 free
functions, several of which took a result object as their first argument. Those
are now methods on the object, with the free function kept as a delegate for the
callers that name it.

The risk in that move is not that a method is missing — that fails loudly. It is
that the method and the delegate quietly stop being the same calculation, and
that the arithmetic drifts from ``web/lib/portfolio-risk.ts``, which
``web/tests/fixtures/risk-parity.json`` pins bit-for-bit. So every assertion here
is either "the two routes give the SAME object" or "the summation order is still
the sequential one the TypeScript uses".

The last class documents the opposite decision: the free functions that were
deliberately left free, and why each one would have been worse as a method.
"""

from __future__ import annotations

import pytest

from modules.quant_risk import (
    bootstrap_terminal_distribution,
    build_covariance,
    portfolio_risk,
    portfolio_variance,
    propose_allocation,
    rebalance_trades,
)
from modules.quant_risk.montecarlo import _loss_band

RETURNS = {
    "AAA": [0.01, -0.012, 0.008, -0.006, 0.011, -0.009, 0.013, -0.004],
    "BBB": [0.009, -0.011, 0.007, -0.005, 0.010, -0.008, 0.012, -0.003],
    "CCC": [0.004, 0.013, -0.010, 0.002, -0.014, 0.006, -0.002, 0.009],
}

POSITIONS = [
    {"symbol": "AAA", "side": "LONG", "notional": 600_000},
    {"symbol": "BBB", "side": "SHORT", "notional": 250_000},
    {"symbol": "CCC", "side": "LONG", "notional": 150_000},
]

EQUITY = 1_000_000.0


@pytest.fixture
def cov():
    matrix = build_covariance(RETURNS, interval="1d")
    assert matrix is not None
    return matrix


class TestTheCovarianceAnswersAboutItsOwnMatrix:
    def test_the_method_and_the_free_function_agree(self, cov):
        weights = {"AAA": 0.6, "BBB": -0.25, "CCC": 0.15}
        assert cov.portfolio_variance(weights) == portfolio_variance(cov, weights)

    def test_the_summation_stays_sequential(self, cov):
        """``portfolioVariance`` in the TypeScript accumulates left to right.

        ``math.fsum`` and ``numpy.dot`` round differently, which is exactly the
        drift the parity fixture exists to catch — so this pins the expression
        rather than an approximate value.
        """
        weights = {"AAA": 0.6, "BBB": -0.25, "CCC": 0.15}
        size = len(cov.symbols)
        vector = [float(weights.get(s, 0.0)) for s in cov.symbols]
        expected = sum(
            vector[i] * sum(cov.matrix[i][j] * vector[j] for j in range(size))
            for i in range(size)
        )
        assert cov.portfolio_variance(weights) == expected

    def test_the_marginal_vector_is_the_row_product_in_symbol_order(self, cov):
        """One spelling of ``(Σw)ᵢ``, shared by the risk decomposition and both solvers."""
        vector = [0.5, -0.2, 0.7]
        size = len(cov.symbols)
        expected = [
            sum(cov.matrix[i][j] * vector[j] for j in range(size))
            for i in range(size)
        ]
        assert cov.marginal_variance(vector) == expected

    def test_a_missing_symbol_weighs_nothing(self, cov):
        assert cov.portfolio_variance({"NOPE": 1.0}) == 0.0

    def test_portfolio_risk_by_method_and_by_function_are_the_same_object(self, cov):
        assert cov.portfolio_risk(POSITIONS, EQUITY) == portfolio_risk(POSITIONS, cov, EQUITY)

    def test_a_flat_book_declines_the_same_way_on_both_routes(self, cov):
        assert cov.portfolio_risk([], EQUITY) is None
        assert portfolio_risk([], cov, EQUITY) is None

    def test_the_decomposition_still_uses_the_shared_marginal(self, cov):
        """Each contribution is ``wᵢ·(Σw)ᵢ``, off the same vector the solvers use."""
        risk = cov.portfolio_risk(POSITIONS, EQUITY)
        assert risk is not None
        index = {s: i for i, s in enumerate(cov.symbols)}
        weights = [0.0] * len(cov.symbols)
        for p in POSITIONS:
            direction = -1.0 if p["side"] == "SHORT" else 1.0
            weights[index[p["symbol"]]] += direction * float(p["notional"]) / EQUITY
        marginal = cov.marginal_variance(weights)
        for contribution in risk.contributions:
            i = index[contribution.symbol]
            assert contribution.marginal == marginal[i]
            assert contribution.contribution == weights[i] * marginal[i]


class TestTheProposalYieldsItsOwnTrades:
    @pytest.fixture
    def proposal(self, cov):
        p = propose_allocation(POSITIONS, cov, EQUITY, method="equal_risk")
        assert p is not None
        return p

    def test_the_method_and_the_free_function_agree(self, proposal):
        assert proposal.rebalance_trades(POSITIONS, 0.01) == rebalance_trades(
            proposal, POSITIONS, drift_band=0.01
        )

    def test_the_default_band_is_the_one_the_desk_calls_with(self, proposal):
        """``/rebalance`` and ``tools/make_risk_fixture.py`` both pass 0.05."""
        assert proposal.rebalance_trades(POSITIONS) == proposal.rebalance_trades(POSITIONS, 0.05)

    def test_a_wide_band_trades_nothing(self, proposal):
        assert proposal.rebalance_trades(POSITIONS, 0.99) == []

    def test_the_side_still_comes_from_the_position_not_the_target(self, proposal):
        """Adding to a short means selling more of it — the reason ``positions``
        is still an argument rather than something the proposal could know."""
        trades = {t["symbol"]: t for t in proposal.rebalance_trades(POSITIONS, 0.0001)}
        flipped = [{**p, "side": "SHORT" if p["side"] == "LONG" else "LONG"} for p in POSITIONS]
        mirrored = {t["symbol"]: t for t in proposal.rebalance_trades(flipped, 0.0001)}
        for symbol, trade in trades.items():
            assert mirrored[symbol]["side"] != trade["side"], symbol
            assert mirrored[symbol]["notional"] == trade["notional"]


class TestTheDistributionsAnswerOffTheSeriesTheyHold:
    @pytest.fixture
    def series(self):
        return [(-1.0) ** i * (100.0 + i) for i in range(180)]

    def test_a_loss_quantile_is_read_off_the_drawn_paths(self, series):
        mc = bootstrap_terminal_distribution(series, 5, paths=400, seed=11)
        assert mc is not None
        assert mc.loss_at(99.0) == _loss_band(mc.terminal_pnl, 99.0)

    def test_asking_afterwards_matches_asking_up_front(self, series):
        """A 99 asked for after the draw and a 99 asked for before it are one rule."""
        mc = bootstrap_terminal_distribution(
            series, 5, paths=400, seed=11, loss_confidences=(99.0,)
        )
        assert mc is not None
        assert mc.loss_at(99.0) == mc.loss_bands[0]

    def test_the_95_band_is_the_headline_pair(self, series):
        mc = bootstrap_terminal_distribution(series, 5, paths=400, seed=11)
        assert mc is not None
        assert mc.loss_at(95.0).loss == mc.var95
        assert mc.loss_at(95.0).conditional_loss == mc.cvar95

    def test_the_historical_figure_bootstraps_its_own_replayed_pnl(self):
        """``/montecarlo`` was already doing this by hand, field by field."""
        from modules.quant_risk import historical_var

        returns = {s: v * 30 for s, v in RETURNS.items()}
        hv = historical_var(POSITIONS, returns, EQUITY)
        assert hv is not None

        by_method = hv.bootstrap(5, paths=300, seed=3)
        by_function = bootstrap_terminal_distribution(hv.daily_pnl, 5, paths=300, seed=3)
        assert by_method == by_function

    def test_a_bootstrap_that_declines_declines_on_both_routes(self):
        from modules.quant_risk import HistoricalVaR

        short = HistoricalVaR(var95=1.0, cvar95=2.0, observations=20, daily_pnl=(1.0,) * 59)
        assert short.bootstrap(5) is None
        assert bootstrap_terminal_distribution(short.daily_pnl, 5) is None

    def test_the_resampler_a_run_reports_is_still_derived(self, series):
        mc = bootstrap_terminal_distribution(series, 5, paths=300, seed=4, mean_block_length=8)
        assert mc is not None
        assert mc.resampler == "stationary"
        assert mc.mean_block_length == 8


class TestWhatDeliberatelyStayedAFreeFunction:
    """Not every free function wanted a receiver, and three actively refused one.

    Recorded as assertions rather than a comment so that "it is still a free
    function" is a property the suite holds, not a claim in a docstring nobody
    re-reads.
    """

    def test_the_factories_are_still_factories(self, cov):
        """``build_covariance``, ``historical_var``, ``propose_allocation``,
        ``apply_scenario``, ``kelly_fraction`` and ``volatility_regime`` all
        return ``None`` or a fresh object depending on whether the data supports
        one. A constructor that may decline to construct is not a constructor,
        and ``Covariance.from_returns() -> Covariance | None`` would be the same
        function wearing a classmethod's clothes.
        """
        from modules.quant_risk import build_covariance as build

        assert build({"A": [0.01]}) is None
        assert isinstance(build(RETURNS), type(cov))

    def test_propose_allocation_did_not_move_onto_the_covariance(self, cov):
        """Its natural receiver would be ``Covariance`` — and ``allocation.py``
        already imports ``covariance.py``, so hanging it there closes the import
        into a cycle to buy a shorter call site. It stays free.
        """
        import modules.quant_risk.allocation as allocation

        assert not hasattr(cov, "propose_allocation")
        assert callable(allocation.propose_allocation)

    def test_var_backtest_did_not_move_onto_the_historical_figure(self):
        """``HistoricalVaR.backtest()`` reads beautifully and would be worthless.

        ``var_backtest`` would score the forecast against the very series it was
        computed from, and ``rolling_var_backtest`` says why that is not a test:
        "a VaR evaluated in-sample passes trivially and tells a risk manager
        nothing". A method that invites an in-sample back-test is a method that
        will get one, so the honest out-of-sample function keeps the name.
        """
        from modules.quant_risk import HistoricalVaR, var_backtest

        assert not hasattr(HistoricalVaR, "backtest")
        assert callable(var_backtest)

    def test_the_shared_helpers_belong_to_no_type(self):
        """``_mean``, ``_stdev``, ``returns_from_closes``, ``derived_block_length``,
        ``beta`` and ``_chi2_sf_1df`` are arithmetic over plain sequences. Each
        has more than one caller across the package and none of them is about a
        result object, so a receiver would be an invention.
        """
        from modules.quant_risk import beta, derived_block_length, returns_from_closes

        assert returns_from_closes([100.0, 101.0]) == [pytest.approx(0.01)]
        assert derived_block_length(100) == 10
        assert beta("AAA", "BBB", RETURNS) is None  # under 20 observations
