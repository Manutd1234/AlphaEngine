"""The optional scikit-learn adapter, and the honesty of its absence.

The extra is optional, so the path that matters most is the one where it is
missing. What is under test is not that the fallback *works* — the hand-rolled
models had tests already — but that it SAYS SO. The failure being engineered
against is a run that asked for scikit-learn, quietly got NumPy, and was then
ranked beside a run that did not fall back.

`ml_runs.engine` has a check constraint of ('numpy', 'sklearn') and a comment
saying a run that fell back "is a different run and must say so rather than
being silently comparable to one that did not". Before this suite, nothing set
that column to anything but a process-wide default, which described the
environment rather than the run.
"""

from __future__ import annotations

import inspect

import numpy as np
import pandas as pd
import pytest

from modules.ml.fit import run_ml_fit, run_ml_fit_job
from modules.ml.sklearn_adapter import forget_probe, resolve_engine
from modules.ml.store import MLRunStore

#: What `import_sklearn` reports on a box without the extra.
ABSENT = "ModuleNotFoundError: No module named 'sklearn'"


@pytest.fixture(autouse=True)
def offline_bars(monkeypatch):
    """Deterministic bars, no network — the pattern from test_ml_fit.py.

    `fetch_ohlcv` reaches Binance first, which would make these depend on an
    exchange being up and produce different numbers every run. What is under
    test is which engine ran and what it said, so the bars are a fixture.
    """
    monkeypatch.setattr("modules.ml.fit.fetch_ohlcv", _frame)


@pytest.fixture(autouse=True)
def _clean_probe():
    """The import probe is cached per process; these tests fake both answers."""
    forget_probe()
    yield
    forget_probe()


def _frame(symbol: str, interval: str, count: int):
    rng = np.random.default_rng(20260820)
    close = 30_000.0 * np.exp(np.cumsum(rng.normal(0.0, 0.01, size=count)))
    frame = pd.DataFrame({
        "open": close * (1 + rng.normal(0, 0.001, count)),
        "high": close * (1 + np.abs(rng.normal(0, 0.003, count))),
        "low": close * (1 - np.abs(rng.normal(0, 0.003, count))),
        "close": close,
        "volume": np.abs(rng.normal(1_000, 120, count)),
    }, index=pd.date_range("2024-01-01", periods=count, freq="4h", tz="UTC"))
    return frame, "fixture"


def _absent(monkeypatch):
    """Make the adapter report scikit-learn as unimportable, in process.

    Patches the probe rather than the import machinery: `import_sklearn` is the
    one place the package is imported, so standing in for it is standing in for
    the whole question. `test_ml_sklearn_absent.py` blocks the import for real
    in a fresh interpreter, which is what proves this stand-in tells the truth.
    """
    monkeypatch.setattr(
        "modules.ml.sklearn_adapter.import_sklearn", lambda: (None, ABSENT),
    )


def _fit(**over):
    kwargs = {"symbol": "BTCUSDT", "interval": "4h", "bars": 400, "n_splits": 3}
    kwargs.update(over)
    return run_ml_fit(**kwargs)


class TestAskingForSklearnWithoutItIsNotASilentFallback:
    def test_the_run_still_happens_and_reports_the_engine_that_ran(self, monkeypatch):
        _absent(monkeypatch)
        outcome, payload = _fit(engine="sklearn")

        # The run is NOT skipped. Skipping would be a different dishonesty:
        # "no result" reported where a real one was available.
        assert outcome.ran
        assert len(payload["result"].folds) == 3
        assert np.isfinite(payload["result"].oos_sharpe)

        # And it does not claim to be the run that was asked for.
        assert outcome.engine == "numpy"
        assert outcome.engine_requested == "sklearn"

    def test_the_reason_is_a_sentence_someone_can_act_on(self, monkeypatch):
        _absent(monkeypatch)
        outcome, _ = _fit(engine="sklearn")

        reason = outcome.engine_reason
        assert reason, "a fallback with no reason is the shape of message that gets ignored"
        assert "requirements-ml.txt" in reason, "the reason must say what to run"
        assert "not usable" in reason, "and what was wrong"
        assert "different runs" in reason, "and why the two are not comparable"
        # The run happened; a reader must not take this for a skipped one.
        assert "NOT" in reason and "skipped" in reason

    def test_the_engine_recorded_on_the_run_is_never_the_one_requested(self, monkeypatch):
        _absent(monkeypatch)
        _, payload = _fit(engine="sklearn")

        # This is the value that reaches ml_runs.engine.
        assert payload["params"]["engine"] == "numpy"
        assert payload["params"]["engine_requested"] == "sklearn"
        assert payload["params"]["engine_reason"]

    def test_the_job_result_carries_all_three_facts_to_the_caller(self, monkeypatch):
        _absent(monkeypatch)
        store = _RecordingStore(enabled=False)
        monkeypatch.setattr("modules.ml.store.get_ml_store", lambda: store)

        out = run_ml_fit_job({
            "symbol": "BTCUSDT", "interval": "4h", "bars": 400,
            "n_splits": 3, "engine": "sklearn",
        })

        assert out["engine"] == "numpy"
        assert out["engine_requested"] == "sklearn"
        assert "requirements-ml.txt" in out["engine_reason"]
        # One field would leave "sklearn asked, numpy ran" indistinguishable
        # from "numpy asked, numpy ran". They are different runs.
        assert out["engine"] != out["engine_requested"]

    def test_auto_says_which_solver_produced_the_coefficients(self, monkeypatch):
        _absent(monkeypatch)
        outcome, _ = _fit(engine="auto")

        # Nothing was DENIED — auto asked for whatever was here. But a reader
        # still has to know which solver fitted it, so the reason is recorded
        # and `fell_back` stays false.
        assert outcome.engine == "numpy"
        assert outcome.engine_reason and "engine=auto" in outcome.engine_reason
        assert resolve_engine("ridge", {}, requested="auto").fell_back is False

    def test_asking_for_numpy_needs_no_excuse(self, monkeypatch):
        _absent(monkeypatch)
        outcome, _ = _fit(engine="numpy")

        assert outcome.engine == "numpy"
        assert outcome.engine_requested == "numpy"
        # Asked for it, got it. A reason here would be noise, and noise is how
        # a real reason stops being read.
        assert outcome.engine_reason is None


class TestTheStoreFilesTheEngineThatRan:
    async def test_the_run_row_takes_the_engine_from_the_run_not_the_process(
        self, monkeypatch,
    ):
        """`ml_runs.engine` used to be a module constant describing the box.

        That is the defect: on a machine with scikit-learn installed, every run
        filed 'sklearn' while the hand-rolled models did the fitting, because
        nothing in the fit path had ever built a scikit-learn estimator.
        """
        from modules.ml.store import MLRunStore

        _absent(monkeypatch)
        _, payload = _fit(engine="sklearn")

        client = _FakeClient()
        store = MLRunStore()
        store.enabled = True
        store._client = client

        outcome = await store.persist(**payload)
        assert outcome.persisted

        run_row = next(body[0] for verb, table, body in client.calls if table == "ml_runs")
        assert run_row["engine"] == "numpy", "the store filed the requested engine"
        # The constraint on the column allows exactly these two.
        assert run_row["engine"] in {"numpy", "sklearn"}
        # The request and the reason survive alongside it, so the row explains
        # itself without a reader having to know what was installed that day.
        assert run_row["params"]["engine_requested"] == "sklearn"
        assert run_row["params"]["engine_reason"]

    async def test_a_payload_with_no_engine_files_numpy_rather_than_guessing(self):
        from modules.ml.store import MLRunStore

        _, payload = _fit(engine="numpy")
        payload["params"].pop("engine")

        client = _FakeClient()
        store = MLRunStore()
        store.enabled = True
        store._client = client
        await store.persist(**payload)

        run_row = next(body[0] for verb, table, body in client.calls if table == "ml_runs")
        # Every estimator in this repository that did not go through the
        # adapter is hand-rolled, so numpy is the fact rather than a default.
        assert run_row["engine"] == "numpy"


class TestTheSklearnPathIsRealWhenTheExtraIsPresent:
    def test_a_sklearn_run_records_sklearn_and_offers_no_excuse(self):
        pytest.importorskip("sklearn")
        outcome, payload = _fit(engine="sklearn")

        assert outcome.engine == "sklearn"
        assert outcome.engine_reason is None, "nothing to explain when the request was met"
        assert payload["params"]["engine"] == "sklearn"
        assert len(payload["result"].folds) == 3

    def test_both_engines_fit_the_same_problem(self):
        """An engine swap must be a SOLVER swap, not a pipeline swap.

        The adapter standardises with the same helper the hand-rolled models
        use and returns the same `Fitted`, so ridge closed-form and
        scikit-learn's ridge are solving one problem. If these drifted apart,
        `ml_runs.engine` would be labelling two different experiments rather
        than two solvers, and the column would be worse than useless.
        """
        pytest.importorskip("sklearn")
        rng = np.random.default_rng(11)
        x = rng.normal(size=(300, 5))
        y = x @ np.array([0.4, -0.2, 0.0, 0.9, 0.1]) + rng.normal(scale=0.1, size=300)

        builtin = resolve_engine("ridge", {"alpha": 1.0}, requested="numpy").estimator
        adapted = resolve_engine("ridge", {"alpha": 1.0}, requested="sklearn").estimator
        assert type(builtin) is not type(adapted), "the same estimator was returned twice"

        a, b = builtin.fit(x, y), adapted.fit(x, y)
        np.testing.assert_allclose(a.coefficients, b.coefficients, rtol=1e-6, atol=1e-8)
        assert a.intercept == pytest.approx(b.intercept, rel=1e-6)
        np.testing.assert_allclose(a.center, b.center)

    def test_logistic_fits_through_the_adapter(self):
        pytest.importorskip("sklearn")
        outcome, payload = _fit(model="logistic", engine="sklearn")

        assert outcome.engine == "sklearn"
        assert payload["label"].startswith("direction")
        assert len(payload["result"].folds) == 3

    def test_a_one_class_window_is_refused_by_name_rather_than_crashing(self):
        pytest.importorskip("sklearn")
        estimator = resolve_engine("logistic", {}, requested="sklearn").estimator
        x = np.random.default_rng(3).normal(size=(40, 3))
        with pytest.raises(ValueError, match="one class"):
            estimator.fit(x, np.ones(40))


class TestARequestThatCannotBeMetIsRefusedByName:
    def test_an_unknown_engine(self):
        with pytest.raises(ValueError, match="unknown engine"):
            resolve_engine("ridge", {}, requested="tensorflow")

    def test_an_unknown_model(self):
        with pytest.raises(ValueError, match="unknown model"):
            resolve_engine("xgboost", {}, requested="auto")

    def test_the_refusal_happens_before_any_bars_are_fetched(self, monkeypatch):
        """A request that cannot produce a result should not first spend a
        network round trip finding that out."""
        def _explode(*_args, **_kwargs):
            raise AssertionError("bars were fetched for a request that cannot run")

        monkeypatch.setattr("modules.ml.fit.fetch_ohlcv", _explode)
        with pytest.raises(ValueError, match="unknown engine"):
            _fit(engine="tensorflow")


#: The production signature, read off the real class at import — before any
#: test has had a chance to stand something else in its place. Re-derived from
#: the class rather than restated, so it cannot fall out of step with it.
_PERSIST_SIGNATURE = inspect.signature(MLRunStore.persist)


def _bind_like_the_real_store(**payload) -> None:
    """Raise unless ``payload`` is a call ``MLRunStore.persist`` would accept."""
    # `None` stands in for `self`; the signature is the unbound function's.
    _PERSIST_SIGNATURE.bind(None, **payload)


class _RecordingStore:
    """Stands in for the Supabase mirror. Same shape as test_ml_fit.py's."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self.calls: list[dict] = []

    async def persist(self, **payload):
        """Bound against the REAL signature before anything is recorded.

        A stand-in that takes ``**payload`` accepts arguments the production
        object rejects, and that is not a test of the production object: the
        router's audit write spent this round raising ``TypeError`` on every
        call into a caught warning because its recorder took ``**kwargs``.
        ``MLRunStore.persist`` is keyword-only with eleven required names, so
        a caller that drops one or invents one has to fail HERE, where it is a
        red test, rather than in the deployment where it is a missing corpus.

        Read off the class at call time so it can never fall out of step.
        """
        _bind_like_the_real_store(**payload)
        self.calls.append(payload)
        return None

    async def stop(self) -> None:
        pass


class _FakeClient:
    """Records every PostgREST call in order. Same shape as test_ml_store.py's."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, object]] = []

    async def post(self, path, json):
        table = path.rsplit("/", 1)[-1]
        self.calls.append(("POST", table, json))
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
