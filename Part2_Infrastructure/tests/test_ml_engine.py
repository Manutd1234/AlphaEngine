"""Which model engine ran, and whether the desk says so.

The failure this guards is silence. ML_ENGINE defaults to `auto`, so a
deployment that expected scikit-learn and did not get it starts perfectly
happily, runs different models, and produces numbers that are not comparable to
the ones it produced last week. Nothing about that is visible unless the desk
is made to say it.
"""

from __future__ import annotations

import importlib
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _engine_under(env_value: str | None):
    """Import modules.ml.engine in a fresh interpreter with ML_ENGINE set."""
    code = (
        "import json, sys; sys.path.insert(0, '.');"
        "from modules.ml import engine;"
        "print(json.dumps(engine.snapshot()))"
    )
    env = {"PATH": "/usr/bin:/bin"}
    if env_value is not None:
        env["ML_ENGINE"] = env_value
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, env=env,
        capture_output=True, text=True, check=True,
    )
    import json

    return json.loads(out.stdout.strip().splitlines()[-1])


def test_the_builtin_models_are_available_whatever_the_engine():
    from modules.ml import engine

    for model in ("ridge", "logistic"):
        assert engine.unavailable_reason(model) is None, (
            f"{model} is hand-rolled in this repo and must never be unavailable"
        )


def test_forcing_numpy_reports_numpy_and_still_offers_the_builtins():
    snapshot = _engine_under("numpy")
    assert snapshot["engine"] == "numpy"
    assert snapshot["requested"] == "numpy"
    assert snapshot["builtin_models"] == ["ridge", "logistic"]


def test_an_unavailable_model_explains_itself_rather_than_saying_unavailable():
    # A boolean would be ignored until someone discovered the desk had been
    # running a different model for a month.
    import os

    os.environ["ML_ENGINE"] = "numpy"
    try:
        from modules.ml import engine

        reloaded = importlib.reload(engine)
        reason = reloaded.unavailable_reason("gradient_boosting")
        assert reason is not None
        assert "requirements-ml.txt" in reason, "the reason must say what to run"
        assert "ridge" in reason, "and what works without it"
    finally:
        os.environ.pop("ML_ENGINE", None)
        from modules.ml import engine as restore

        importlib.reload(restore)


def test_an_invalid_engine_is_refused_at_import_rather_than_defaulted():
    with pytest.raises(subprocess.CalledProcessError):
        _engine_under("tensorflow")


def test_the_snapshot_carries_everything_health_needs_to_publish():
    from modules.ml import engine

    snapshot = engine.snapshot()
    assert set(snapshot) == {
        "engine", "requested", "sklearn_available", "import_error", "builtin_models",
    }
    assert snapshot["engine"] in {"numpy", "sklearn"}


def test_the_extra_is_not_in_the_core_requirements():
    core = (ROOT / "requirements-core.txt").read_text()
    assert "scikit-learn" not in core, (
        "the ML extra must stay optional; the runtime image does not carry it"
    )
    extra = (ROOT / "requirements-ml.txt").read_text()
    assert "scikit-learn" in extra
    # Pinned to a major line: a solver that changes between releases changes
    # yesterday's coefficients, and the coefficients are the research result.
    assert "<2.0" in extra
