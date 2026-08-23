"""The admissibility gate, and why a null needs one.

A representation that does not encode the subject cannot report that the
subject says nothing. This gate makes that testable, and the numbers it was
built from are in the module docstring: on real FOMC statements, a whitened
twelve-dimensional latent over the WHOLE statement recovers the policy move at
out-of-fold R^2 = -0.60, while the same latent over the decision sentence alone
recovers it at +0.70. The first is inadmissible and every null measured through
it was uninformative.
"""

from __future__ import annotations

import numpy as np

from modules.coherence.diffusion import gate


def _latent_that_carries(fact: np.ndarray, *, noise: float, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    signal = (fact - fact.mean()) / (fact.std() or 1.0)
    return np.column_stack([signal + noise * rng.standard_normal(fact.size),
                            rng.standard_normal(fact.size),
                            rng.standard_normal(fact.size)])


class TestItAdmitsARepresentationThatCarriesTheFact:
    def test_a_latent_holding_the_fact_passes(self):
        fact = np.arange(60, dtype=float)
        result = gate.check(_latent_that_carries(fact, noise=0.2), fact)
        assert result.state == "passed" and result.admissible
        assert result.r_squared is not None and result.r_squared > 0.8

    def test_pure_noise_is_refused_with_the_number(self):
        rng = np.random.default_rng(1)
        fact = rng.standard_normal(60)
        result = gate.check(rng.standard_normal((60, 6)), fact)
        assert result.state == "failed" and not result.admissible
        assert "below the floor" in (result.reason or "")

    def test_the_refusal_says_what_a_null_through_it_would_be_worth(self):
        rng = np.random.default_rng(2)
        result = gate.check(rng.standard_normal((60, 4)), rng.standard_normal(60),
                            fact="the policy move")
        assert "would say nothing about the text" in (result.reason or "")
        assert "the policy move" in (result.reason or "")

    def test_a_marginal_latent_fails_a_floor_above_zero(self):
        fact = np.arange(80, dtype=float)
        weak = _latent_that_carries(fact, noise=6.0, seed=3)
        assert gate.check(weak, fact, floor=0.5).state == "failed"


class TestItIsMeasuredOutOfFold:
    def test_widening_the_latent_with_noise_does_not_buy_a_pass(self):
        """In-sample R-squared rises with every column added, which is the
        opposite of a gate. Out of fold it must not."""
        rng = np.random.default_rng(4)
        fact = rng.standard_normal(60)
        wide = rng.standard_normal((60, 25))
        assert gate.check(wide, fact).state == "failed"

    def test_too_few_rows_is_not_assessable_rather_than_failed(self):
        rng = np.random.default_rng(5)
        result = gate.check(rng.standard_normal((6, 3)), rng.standard_normal(6))
        assert result.state == "not_assessable"
        assert "too few" in (result.reason or "")

    def test_a_constant_fact_cannot_be_scored(self):
        rng = np.random.default_rng(6)
        result = gate.check(rng.standard_normal((40, 3)), np.ones(40))
        assert result.state == "not_assessable"


class TestMissingFactsAreDroppedNotImputed:
    def test_rows_with_an_unknown_fact_are_excluded(self):
        fact = np.arange(60, dtype=float)
        latent = _latent_that_carries(fact, noise=0.2)
        holed = fact.copy()
        holed[:10] = np.nan
        result = gate.check(latent, holed)
        assert result.samples == 50
        assert result.state == "passed"
