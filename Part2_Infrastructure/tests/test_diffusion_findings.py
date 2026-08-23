"""The findings collector must be able to say "nothing here" and mean it.

A results surface is only worth reading if it can report an absence. The risk
is not that it misses a real effect — it is that it manufactures one, or that
it reports `absent` for a relationship it never actually had the data to test.
So both directions are asserted: a planted relationship is found, and pure
noise is not.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from modules.coherence.diffusion.findings import MIN_EVENTS, _slope, _verdict


def test_slope_finds_a_planted_relationship() -> None:
    rng = np.random.default_rng(11)
    x = list(rng.normal(size=40))
    y = [2.0 * value + float(noise) for value, noise in zip(x, rng.normal(scale=0.5, size=40), strict=True)]
    measured = _slope(x, y)
    assert measured["n"] == 40
    assert measured["t"] is not None and measured["t"] > 5
    assert measured["r"] is not None and measured["r"] > 0.9
    assert measured["p"] is not None and measured["p"] < 0.01
    assert _verdict(measured) == "holds"


def test_slope_reports_noise_as_absent() -> None:
    rng = np.random.default_rng(12)
    measured = _slope(list(rng.normal(size=60)), list(rng.normal(size=60)))
    assert measured["t"] is not None and abs(measured["t"]) < 2
    assert measured["p"] is not None and measured["p"] > 0.05
    assert _verdict(measured) == "absent"


def test_too_few_events_is_not_a_null() -> None:
    """Below the floor the answer is "not assessable", never "absent"."""
    short = MIN_EVENTS - 1
    measured = _slope([float(i) for i in range(short)], [float(i) for i in range(short)])
    assert measured["n"] == short
    assert measured["t"] is None
    assert _verdict(measured) == "not_assessable"


def test_a_constant_covariate_cannot_be_regressed_on() -> None:
    """Every meeting holding rates would give a zero-variance x, not a slope."""
    measured = _slope([1.0] * 30, list(np.random.default_rng(3).normal(size=30)))
    assert measured["t"] is None
    assert _verdict(measured) == "not_assessable"


@pytest.mark.parametrize("t_value,expected", [(2.0, "holds"), (1.99, "absent"), (-3.5, "holds")])
def test_the_threshold_is_two_sided(t_value: float, expected: str) -> None:
    assert _verdict({"t": t_value}) == expected


def test_the_shuffled_null_is_a_real_null() -> None:
    """On noise the shuffled pairing should beat the real one about as often."""
    rng = np.random.default_rng(21)
    fractions = [
        _slope(list(rng.normal(size=50)), list(rng.normal(size=50)), seed=seed)["p"]
        for seed in range(6)
    ]
    assert all(value is not None for value in fractions)
    assert 0.2 < float(np.mean([value for value in fractions if value is not None])) < 0.8
    assert not any(math.isnan(float(value or 0.0)) for value in fractions)
