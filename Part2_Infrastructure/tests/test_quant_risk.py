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

import math

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
