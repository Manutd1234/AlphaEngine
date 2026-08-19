"""Persisting a run: written whole, or visibly not written at all.

The failure worth engineering against is a run that claims a verdict it has no
evidence for. So the order of writes is the thing under test, along with the
two translations that would otherwise be silently wrong: a fold's row index is
not a bar number, and a bar number is not a date.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from modules.ml.features import FeatureBuilder, FeatureSpec, LabelSpec
from modules.ml.models import Ridge
from modules.ml.runner import MLWalkForward
from modules.ml.store import MLRunStore, PersistResult, _origin, _stamp


class _FakeClient:
    """Records every PostgREST call in order."""

    def __init__(self, fail_on: str | None = None):
        self.calls: list[tuple[str, str, object]] = []
        self.fail_on = fail_on

    async def post(self, path, json):
        table = path.rsplit("/", 1)[-1]
        self.calls.append(("POST", table, json))
        if self.fail_on == table:
            raise RuntimeError(f"{table} exploded")
        return _Response([{"id": "run-0001"}] if table == "ml_runs" else [{}])

    async def patch(self, path, json):
        self.calls.append(("PATCH", path, json))
        return _Response([{}])

    async def aclose(self):
        pass


class _Response:
    def __init__(self, payload, status_code=201):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


def _built():
    rng = np.random.default_rng(5)
    n = 900
    close = 100 * np.exp(np.cumsum(rng.normal(scale=0.01, size=n)))
    bars = dict(open_=close, high=close * 1.004, low=close * 0.996, close=close,
                volume=np.abs(rng.normal(1000, 200, n)))
    builder = FeatureBuilder(
        [FeatureSpec("return", 5), FeatureSpec("momentum", 20)],
        LabelSpec(horizon=4, kind="return"),
    )
    data = builder.build(**bars)
    result = MLWalkForward(Ridge(alpha=1.0)).run(data, builder.splitter(4))
    return builder, data, result


async def _persist(store, data, result, **over):
    kwargs = dict(
        model="ridge", symbol="BTCUSDT", interval="4h", data_hash="9f9602c7",
        params={"alpha": 1.0}, seed=42, features=data, result=result,
        label="return", label_horizon_bars=4,
    )
    kwargs.update(over)
    return await store.persist(**kwargs)


@pytest.mark.asyncio
async def test_a_run_is_promoted_to_succeeded_only_after_its_evidence_is_filed():
    _, data, result = _built()
    client = _FakeClient()
    store = MLRunStore()
    store.enabled = True
    store._client = client

    outcome = await _persist(store, data, result)
    assert outcome.persisted and outcome.run_id == "run-0001"

    order = [c[1] for c in client.calls]
    assert order[0] == "ml_runs", "the run row goes first"
    assert order.index("ml_folds") < len(order) - 1, "folds before the promotion"
    assert client.calls[0][2][0]["status"] == "running", (
        "a run must not claim a verdict before its folds exist"
    )
    assert client.calls[-1][0] == "PATCH"
    assert client.calls[-1][2]["status"] == "succeeded"


@pytest.mark.asyncio
async def test_a_crash_midway_leaves_the_run_marked_failed_with_its_reason():
    _, data, result = _built()
    client = _FakeClient(fail_on="ml_folds")
    store = MLRunStore()
    store.enabled = True
    store._client = client

    outcome = await _persist(store, data, result)
    assert not outcome.persisted
    assert "RuntimeError" in outcome.reason
    failed = [c for c in client.calls if c[0] == "PATCH"]
    assert failed and failed[-1][2]["status"] == "failed"
    # The schema refuses a failed row with no error, so this is not optional.
    assert failed[-1][2]["error"]


@pytest.mark.asyncio
async def test_an_unconfigured_deployment_reports_it_rather_than_raising():
    # A research tool that refuses to compute because it cannot file the answer
    # is worse than one that computes and says it could not file it.
    store = MLRunStore()
    store.enabled = False
    _, data, result = _built()
    outcome = await _persist(store, data, result)
    assert isinstance(outcome, PersistResult)
    assert not outcome.persisted
    assert "not configured" in outcome.reason


@pytest.mark.asyncio
async def test_the_coefficients_are_stored_with_a_digest_over_themselves():
    _, data, result = _built()
    client = _FakeClient()
    store = MLRunStore()
    store.enabled = True
    store._client = client
    await _persist(store, data, result)

    artefact = next(c[2][0] for c in client.calls if c[1] == "ml_artefacts")
    assert artefact["kind"] == "coefficients"
    assert artefact["payload"]["feature_names"] == list(data.names)
    assert len(artefact["sha256"]) == 64
    assert artefact["storage_path"] is None if "storage_path" in artefact else True


def test_a_fold_row_index_is_translated_back_to_its_original_bar():
    # Folds index the BUILT matrix, whose warm-up rows were dropped. Writing
    # those indices as bar numbers would put every fold earlier than it really
    # was, by exactly the longest feature lookback, silently.
    _, data, _ = _built()
    assert data.row_index[0] >= 20, "the momentum-20 warm-up must have been dropped"
    assert _origin(data, 0) == int(data.row_index[0])
    assert _origin(data, 5) == int(data.row_index[5])
    # Out of range clamps rather than raising: a fold end is exclusive.
    assert _origin(data, 10**9) == int(data.row_index[-1])


def test_real_bar_times_are_used_when_the_caller_supplies_them():
    start = datetime(2026, 1, 1, tzinfo=UTC)
    times = [start + timedelta(hours=4 * i) for i in range(10)]
    assert _stamp(3, times) == times[3].isoformat()


def test_without_bar_times_the_stamp_is_conspicuous_rather_than_plausible():
    # 1970 is obviously not a trading date to anyone who reads it. A plausible
    # fabricated date could be mistaken for evidence; this cannot.
    stamped = _stamp(7, None)
    assert stamped.startswith("1970-01-01")
    # …and it still orders, which is what the schema's constraints check.
    assert _stamp(3, None) < _stamp(9, None)


@pytest.mark.asyncio
async def test_the_fold_rows_carry_the_purge_and_the_embargo():
    _, data, result = _built()
    client = _FakeClient()
    store = MLRunStore()
    store.enabled = True
    store._client = client
    await _persist(store, data, result)

    folds = next(c[2] for c in client.calls if c[1] == "ml_folds")
    assert folds, "a run with folds must write them"
    for row in folds:
        assert row["purge_bars"] == 3, "label horizon 4 purges 3"
        assert row["embargo_bars"] == 0, "expanding contiguous walk-forward embargoes nothing"
        assert row["test_start"] >= row["train_end"], "a fold must not train on the future"
