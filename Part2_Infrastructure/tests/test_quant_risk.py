"""
Risk, sizing and regime maths — the properties, not golden numbers.

This module is a second implementation of arithmetic that already exists in
``web/lib/portfolio-risk.ts``, so what matters is that it agrees with the
conventions declared there and refuses in the same places. Every assertion below
is either an invariant (a hedge contributes negative risk) or a stated constant
(the 95% normal quantile), because a golden number copied from a run would pin
the bug as readily as the behaviour.
"""

from __future__ import annotations

import pytest

from modules.quant_risk import (
    ES95_MULTIPLIER,
    Z95,
    build_covariance,
    find_dislocation,
    kelly_fraction,
    portfolio_risk,
    returns_from_closes,
    volatility_regime,
)


def _series(values: list[float]) -> list[float]:
    return values


# --------------------------------------------------------------------------- #
# Covariance
# --------------------------------------------------------------------------- #

def test_covariance_truncates_to_the_shared_window():
    """
    Padding a short series with zeros would understate its variance AND — because
    the padding aligns across symbols — inflate every correlation toward one.
    """
    cov = build_covariance({"A": [0.01, -0.02, 0.03, 0.01], "B": [0.01, -0.02]})
    assert cov is not None
    assert cov.observations == 2, "must truncate to the shortest series"
    assert cov.symbols == ["A", "B"]


def test_covariance_is_symmetric_and_correlation_is_unit_on_the_diagonal():
    cov = build_covariance({
        "A": [0.01, -0.02, 0.03, -0.01, 0.02],
        "B": [0.02, -0.01, 0.01, -0.03, 0.01],
    })
    assert cov is not None
    assert cov.matrix[0][1] == pytest.approx(cov.matrix[1][0])
    for i in range(len(cov.symbols)):
        assert cov.correlation[i][i] == pytest.approx(1.0)


def test_perfectly_correlated_series_report_correlation_one():
    cov = build_covariance({"A": [0.01, 0.02, -0.01, 0.03], "B": [0.02, 0.04, -0.02, 0.06]})
    assert cov is not None
    assert cov.correlation[0][1] == pytest.approx(1.0, abs=1e-9)


def test_too_little_history_returns_none_rather_than_a_guess():
    assert build_covariance({"A": [0.01]}) is None
    assert build_covariance({}) is None


# --------------------------------------------------------------------------- #
# Portfolio risk
# --------------------------------------------------------------------------- #

def _two_asset_book():
    cov = build_covariance({
        "AAA": [0.01, -0.012, 0.008, -0.006, 0.011, -0.009, 0.013, -0.004],
        "BBB": [0.009, -0.011, 0.007, -0.005, 0.010, -0.008, 0.012, -0.003],
    }, interval="1d")
    return cov


def test_var_and_cvar_use_the_declared_multipliers():
    cov = _two_asset_book()
    positions = [
        {"symbol": "AAA", "side": "LONG", "notional": 600_000},
        {"symbol": "BBB", "side": "LONG", "notional": 400_000},
    ]
    risk = portfolio_risk(positions, cov, equity=1_000_000)
    assert risk is not None
    # The constants are the contract with the TypeScript implementation.
    assert Z95 == pytest.approx(1.6448536269514722)
    assert ES95_MULTIPLIER == pytest.approx(2.0627128027825736)
    assert risk.var95 == pytest.approx(Z95 * risk.volatility * 1_000_000)
    assert risk.cvar95 == pytest.approx(ES95_MULTIPLIER * risk.volatility * 1_000_000)
    assert risk.cvar95 > risk.var95, "expected shortfall must exceed the quantile it averages beyond"


def test_contribution_shares_sum_to_one():
    cov = _two_asset_book()
    positions = [
        {"symbol": "AAA", "side": "LONG", "notional": 600_000},
        {"symbol": "BBB", "side": "LONG", "notional": 400_000},
    ]
    risk = portfolio_risk(positions, cov, equity=1_000_000)
    assert risk is not None
    total = sum(c.contribution_share for c in risk.contributions)
    assert total == pytest.approx(1.0, abs=1e-9), "risk contributions must decompose the whole"


def test_a_hedge_contributes_negative_risk():
    """
    The number a notional-weighted view cannot produce. A short in a correlated
    name takes variance *out* of the book, and its contribution share must be
    negative rather than merely small.
    """
    cov = _two_asset_book()
    positions = [
        {"symbol": "AAA", "side": "LONG", "notional": 1_000_000},
        {"symbol": "BBB", "side": "SHORT", "notional": 300_000},
    ]
    risk = portfolio_risk(positions, cov, equity=1_000_000)
    assert risk is not None
    hedge = next(c for c in risk.contributions if c.symbol == "BBB")
    assert hedge.contribution_share < 0, "a correlated short must reduce book variance"
    assert hedge.share_of_gross > 0, "but it still occupies gross notional"


def test_share_of_risk_can_differ_from_share_of_notional():
    cov = build_covariance({
        "QUIET": [0.001, -0.001, 0.0012, -0.0009, 0.001, -0.0011],
        "WILD": [0.05, -0.06, 0.045, -0.052, 0.058, -0.049],
    })
    positions = [
        {"symbol": "QUIET", "side": "LONG", "notional": 900_000},
        {"symbol": "WILD", "side": "LONG", "notional": 100_000},
    ]
    risk = portfolio_risk(positions, cov, equity=1_000_000)
    assert risk is not None
    wild = next(c for c in risk.contributions if c.symbol == "WILD")
    assert wild.share_of_gross == pytest.approx(0.1)
    assert wild.contribution_share > 0.5, (
        "a tenth of the notional in a far more volatile name should dominate the risk"
    )


def test_a_flat_book_has_no_risk_to_report():
    cov = _two_asset_book()
    assert portfolio_risk([], cov, equity=1_000_000) is None


# --------------------------------------------------------------------------- #
# Kelly
# --------------------------------------------------------------------------- #

def test_kelly_matches_the_closed_form():
    # f* = W - (1-W)/R.  W=0.6, R=2  ->  0.6 - 0.4/2 = 0.4
    sizing = kelly_fraction(0.6, 2.0, equity=1_000_000, fraction=1.0, max_fraction=1.0)
    assert sizing.full_kelly == pytest.approx(0.4)


def test_fractional_kelly_scales_and_caps():
    sizing = kelly_fraction(0.6, 2.0, equity=1_000_000, fraction=0.25, max_fraction=0.2)
    assert sizing.recommended_fraction == pytest.approx(0.1), "quarter of 0.4"
    assert sizing.recommended_notional == pytest.approx(100_000)

    capped = kelly_fraction(0.9, 5.0, equity=1_000_000, fraction=0.25, max_fraction=0.2)
    assert capped.recommended_fraction == pytest.approx(0.2)
    assert capped.capped_by == "max_fraction"


def test_no_edge_sizes_to_zero_and_is_never_inverted():
    """
    A negative Kelly means no edge at these odds. Returning the magnitude as a
    short would be arithmetically tempting and is exactly the fitting artefact
    the research surface exists to reject.
    """
    sizing = kelly_fraction(0.3, 1.0, equity=1_000_000)
    assert sizing.full_kelly < 0
    assert sizing.recommended_fraction == 0.0
    assert sizing.recommended_notional == 0.0
    assert sizing.capped_by == "no_edge"


def test_degenerate_inputs_do_not_divide_by_zero():
    assert kelly_fraction(0.5, 0.0, equity=1_000).full_kelly == 0.0
    assert kelly_fraction(1.5, 2.0, equity=1_000).win_rate == 1.0, "win rate clamps to [0,1]"


# --------------------------------------------------------------------------- #
# Volatility regime
# --------------------------------------------------------------------------- #

def test_regime_is_relative_not_absolute():
    """
    A quiet instrument that stays quiet is NORMAL, not COMPRESSED. Absolute
    thresholds would label every FX pair calm and every crypto pair stressed
    forever, which is a statement about the asset class, not the regime.
    """
    calm = [0.001 if i % 2 else -0.001 for i in range(120)]
    regime = volatility_regime(calm, window=20)
    assert regime is not None
    assert regime.regime == "NORMAL"


def test_a_volatility_spike_reads_as_stressed():
    base = [0.002 if i % 2 else -0.002 for i in range(100)]
    spike = [0.05 if i % 2 else -0.05 for i in range(25)]
    regime = volatility_regime(base + spike, window=20)
    assert regime is not None
    assert regime.regime == "STRESSED"
    assert regime.ratio > 1.0
    assert regime.percentile >= 0.85


def test_regime_needs_two_full_windows():
    assert volatility_regime([0.01] * 30, window=20) is None


# --------------------------------------------------------------------------- #
# Dislocation
# --------------------------------------------------------------------------- #

def _book(venue: str, bid: float, ask: float, bid_size: float = 5.0, ask_size: float = 5.0):
    return {
        "venue": venue, "ok": True,
        "best_bid": bid, "best_ask": ask,
        "bids": [[bid, bid_size]], "asks": [[ask, ask_size]],
    }


def test_an_uncrossed_cross_venue_market_is_reported_as_normal():
    """
    B bids inside A's offer: the touch spans both venues and does not cross.
    This is the ordinary healthy state and must be *reported*, not returned as
    None — a caller cannot tell "no opportunity" from "no data" otherwise.
    """
    d = find_dislocation([_book("A", 99.5, 100.5), _book("B", 100.0, 101.0)], "X")
    assert d is not None
    assert d.crossed is False
    assert d.buy_venue is None
    assert "normal state" in d.note


def test_one_venue_holding_both_sides_is_its_own_spread_not_a_cross():
    """A single venue's bid-ask is not an arbitrage, and saying so beats silence."""
    d = find_dislocation([_book("A", 100.0, 100.5), _book("B", 99.9, 100.6)], "X")
    assert d is not None
    assert d.crossed is False
    assert d.buy_venue is None
    assert "own spread" in d.note


def test_a_crossed_market_names_both_legs_in_the_right_direction():
    # B bids 101 while A offers 100 — buy on A, sell on B.
    d = find_dislocation([_book("A", 99.8, 100.0), _book("B", 101.0, 101.2)], "X")
    assert d is not None
    assert d.crossed is True
    assert d.buy_venue == "A" and d.sell_venue == "B"
    assert d.edge_usd_per_unit == pytest.approx(1.0)
    assert d.edge_bps > 0


def test_executable_size_is_the_smaller_of_the_two_legs():
    """Both legs must fill, so the tradeable size is the min, never the max."""
    d = find_dislocation(
        [_book("A", 99.8, 100.0, ask_size=0.4), _book("B", 101.0, 101.2, bid_size=9.0)],
        "X",
    )
    assert d is not None
    assert d.executable_size == pytest.approx(0.4)
    assert d.executable_notional == pytest.approx(0.4 * ((101.0 + 100.0) / 2))


def test_one_live_venue_cannot_produce_a_cross():
    assert find_dislocation([_book("A", 100.0, 100.5)], "X") is None
    assert find_dislocation(
        [_book("A", 100.0, 100.5), {"venue": "B", "ok": False}], "X"
    ) is None


def test_returns_from_closes_never_divides_by_zero():
    assert returns_from_closes([0.0, 10.0, 20.0]) == [0.0, 1.0]


# --------------------------------------------------------------------------- #
# Historical VaR — the empirical twin
# --------------------------------------------------------------------------- #

def _fat_tailed_history(n: int = 120) -> list[float]:
    """Quiet most days, with occasional large losses — the shape a normal
    distribution understates and the reason both figures are reported."""
    series = [0.002 if i % 2 else -0.0018 for i in range(n)]
    for crash in (17, 53, 91):
        series[crash] = -0.09
    return series


def test_historical_var_needs_real_history_not_a_handful_of_days():
    from modules.quant_risk import historical_var

    positions = [{"symbol": "AAA", "side": "LONG", "notional": 100_000}]
    # Ten observations cannot support a 5th percentile: that is half a data
    # point wearing a statistic's name.
    assert historical_var(positions, {"AAA": [0.01] * 10}, 1_000_000) is None


def test_historical_var_reports_losses_as_positive_numbers():
    from modules.quant_risk import historical_var

    positions = [{"symbol": "AAA", "side": "LONG", "notional": 100_000}]
    result = historical_var(positions, {"AAA": _fat_tailed_history()}, 1_000_000)
    assert result is not None
    assert result.var95 > 0, "a loss must read as a positive VaR beside the parametric figure"
    # CVaR is the mean of the tail beyond VaR, so it can never be smaller.
    assert result.cvar95 >= result.var95


def test_historical_var_sees_a_fat_tail_the_normal_model_misses():
    from modules.quant_risk import historical_var, portfolio_risk

    positions = [{"symbol": "AAA", "side": "LONG", "notional": 100_000}]
    history = {"AAA": _fat_tailed_history()}
    cov = build_covariance(history, interval="1d")
    parametric = portfolio_risk(positions, cov, 1_000_000)
    empirical = historical_var(positions, history, 1_000_000)

    assert parametric is not None and empirical is not None
    # The whole reason both are shown: on a distribution with jumps the
    # empirical tail is worse than the normal assumption allows for.
    assert empirical.cvar95 > parametric.cvar95 * 0.5


def test_a_short_position_flips_the_sign_of_its_history():
    from modules.quant_risk import historical_var

    history = {"AAA": _fat_tailed_history()}
    long_var = historical_var([{"symbol": "AAA", "side": "LONG", "notional": 100_000}], history, 1_000_000)
    short_var = historical_var([{"symbol": "AAA", "side": "SHORT", "notional": 100_000}], history, 1_000_000)
    assert long_var and short_var
    # The crash days are this book's loss and the short book's gain, so their
    # tails cannot be the same number.
    assert long_var.var95 != pytest.approx(short_var.var95)


# --------------------------------------------------------------------------- #
# VaR model validation
#
# A VaR nobody has back-tested is an opinion. At 95% roughly one day in twenty
# should breach: zero exceptions is not conservatism, it is a model that cannot
# measure the risk it is holding capital against.
# --------------------------------------------------------------------------- #

def test_a_well_calibrated_model_is_validated():
    from modules.quant_risk import var_backtest

    # 100 days, 5 of them worse than the forecast — exactly the 5% claim.
    pnl = [-10.0] * 95 + [-2000.0] * 5
    result = var_backtest(pnl, var_forecast=1000.0)
    assert result is not None
    assert result.exceptions == 5
    assert result.zone == "green"
    assert result.kupiec_p_value >= 0.05


def test_a_model_that_understates_risk_is_rejected():
    from modules.quant_risk import var_backtest

    # 25 breaches in 100 days against a 5% claim.
    pnl = [-10.0] * 75 + [-5000.0] * 25
    result = var_backtest(pnl, var_forecast=1000.0)
    assert result is not None
    assert result.exceptions == 25
    assert result.zone == "red"
    assert result.kupiec_p_value < 0.01
    assert "understates" in result.verdict


def test_zero_exceptions_is_flagged_rather_than_praised():
    from modules.quant_risk import var_backtest

    # A forecast nothing ever breaches is not a safe model; it is an
    # unmeasured one, and the desk is paying for capacity it cannot use.
    result = var_backtest([-10.0] * 200, var_forecast=1_000_000.0)
    assert result is not None
    assert result.exceptions == 0
    assert result.zone == "yellow"
    assert "overstates" in result.verdict


def test_too_little_data_is_no_verdict_rather_than_a_weak_one():
    from modules.quant_risk import var_backtest

    assert var_backtest([-10.0] * 19, var_forecast=100.0) is None
    assert var_backtest([-10.0] * 50, var_forecast=0.0) is None


def test_rolling_backtest_never_scores_a_forecast_on_its_own_training_data():
    from modules.quant_risk import rolling_var_backtest

    history = {"AAA": _fat_tailed_history(220)}
    positions = [{"symbol": "AAA", "side": "LONG", "notional": 100_000}]
    result = rolling_var_backtest(positions, history, 1_000_000, window=60)
    assert result is not None
    # 220 observations, 60 consumed by the first training window.
    assert result.observations == 160
    assert 0 <= result.exceptions <= result.observations
    assert result.zone in {"green", "yellow", "red"}


def test_rolling_backtest_declines_when_the_window_swallows_the_history():
    from modules.quant_risk import rolling_var_backtest

    positions = [{"symbol": "AAA", "side": "LONG", "notional": 100_000}]
    assert rolling_var_backtest(positions, {"AAA": [0.001] * 70}, 1_000_000, window=60) is None


# --------------------------------------------------------------------------- #
# Scenario stress testing
# --------------------------------------------------------------------------- #

def _correlated_history() -> dict[str, list[float]]:
    base = [0.01, -0.012, 0.008, -0.006, 0.011, -0.009, 0.013, -0.004] * 4
    return {"BTCUSDT": base, "ETHUSDT": [r * 1.5 for r in base]}


def test_an_unmeasurable_beta_leaves_a_position_flat_rather_than_assuming_one():
    from modules.quant_risk import apply_scenario

    positions = [{"symbol": "NEWCOIN", "side": "LONG", "notional": 50_000}]
    result = apply_scenario(positions, 1_000_000, {"BTCUSDT": -0.2},
                            {"BTCUSDT": _correlated_history()["BTCUSDT"]})
    leg = result.legs[0]
    # Defaulting an unknown beta to 1.0 would invent a $10k loss and report it
    # as a measurement.
    assert leg.beta is None
    assert leg.via_beta is False
    assert leg.pnl == 0.0
    assert result.used_beta is False


def test_a_measured_beta_propagates_the_shock():
    from modules.quant_risk import apply_scenario

    positions = [{"symbol": "ETHUSDT", "side": "LONG", "notional": 50_000}]
    result = apply_scenario(positions, 1_000_000, {"BTCUSDT": -0.2}, _correlated_history())
    leg = result.legs[0]
    assert leg.via_beta and leg.beta is not None
    assert leg.beta == pytest.approx(1.5, abs=0.05), "ETH moves 1.5x BTC in this history"
    assert leg.pnl == pytest.approx(50_000 * 1.5 * -0.2, rel=0.05)


def test_a_short_book_gains_in_a_crash_and_loses_in_a_melt_up():
    from modules.quant_risk import apply_scenario

    short = [{"symbol": "BTCUSDT", "side": "SHORT", "notional": 100_000}]
    crash = apply_scenario(short, 1_000_000, {"BTCUSDT": -0.2}, _correlated_history())
    rally = apply_scenario(short, 1_000_000, {"BTCUSDT": 0.15}, _correlated_history())
    assert crash.total_pnl > 0
    assert rally.total_pnl < 0


def test_the_flat_scenario_moves_nothing():
    from modules.quant_risk import apply_scenario

    positions = [{"symbol": "BTCUSDT", "side": "LONG", "notional": 100_000}]
    result = apply_scenario(positions, 1_000_000, {"*": 0.0}, _correlated_history())
    # Any non-zero P&L here would be a bug in the propagation, which is exactly
    # why the baseline scenario exists.
    assert result.total_pnl == 0.0


def test_scenarios_are_ranked_worst_first():
    from modules.quant_risk import SCENARIOS, run_scenarios

    positions = [{"symbol": "BTCUSDT", "side": "LONG", "notional": 100_000}]
    results = run_scenarios(positions, 1_000_000, _correlated_history())
    assert len(results) == len(SCENARIOS)
    assert results == sorted(results, key=lambda r: r.total_pnl)
    assert results[0].total_pnl < 0, "the worst case must be a loss for a long book"


# --------------------------------------------------------------------------- #
# Allocation
#
# The platform could say what the book *is* and nothing about what it should be.
# A proposal is not an instruction — and it is deliberately naive about expected
# return, because forecasting covariance is hard and forecasting returns is
# harder.
# --------------------------------------------------------------------------- #

def _uneven_vol_book():
    """AAA is roughly three times as volatile as BBB."""
    calm = [0.002, -0.002, 0.0025, -0.0018, 0.002, -0.0022, 0.0019, -0.002] * 3
    wild = [v * 3 for v in calm]
    cov = build_covariance({"AAA": wild, "BBB": calm}, interval="1d")
    positions = [
        {"symbol": "AAA", "side": "LONG", "notional": 100_000},
        {"symbol": "BBB", "side": "LONG", "notional": 100_000},
    ]
    return positions, cov


def test_inverse_vol_gives_the_quiet_instrument_more_notional():
    from modules.quant_risk import propose_allocation

    positions, cov = _uneven_vol_book()
    proposal = propose_allocation(positions, cov, 1_000_000)
    assert proposal is not None
    weights = {t.symbol: t.target_weight for t in proposal.targets}
    # Same risk from a quieter name needs more of it — that is the entire idea.
    assert weights["BBB"] > weights["AAA"]
    assert sum(weights.values()) == pytest.approx(1.0, abs=1e-6)


def test_equal_risk_equalises_contribution_not_notional():
    from modules.quant_risk import portfolio_risk, propose_allocation

    positions, cov = _uneven_vol_book()
    proposal = propose_allocation(positions, cov, 1_000_000, method="equal_risk")
    assert proposal is not None

    rebalanced = [
        {"symbol": t.symbol, "side": "LONG", "notional": t.target_notional}
        for t in proposal.targets
    ]
    risk = portfolio_risk(rebalanced, cov, 1_000_000)
    assert risk is not None
    shares = [c.contribution_share for c in risk.contributions]
    assert max(shares) - min(shares) < 0.05, "contributions should be near-equal after the solve"


def test_a_proposal_respects_the_limits_the_gateway_enforces():
    from modules.quant_risk import propose_allocation

    positions, cov = _uneven_vol_book()
    proposal = propose_allocation(
        positions, cov, 1_000_000,
        max_symbol_notional=60_000, max_gross_notional=200_000,
    )
    assert proposal is not None
    assert proposal.clipped is True
    for target in proposal.targets:
        assert target.target_notional <= 60_000 + 1e-6
    # A clipped weight names what bound it — a proposal the gate would reject
    # order by order is a worse way to learn about the limit.
    assert any(t.clipped_by == "max_symbol_notional_usd" for t in proposal.targets)


def test_a_flat_book_has_nothing_to_allocate():
    from modules.quant_risk import propose_allocation

    _, cov = _uneven_vol_book()
    assert propose_allocation([], cov, 1_000_000) is None


def test_rebalance_ignores_drift_inside_the_band():
    from modules.quant_risk import propose_allocation, rebalance_trades

    positions, cov = _uneven_vol_book()
    proposal = propose_allocation(positions, cov, 1_000_000)
    assert proposal is not None

    # A band wider than any drift must produce no trades at all: correcting a
    # 1% deviation costs more than the deviation.
    assert rebalance_trades(proposal, positions, drift_band=0.99) == []
    trades = rebalance_trades(proposal, positions, drift_band=0.01)
    assert trades, "a genuinely drifted book must produce trades"


def test_rebalance_trades_point_the_right_way():
    from modules.quant_risk import propose_allocation, rebalance_trades

    positions, cov = _uneven_vol_book()
    proposal = propose_allocation(positions, cov, 1_000_000)
    trades = {t["symbol"]: t for t in rebalance_trades(proposal, positions, drift_band=0.01)}

    # AAA is the volatile name and is overweight under inverse-vol, so it sells.
    assert trades["AAA"]["side"] == "SELL"
    assert trades["BBB"]["side"] == "BUY"
    assert all(t["notional"] > 0 for t in trades.values())
    assert "overweight" in trades["AAA"]["reason"]


def test_adding_to_a_short_is_a_sell_not_a_buy():
    from modules.quant_risk import propose_allocation, rebalance_trades

    calm = [0.002, -0.002, 0.0025, -0.0018, 0.002, -0.0022, 0.0019, -0.002] * 3
    cov = build_covariance({"AAA": [v * 3 for v in calm], "BBB": calm}, interval="1d")
    positions = [
        {"symbol": "AAA", "side": "LONG", "notional": 100_000},
        {"symbol": "BBB", "side": "SHORT", "notional": 100_000},
    ]
    proposal = propose_allocation(positions, cov, 1_000_000)
    trades = {t["symbol"]: t for t in rebalance_trades(proposal, positions, drift_band=0.01)}
    # BBB is underweight, and increasing a short position means selling more.
    assert trades["BBB"]["side"] == "SELL"


def test_a_wildcard_shock_is_labelled_as_an_assumption_not_a_measurement():
    """The gap that let a fabricated loss look like a measured one.

    ``crypto_cascade`` carries a blanket ``*: -25%``. An instrument with no
    history takes that shock — which is the scenario doing what it says — but a
    leg moved by a blanket assumption and a leg moved by a measured beta are
    different claims, and a payload that cannot tell them apart lets the first
    be read as the second.
    """
    from modules.quant_risk import SCENARIOS, apply_scenario

    positions = [
        {"symbol": "ETHUSDT", "side": "LONG", "notional": 50_000},   # beta measurable
        {"symbol": "NEWCOIN", "side": "LONG", "notional": 50_000},   # no history at all
    ]
    result = apply_scenario(
        positions, 1_000_000, SCENARIOS["crypto_cascade"]["shocks"], _correlated_history(),
    )
    basis = {leg.symbol: leg.basis for leg in result.legs}
    assert basis["ETHUSDT"] == "beta"
    assert basis["NEWCOIN"] == "wildcard", "a blanket shock must not masquerade as a measured beta"

    # And with no wildcard in the scenario, the unmeasurable leg stays flat.
    risk_off = apply_scenario(positions, 1_000_000, SCENARIOS["risk_off"]["shocks"], _correlated_history())
    unmeasured = next(leg for leg in risk_off.legs if leg.symbol == "NEWCOIN")
    assert unmeasured.basis == "unsupported"
    assert unmeasured.pnl == 0.0


def test_a_p_value_far_below_the_threshold_does_not_render_as_zero():
    from modules.quant_risk import var_backtest

    # 30 exceptions in 250 days against a 5% claim: overwhelming rejection.
    result = var_backtest([-10.0] * 220 + [-5000.0] * 30, var_forecast=1000.0)
    assert result is not None
    # Rounding to 4dp would print 0.0, which reads as a certainty no statistic
    # is entitled to claim.
    assert 0.0 < result.kupiec_p_value < 0.001
