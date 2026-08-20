"""The wiring that was missing, asserted so it cannot go missing again.

Every piece of the ML subsystem was built and tested — splitter, features,
models, runner, store, read routes, panel — and `MLRunStore.persist` had
exactly one caller in the repository: `tests/test_ml_store.py`, which reached
it only by setting `store.enabled = True` and injecting a fake client by hand.
So the corpus could only ever be empty, the panel could only ever say so, and
the whole suite was green about it.

That is the shape these tests exist for. They assert that a PRODUCTION path
reaches the store, not that the store works when a test calls it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from modules.ml.fit import ML_FIT_KIND, run_ml_fit, run_ml_fit_job


@pytest.fixture(autouse=True)
def offline_bars(monkeypatch):
    """Deterministic bars, no network.

    `fetch_ohlcv` reaches Binance first. Letting these tests do that would make
    them depend on an exchange being up, take a timeout to fail in the
    network-free CI this project runs, and produce different numbers on every
    run — none of which is what is being tested here. What IS being tested is
    the wiring, so the bars are a fixture and the seed is fixed.
    """
    def _bars(symbol: str, interval: str, count: int):
        rng = np.random.default_rng(20260820)
        steps = rng.normal(0.0, 0.01, size=count)
        close = 30_000.0 * np.exp(np.cumsum(steps))
        frame = pd.DataFrame({
            "open": close * (1 + rng.normal(0, 0.001, count)),
            "high": close * (1 + np.abs(rng.normal(0, 0.003, count))),
            "low": close * (1 - np.abs(rng.normal(0, 0.003, count))),
            "close": close,
            "volume": np.abs(rng.normal(1_000, 120, count)),
        }, index=pd.date_range("2024-01-01", periods=count, freq="4h", tz="UTC"))
        return frame, "fixture"

    monkeypatch.setattr("modules.ml.fit.fetch_ohlcv", _bars)


class _RecordingStore:
    """Records what a production caller asks of the store."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self.calls: list[dict] = []
        self.stopped = False

    async def persist(self, **payload):
        self.calls.append(payload)

        class _Filed:
            persisted = True
            run_id = "run-live-0001"
            reason = None

        return _Filed()

    async def stop(self) -> None:
        self.stopped = True


def _install(monkeypatch, store):
    """Stand `store` in for BOTH the singleton and the job's private one.

    `run_ml_fit_job` reads `enabled` off the process-wide store — that is
    configuration, not I/O — and then builds its OWN `MLRunStore` to persist
    with. Those are two different objects on purpose: the singleton's httpx
    client is bound to the gateway's event loop, and the job runs on a worker
    thread under its own `asyncio.run`. Patching only the singleton, as these
    tests used to, leaves the persist going to a real disabled store.
    """
    monkeypatch.setattr("modules.ml.store.get_ml_store", lambda: store)
    monkeypatch.setattr("modules.ml.store.MLRunStore", lambda: store)


class TestAProductionPathReachesTheStore:
    def test_the_job_body_persists_what_it_fitted(self, monkeypatch):
        store = _RecordingStore()
        _install(monkeypatch, store)

        out = run_ml_fit_job({"symbol": "BTCUSDT", "interval": "4h", "bars": 400, "n_splits": 3})

        assert store.calls, "the fit job did not call persist — the corpus stays empty"
        assert out["persisted"] is True
        assert out["run_id"] == "run-live-0001"

    def test_the_persist_payload_carries_the_bar_times(self, monkeypatch):
        # Without these `ml_folds` stores 1970 epoch stamps, which is a fold
        # table that cannot be read back against the series it describes.
        store = _RecordingStore()
        _install(monkeypatch, store)
        run_ml_fit_job({"symbol": "BTCUSDT", "interval": "4h", "bars": 400, "n_splits": 3})

        payload = store.calls[0]
        assert payload["bar_times"], "no bar times were filed"
        assert len(payload["bar_times"]) == payload["features"].x.shape[0]
        assert all(t.tzinfo is not None for t in payload["bar_times"]), "naive timestamps"
        assert all(t.year > 2000 for t in payload["bar_times"]), "epoch stamps were filed"

    def test_the_client_is_closed_even_on_a_filed_run(self, monkeypatch):
        store = _RecordingStore()
        _install(monkeypatch, store)
        run_ml_fit_job({"symbol": "BTCUSDT", "interval": "4h", "bars": 400, "n_splits": 3})
        assert store.stopped, "the worker thread's client was left open"

    def test_the_job_never_touches_the_gateways_own_store(self, monkeypatch):
        """The bug the panel reported, and the worse one behind it.

        `run_ml_fit_job` used the process-wide store and awaited it from the
        loop `asyncio.run` had just created, which raises

            RuntimeError: <asyncio.locks.Event ...> is bound to a
            different event loop

        surfaced on the panel as "the model was fitted and not filed". And its
        `finally` closed that SHARED client, so the first fit that did work
        would have taken /api/research/ml/runs down behind it.
        """
        shared, private = _RecordingStore(), _RecordingStore()
        monkeypatch.setattr("modules.ml.store.get_ml_store", lambda: shared)
        monkeypatch.setattr("modules.ml.store.MLRunStore", lambda: private)

        run_ml_fit_job({"symbol": "BTCUSDT", "interval": "4h", "bars": 400, "n_splits": 3})

        assert private.calls, "the fit did not persist through its own store"
        assert not shared.calls, "the job awaited the gateway's loop-bound client"
        assert not shared.stopped, "the job closed the store the read routes use"
        assert private.stopped, "the job's own client was left open"


class TestAnUnfiledRunSaysSoRatherThanFailing:
    def test_the_numbers_survive_an_unconfigured_store(self, monkeypatch):
        store = _RecordingStore(enabled=False)
        monkeypatch.setattr("modules.ml.store.get_ml_store", lambda: store)

        out = run_ml_fit_job({"symbol": "BTCUSDT", "interval": "4h", "bars": 400, "n_splits": 3})

        assert out["persisted"] is False
        assert "not configured" in (out["reason"] or "")
        # The run HAPPENED. "No corpus" and "no result" are different facts and
        # the job reports both rather than collapsing them.
        assert out["folds"] == 3
        assert out["oos_sharpe"] is not None
        assert not store.calls


class TestPboIsRefusedRatherThanInvented:
    def test_it_is_null_and_says_why(self, monkeypatch):
        store = _RecordingStore(enabled=False)
        monkeypatch.setattr("modules.ml.store.get_ml_store", lambda: store)
        out = run_ml_fit_job({"symbol": "BTCUSDT", "interval": "4h", "bars": 400, "n_splits": 3})

        assert out["pbo"] is None
        # PBO ranks a chosen configuration against the ones it beat. One
        # configuration has no rank, and a number here would be the invented
        # figure whose whole job is catching invented figures.
        assert "not applicable" in out["pbo_reason"]


class TestTheFitItself:
    def test_every_metric_is_out_of_sample_and_the_folds_are_purged(self):
        outcome, payload = run_ml_fit(symbol="BTCUSDT", interval="4h", bars=600, n_splits=3)

        assert outcome.ran and outcome.bars == 600
        # `dataset_fingerprint` returns a truncated sha256; what matters is that
        # it is stable and identifies the bars, not its width.
        assert len(outcome.data_hash) == 16, "the dataset fingerprint changed shape"
        result = payload["result"]
        assert len(result.folds) == 3
        assert np.isfinite(result.oos_sharpe)
        for fold in result.folds:
            assert fold.fold.train_end <= fold.fold.test_start, "a fold trains on its own test window"

    def test_the_label_kind_follows_the_model_unless_told_otherwise(self):
        _, ridge = run_ml_fit(symbol="BTCUSDT", interval="4h", bars=400, n_splits=2, model="ridge")
        assert ridge["label"].startswith("return")

        _, logistic = run_ml_fit(
            symbol="BTCUSDT", interval="4h", bars=400, n_splits=2, model="logistic",
        )
        assert logistic["label"].startswith("direction")

    def test_an_unknown_model_is_refused_by_name(self):
        with pytest.raises(ValueError, match="unknown model"):
            run_ml_fit(symbol="BTCUSDT", interval="4h", bars=400, n_splits=2, model="xgboost")


class TestTheRouteIsRegistered:
    def test_the_gateway_exposes_a_way_to_start_a_fit(self):
        """Read from the published contract, not from ``app.routes``.

        This used to walk ``main.app.routes`` for a ``POST``. Once the routes
        became ``APIRouter``s that list holds router wrappers rather than
        routes, so the scan found an empty set — and a scan that can only ever
        find nothing is a test that can only ever fail, which is the luckier
        half of the same defect that makes a scan find everything. The
        generated schema is also the thing the two clients read, so it is the
        better anchor: if the fit route is missing from it, the workspace has
        no way to start a fit whatever ``app.routes`` says.
        """
        import main

        operations = main.app.openapi()["paths"].get("/api/research/ml/fit", {})
        assert "post" in operations, (
            "the gateway has read routes over ml_runs and no way to create one — "
            "which is exactly the state this module was written to end"
        )

    def test_the_job_kind_is_the_one_the_route_reports(self):
        assert ML_FIT_KIND == "ml.fit"

    def test_the_route_answers_rather_than_raising(self, monkeypatch):
        """The request is issued, not merely looked up in the routing table.

        Asserting the route EXISTS is what the test above does, and it is what
        this suite did on its own for the whole life of the endpoint. It cannot
        catch a route that raises: `DataJobAccepted.kind` was a Literal of the
        two data kinds, so returning `ML_FIT_KIND` constructed a model that
        failed validation inside the route body, and FastAPI answered 500 to
        every fit anyone ever requested. Registration was perfect throughout.

        `submit_ml_fit` is stubbed because what is under test is the response
        boundary, not the walk-forward — a real fit here would reach the
        network and take seconds. `TestClient` is built WITHOUT the context
        manager on purpose: entering it runs the lifespan, whose shutdown
        closes the shared audit handle for every test that follows.
        """
        from dataclasses import dataclass

        from fastapi.testclient import TestClient

        import main

        @dataclass
        class _Accepted:
            job_id: str = "ml-1"
            status: str = "queued"
            backend: str = "in-process"

        # `submit_ml_fit` is resolved by the handler in `modules/api/ml.py`.
        # Patched on `main` it would bind nothing the request reaches, and the
        # real queue would take the job — the assertions below would still
        # pass, and the fit would run for real.
        from modules.api import ml as ml_routes

        monkeypatch.setattr(ml_routes, "submit_ml_fit", lambda params, actor: _Accepted())

        response = TestClient(main.app).post(
            "/api/research/ml/fit",
            json={"symbol": "BTCUSDT", "interval": "4h", "bars": 1500, "model": "ridge"},
        )
        assert response.status_code == 200, (
            f"the fit route answered HTTP {response.status_code}: {response.text[:200]}"
        )
        assert response.json()["kind"] == ML_FIT_KIND
        # Proves the stub answered rather than the real queue: without it a
        # patch that stopped applying would look exactly like a pass.
        assert response.json()["job_id"] == "ml-1"
