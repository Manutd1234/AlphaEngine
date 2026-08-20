"""Probability of backtest overfitting on the ML path, and its refusals.

The column existed, the migration argued for it by name, the read model carried
it and the card had a line for it — and nothing on the fit path ever wrote it,
so every fitted run in the corpus said "not computed" and always would.

These pin the fix and, more importantly, pin the two things the fix must never
do. PBO is a fraction of folds: on one ranked fold it can only be 0.0 or 1.0,
and 0.0 means "no evidence of overfitting" — the most flattering reading
available, reachable from the least evidence. So the interesting assertions here
are not that a number appears. They are that a null stays null all the way into
the PATCH that promotes the run, and never becomes a zero on the way.
"""

from __future__ import annotations

import numpy as np
import pytest

from modules.backtester import overfitting_probability
from modules.ml.features import FeatureBuilder, FeatureSpec, LabelSpec
from modules.ml.fit import PBO_REASONS, run_ml_fit
from modules.ml.models import Ridge
from modules.ml.runner import MLWalkForward
from modules.ml.selection import (
    MIN_RANKED_FOLDS,
    PBO_ONE_CONFIGURATION,
    PBO_RANKED,
    PBO_TOO_FEW_FOLDS,
    FoldSelection,
    expand_grid,
    overfitting,
    rank_of,
)
from modules.ml.store import MLRunStore

ALPHAS = (0.01, 0.1, 1.0, 10.0, 100.0)


# --------------------------------------------------------------------------- #
# Fixtures: series whose answers are known, and no network anywhere.
# --------------------------------------------------------------------------- #
def _bars(close: np.ndarray) -> dict:
    n = close.shape[0]
    rng = np.random.default_rng(11)
    return dict(
        open_=close * (1 + rng.normal(scale=0.001, size=n)),
        high=close * 1.004, low=close * 0.996, close=close,
        volume=np.abs(rng.normal(1000, 200, n)),
    )


def _with_momentum(n: int = 1400, seed: int = 3) -> np.ndarray:
    """A series with real, exploitable autocorrelation — so a selection between
    candidates has something to be right or wrong about."""
    rng = np.random.default_rng(seed)
    steps = np.zeros(n)
    for i in range(1, n):
        steps[i] = 0.55 * steps[i - 1] + rng.normal(scale=0.006)
    return 100.0 * np.exp(np.cumsum(steps))


def _builder() -> FeatureBuilder:
    return FeatureBuilder(
        [FeatureSpec("return", 5), FeatureSpec("volatility", 10), FeatureSpec("momentum", 20)],
        LabelSpec(horizon=4, kind="return"),
    )


def _run(*, splits: int = 5, alphas: tuple[float, ...] | None = ALPHAS, cost_bps: float = 0.0):
    builder = _builder()
    data = builder.build(**_bars(_with_momentum()))
    candidates = None if alphas is None else [(f"alpha={a}", Ridge(alpha=a)) for a in alphas]
    return MLWalkForward(
        Ridge(alpha=1.0), candidates=candidates, interval="4h", cost_bps=cost_bps,
    ).run(data, builder.splitter(splits))


@pytest.fixture
def offline_bars(monkeypatch):
    """`run_ml_fit` reaches Binance first. These tests are about arithmetic."""
    import pandas as pd

    def _fetch(symbol: str, interval: str, count: int):
        close = _with_momentum(n=count)
        frame = pd.DataFrame(
            {k.rstrip("_"): v for k, v in _bars(close).items()},
            index=pd.date_range("2024-01-01", periods=count, freq="4h", tz="UTC"),
        )
        return frame, "fixture"

    monkeypatch.setattr("modules.ml.fit.fetch_ohlcv", _fetch)


# --------------------------------------------------------------------------- #
# The candidate set
# --------------------------------------------------------------------------- #
class TestTheCandidateSetAConfigurationWasChosenFrom:
    def test_a_scalar_parameter_is_a_run_that_chose_nothing(self):
        assert expand_grid({"alpha": 1.0}) == (("default", {"alpha": 1.0}),)
        assert expand_grid({}) == (("default", {}),)

    def test_a_list_becomes_one_candidate_per_value_and_keeps_the_fixed_ones(self):
        grid = expand_grid({"alpha": [0.1, 1.0], "max_iter": 40})
        assert [label for label, _ in grid] == ["alpha=0.1", "alpha=1.0"]
        assert [config for _, config in grid] == [
            {"max_iter": 40, "alpha": 0.1}, {"max_iter": 40, "alpha": 1.0},
        ]

    def test_the_order_is_the_same_on_every_interpreter(self):
        # A run is reproducible from its seed and its data hash, which means the
        # candidate order — and therefore every tie-break downstream — cannot
        # depend on dict iteration order.
        one = expand_grid({"beta": [1, 2], "alpha": [3, 4]})
        two = expand_grid({"alpha": [3, 4], "beta": [1, 2]})
        assert one == two
        assert [label for label, _ in one] == [
            "alpha=3 beta=1", "alpha=3 beta=2", "alpha=4 beta=1", "alpha=4 beta=2",
        ]

    def test_a_repeated_value_is_not_counted_twice(self):
        # A duplicate would inflate the denominator PBO is a fraction of, which
        # is a search that looks wider than it was.
        assert len(expand_grid({"alpha": [1.0, 1.0, 1.0]})) == 1

    def test_an_empty_list_is_refused_by_name_rather_than_silently_defaulted(self):
        with pytest.raises(ValueError, match="empty list"):
            expand_grid({"alpha": []})


# --------------------------------------------------------------------------- #
# The rank a fold produces, and the two ways it produces none
# --------------------------------------------------------------------------- #
class TestWhereTheInSampleWinnerLanded:
    def test_the_rank_counts_only_candidates_that_did_strictly_better(self):
        assert rank_of(0.5, [0.9, 0.7, 0.5, 0.1]) == 3
        assert rank_of(0.9, [0.9, 0.7, 0.5, 0.1]) == 1

    def test_one_candidate_has_nothing_to_be_ranked_against(self):
        assert rank_of(0.5, [0.5]) is None

    def test_a_fold_where_everything_tied_is_not_a_placement(self):
        # Competition ranking would call this "rank 1 of 5" — a selection that
        # held up perfectly, on a fold where nothing was selected at all. Rank 1
        # is exactly the half PBO scores as a success, so a tie must not enter.
        assert rank_of(0.4, [0.4, 0.4, 0.4, 0.4, 0.4]) is None


# --------------------------------------------------------------------------- #
# The refusals. These are the point of the module.
# --------------------------------------------------------------------------- #
def _selection(rank: int | None, ranked: int = 5) -> FoldSelection:
    return FoldSelection(
        fold_index=0, chosen="alpha=1.0", is_sharpe=1.0, oos_sharpe=0.1,
        oos_rank=rank, combos_ranked=ranked,
    )


class TestPboStaysNullRatherThanBecomingZero:
    def test_a_run_that_fitted_one_configuration_has_no_pbo_to_have(self):
        result = _run(alphas=None)
        assert result.usable_folds == 5, "the run itself must still have happened"
        assert result.pbo is None
        assert result.pbo_basis == PBO_ONE_CONFIGURATION
        assert "not applicable" in PBO_REASONS[result.pbo_basis]

    def test_a_run_with_too_few_ranked_folds_files_null_rather_than_zero(self):
        """THE case this module exists for, asserted end to end.

        Two folds cannot support a fraction: the answer can only be 0, a half
        or 1, and 0 — "no evidence of overfitting" — is the reading a reader
        would act on. So the run is refused a PBO, and the refusal has to
        survive all the way into the row, because a null that becomes a zero
        somewhere between the runner and PostgREST is the same defect with a
        longer fuse.
        """
        result = _run(splits=2)
        assert result.usable_folds == 2, "the fit still ran; only the PBO is withheld"
        assert result.pbo is None, "two folds is not a probability"
        assert result.pbo_basis == PBO_TOO_FEW_FOLDS
        assert result.pbo != 0.0 and result.pbo != 0

        patch = _completion_patch(result)
        assert "pbo" in patch, "the column is written, so it can be written as NULL"
        assert patch["pbo"] is None
        assert patch["pbo"] != 0.0, "0.0 is the most flattering reading of no evidence"
        # …and the rest of the run is filed exactly as it was before.
        assert patch["deflated_sharpe"] == result.deflated_sharpe
        assert patch["status"] == "succeeded"

    def test_the_floor_is_the_one_the_module_publishes(self):
        below = [_selection(1) for _ in range(MIN_RANKED_FOLDS - 1)]
        assert overfitting(below, candidates=5).value is None
        assert overfitting(below, candidates=5).basis == PBO_TOO_FEW_FOLDS

        at = [_selection(1) for _ in range(MIN_RANKED_FOLDS)]
        assert overfitting(at, candidates=5).value == 0.0, (
            "at the floor the figure is computed, and a computed zero is a real "
            "answer — the rule is about absent evidence, not about the value"
        )
        assert overfitting(at, candidates=5).basis == PBO_RANKED

    def test_folds_that_produced_no_rank_do_not_pad_the_denominator(self):
        # Two ranked folds and three unranked ones is still two ranked folds.
        mixed = [_selection(1), _selection(2), _selection(None), _selection(None), _selection(None)]
        assert overfitting(mixed, candidates=5).value is None

    def test_no_folds_at_all_is_a_null_and_not_a_perfect_score(self):
        assert overfitting([], candidates=5).value is None


# --------------------------------------------------------------------------- #
# The figure itself, when there is one
# --------------------------------------------------------------------------- #
class TestPboIsTheBacktestersOwnFigure:
    def test_the_swept_run_reports_what_overfitting_probability_returns(self):
        # Reused, not reimplemented. A research plane with two definitions of
        # "probability of backtest overfitting" has none, and the number a
        # reader compares an ML run against is the one beside a sweep.
        result = _run()
        ranked = [
            s for s in result.selections if s.oos_rank is not None and s.combos_ranked > 1
        ]
        assert len(ranked) >= MIN_RANKED_FOLDS
        assert result.pbo == overfitting_probability(ranked)
        assert result.pbo_basis == PBO_RANKED
        assert 0.0 <= result.pbo <= 1.0

    def test_a_computed_figure_is_offered_no_excuse(self):
        result = _run()
        assert PBO_REASONS.get(result.pbo_basis) is None, (
            "a PBO that exists needs no sentence explaining why it does not"
        )

    def test_every_fold_ranks_its_pick_against_the_whole_candidate_set(self):
        result = _run()
        assert result.candidates_tested == len(ALPHAS)
        assert len(result.selections) == result.usable_folds
        for selection in result.selections:
            assert selection.combos_ranked == len(ALPHAS)
            assert selection.chosen.startswith("alpha=")

    def test_the_fit_path_carries_the_figure_and_its_reason(self, offline_bars):
        swept, _ = run_ml_fit(bars=900, n_splits=5, cost_bps=0.0, params={"alpha": list(ALPHAS)})
        assert swept.result is not None and swept.result.candidates_tested == len(ALPHAS)

        single, payload = run_ml_fit(bars=900, n_splits=5, cost_bps=0.0)
        assert single.result is not None and single.result.pbo is None
        assert payload["params"]["candidates"] == 1


# --------------------------------------------------------------------------- #
# What the store does with it
# --------------------------------------------------------------------------- #
class _FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, object]] = []

    async def post(self, path, json):
        table = path.rsplit("/", 1)[-1]
        self.calls.append(("POST", table, json))
        return _Response([{"id": "run-0001"}] if table == "ml_runs" else [{}])

    async def patch(self, path, json):
        self.calls.append(("PATCH", path, json))
        return _Response([{}])


class _Response:
    def __init__(self, payload) -> None:
        self._payload = payload
        self.status_code = 201

    def json(self):
        return self._payload


def _completion_patch(result) -> dict:
    """The PATCH that promotes a run to 'succeeded', as PostgREST would see it."""
    import asyncio

    builder = _builder()
    data = builder.build(**_bars(_with_momentum()))
    client = _FakeClient()
    store = MLRunStore()
    store.enabled = True
    store._client = client

    outcome = asyncio.run(store.persist(
        model="ridge", symbol="BTCUSDT", interval="4h", data_hash="9f9602c7",
        params={"alpha": list(ALPHAS)}, seed=42, features=data, result=result,
        label="return", label_horizon_bars=4,
    ))
    assert outcome.persisted
    return client.calls[-1][2]


class TestTheStoreFilesTheFigureItWasGiven:
    def test_pbo_is_written_beside_the_deflated_sharpe(self):
        # It was the one headline metric the promotion patch never carried, so
        # the column stayed NULL for every run whether or not one existed.
        result = _run()
        patch = _completion_patch(result)
        assert patch["pbo"] == result.pbo
        assert patch["pbo"] is not None, "this run ranked its selections"


# --------------------------------------------------------------------------- #
# MinTRL — the second half of the plan item
# --------------------------------------------------------------------------- #
class TestMinimumTrackRecordLength:
    def test_a_positive_sharpe_reports_the_bars_it_would_need(self):
        result = _run(alphas=None)
        assert result.oos_sharpe > 0, "the planted signal must be found for this to mean anything"
        assert result.min_track_record_bars is not None
        assert result.min_track_record_bars > 1.0

    def test_a_sharpe_that_is_not_positive_reports_none_rather_than_a_number(self):
        # min_track_record_length returns infinity — no finite record proves an
        # edge that is not there — and infinity is not a length, so it is not
        # reported as one. Zero would be the catastrophic reading: "no bars
        # needed".
        builder = _builder()
        rng = np.random.default_rng(7)
        walk = 100.0 * np.exp(np.cumsum(rng.normal(scale=0.01, size=1200)))
        data = builder.build(**_bars(walk))
        result = MLWalkForward(Ridge(alpha=1.0), interval="4h", cost_bps=50.0).run(
            data, builder.splitter(5),
        )
        assert result.oos_sharpe < 0
        assert result.min_track_record_bars is None
