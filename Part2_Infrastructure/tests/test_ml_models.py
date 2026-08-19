"""The two hand-rolled models, checked against arithmetic rather than each other.

A fitted model's coefficients ARE the research result, so these tests pin
recoverability (can it find a signal it was given?), the penalty's direction,
and the specific numerical traps that turn a fit into silent nonsense: constant
columns, perfect separation, and standardising on the wrong window.
"""

from __future__ import annotations

import numpy as np
import pytest

from modules.ml.models import LogisticRegression, Ridge


def _rng():
    return np.random.default_rng(20260820)


def test_ridge_recovers_a_linear_relationship_it_was_given():
    rng = _rng()
    x = rng.normal(size=(400, 3))
    truth = np.array([2.0, -1.0, 0.5])
    y = x @ truth + 7.0 + rng.normal(scale=0.01, size=400)

    model = Ridge(alpha=1e-6).fit(x, y)
    # Coefficients come back on the standardised scale; undo it to compare.
    recovered = model.coefficients / model.scale
    assert np.allclose(recovered, truth, atol=0.02)
    assert model.intercept == pytest.approx(float(y.mean()))


def test_a_larger_penalty_shrinks_coefficients_toward_zero():
    rng = _rng()
    x = rng.normal(size=(200, 4))
    y = x @ np.array([3.0, -2.0, 1.0, 0.0]) + rng.normal(scale=0.1, size=200)

    weak = np.abs(Ridge(alpha=0.01).fit(x, y).coefficients).sum()
    strong = np.abs(Ridge(alpha=500.0).fit(x, y).coefficients).sum()
    assert strong < weak, "the L2 penalty must shrink, not merely change, the fit"


def test_the_intercept_is_not_penalised():
    # A penalised intercept shrinks predictions toward zero rather than toward
    # the mean, which is not what an L2 penalty is for and shows up as a model
    # that is confidently wrong about the level.
    rng = _rng()
    x = rng.normal(size=(300, 2))
    y = x @ np.array([1.0, -1.0]) + 1000.0
    model = Ridge(alpha=1e6).fit(x, y)
    assert model.intercept == pytest.approx(1000.0, abs=1.0)


def test_a_constant_column_is_ignored_rather_than_producing_nan():
    # std == 0 means dividing by zero; unguarded it propagates inf through the
    # solve and comes out as a coefficient of nan, which then poisons every
    # metric downstream without raising anything.
    rng = _rng()
    x = np.column_stack([rng.normal(size=200), np.full(200, 4.2)])
    y = x[:, 0] * 2.0 + rng.normal(scale=0.01, size=200)

    model = Ridge(alpha=0.1).fit(x, y)
    assert np.all(np.isfinite(model.coefficients))
    assert model.coefficients[1] == pytest.approx(0.0, abs=1e-9)
    assert np.all(np.isfinite(Ridge.predict(model, x)))


def test_predict_standardises_with_the_training_window_statistics():
    # Recomputing the centre and scale on the test window would standardise
    # using the test window's own statistics — a leak that survives every purge
    # because it does not involve a single training row.
    rng = _rng()
    x = rng.normal(size=(200, 2))
    y = x[:, 0] + rng.normal(scale=0.01, size=200)
    model = Ridge(alpha=0.1).fit(x, y)

    shifted = x + 100.0
    direct = Ridge.predict(model, shifted)
    manual = ((shifted - model.center) / model.scale) @ model.coefficients + model.intercept
    assert np.allclose(direct, manual)
    # And the shift must move the prediction: a model that re-centred on the
    # new window would return the original values.
    assert not np.allclose(direct, Ridge.predict(model, x))


def test_logistic_separates_a_class_it_was_given():
    rng = _rng()
    x = rng.normal(size=(400, 2))
    y = (x @ np.array([2.0, -1.5]) + rng.normal(scale=0.2, size=400) > 0).astype(float)

    model = LogisticRegression(alpha=1e-3).fit(x, y)
    p = LogisticRegression.predict_proba(model, x)
    accuracy = float(((p > 0.5).astype(float) == y).mean())
    assert accuracy > 0.9, f"recovered only {accuracy:.2%} of a separable problem"
    assert np.all((p >= 0.0) & (p <= 1.0))


def test_perfect_separation_converges_instead_of_dividing_by_zero():
    # Separable data drives the IRLS weights p(1−p) to zero and the Hessian
    # singular. The floor keeps the solve defined so separation presents as a
    # large coefficient, which is true, rather than as LinAlgError.
    x = np.linspace(-3, 3, 60).reshape(-1, 1)
    y = (x.ravel() > 0).astype(float)
    model = LogisticRegression(alpha=1e-6).fit(x, y)
    assert np.all(np.isfinite(model.coefficients))
    p = LogisticRegression.predict_proba(model, x)
    assert p[0] < 0.05 and p[-1] > 0.95


def test_logistic_refuses_a_label_that_is_not_zero_or_one():
    x = np.zeros((10, 2))
    with pytest.raises(ValueError, match="0/1"):
        LogisticRegression().fit(x, np.full(10, -1.0))


@pytest.mark.parametrize("model", [Ridge(), LogisticRegression()])
def test_fitting_an_empty_window_is_refused_rather_than_returning_a_model(model):
    with pytest.raises(ValueError, match="empty training window"):
        model.fit(np.zeros((0, 3)), np.zeros(0))


@pytest.mark.parametrize("model", [Ridge(), LogisticRegression()])
def test_mismatched_rows_are_refused(model):
    with pytest.raises(ValueError, match="rows"):
        model.fit(np.zeros((10, 2)), np.zeros(9))


def test_predicting_with_the_wrong_feature_count_is_refused():
    rng = _rng()
    x = rng.normal(size=(50, 3))
    model = Ridge(alpha=1.0).fit(x, rng.normal(size=50))
    with pytest.raises(ValueError, match="features"):
        Ridge.predict(model, rng.normal(size=(10, 2)))


def test_a_fit_is_deterministic():
    # Same inputs, same coefficients, bit for bit. A research result that moves
    # between two runs of the same code is not a result.
    rng = _rng()
    x = rng.normal(size=(300, 4))
    y = x @ np.array([1.0, 0.0, -2.0, 0.5]) + rng.normal(scale=0.05, size=300)
    a = Ridge(alpha=0.5).fit(x, y)
    b = Ridge(alpha=0.5).fit(x, y)
    assert np.array_equal(a.coefficients, b.coefficients)
    assert a.intercept == b.intercept
