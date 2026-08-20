"""Proof that the fallback is real, with scikit-learn genuinely unimportable.

Its sibling `test_ml_sklearn.py` stands in for the missing extra by patching
`import_sklearn`. That is fast and precise, and it is also a stub asserting
something about itself. These tests run in a fresh interpreter whose import
machinery refuses scikit-learn outright — what a box without the extra actually
looks like — and check the same two claims end to end:

* the gateway still BOOTS, because the extra is optional and nothing on the
  import path may depend on it;
* a fit that ASKED for scikit-learn still completes, on the hand-rolled models,
  and says which engine ran and why it was not the one requested.

Split out of `test_ml_sklearn.py` to keep both files under the 400-line ceiling
in `test_file_size.py`; the seam is in-process behaviour there, subprocess
proof here.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


class TestNothingImportsSklearnUntilARunAsksForIt:
    def test_the_ml_package_holds_no_module_scope_import(self):
        """`main.py` imports `modules.ml.fit` at boot.

        A module-scope `import sklearn` anywhere it reaches would put scipy on
        every gateway start and turn a broken extra into a boot failure on a
        deployment that never intended to fit a model.
        """
        out = _run(
            "import sys;"
            "import modules.ml.engine, modules.ml.sklearn_adapter, modules.ml.models;"
            "print('sklearn' in sys.modules)"
        )
        assert out == "False", "modules/ml imported scikit-learn at module scope"

    def test_resolving_numpy_does_not_import_it_either(self):
        out = _run(
            "import sys;"
            "from modules.ml.sklearn_adapter import resolve_engine;"
            "resolve_engine('ridge', {}, requested='numpy');"
            "print('sklearn' in sys.modules)"
        )
        assert out == "False"

    def test_resolving_sklearn_does_import_it(self):
        """The other half: a deferred import that never fires is dead code.

        Skipped rather than failed when the extra is absent — that is the
        environment this whole module exists to tolerate.
        """
        pytest.importorskip("sklearn")
        out = _run(
            "import sys;"
            "from modules.ml.sklearn_adapter import resolve_engine;"
            "resolve_engine('ridge', {}, requested='sklearn');"
            "print('sklearn' in sys.modules)"
        )
        assert out == "True", "the deferred import never fired; the adapter is dead code"


class TestWithScikitLearnGenuinelyUnimportable:
    """The proof, with the package blocked for real rather than stubbed.

    Everything above patches `import_sklearn`. These two run in a fresh
    interpreter whose import machinery refuses scikit-learn outright, which is
    what a box without the extra actually looks like.
    """

    def test_the_gateway_still_imports(self):
        out = _run("import main; print('imported')", block_sklearn=True)
        assert out == "imported", "the gateway will not boot without the optional extra"

    def test_a_fit_requesting_sklearn_completes_and_reports_numpy_with_a_reason(self):
        out = _run(_FIT_SCRIPT, block_sklearn=True)
        payload = json.loads(out)

        assert payload["sklearn_importable"] is False, "the blocker did not block"
        assert payload["ran"] is True, "the run was skipped instead of falling back"
        assert payload["folds"] == 3, "the fallback produced no folds"
        assert payload["engine"] == "numpy"
        assert payload["engine_requested"] == "sklearn"
        assert payload["recorded_engine"] == "numpy", "ml_runs.engine took the request"
        assert "requirements-ml.txt" in payload["engine_reason"]


# --------------------------------------------------------------------------
# Subprocess plumbing
# --------------------------------------------------------------------------

#: Makes scikit-learn unimportable before anything else loads, the way a box
#: without the extra behaves. A meta-path finder that RAISES rather than
#: returning None, because returning None only delegates to the next finder —
#: which would find the installed package sitting there.
_BLOCKER = """
import sys
from importlib.abc import MetaPathFinder


class _NoSklearn(MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'sklearn' or fullname.startswith('sklearn.'):
            raise ModuleNotFoundError(f"No module named '{fullname}'")
        return None


for _name in [m for m in sys.modules if m == 'sklearn' or m.startswith('sklearn.')]:
    del sys.modules[_name]
sys.meta_path.insert(0, _NoSklearn())
"""

#: Runs one real fit that asks for scikit-learn, and prints what it got.
_FIT_SCRIPT = """
import json
import numpy as np
import pandas as pd
from modules.ml import fit as fitmod


def _bars(symbol, interval, count):
    rng = np.random.default_rng(20260820)
    close = 30_000.0 * np.exp(np.cumsum(rng.normal(0.0, 0.01, size=count)))
    frame = pd.DataFrame({
        'open': close * (1 + rng.normal(0, 0.001, count)),
        'high': close * (1 + np.abs(rng.normal(0, 0.003, count))),
        'low': close * (1 - np.abs(rng.normal(0, 0.003, count))),
        'close': close,
        'volume': np.abs(rng.normal(1_000, 120, count)),
    }, index=pd.date_range('2024-01-01', periods=count, freq='4h', tz='UTC'))
    return frame, 'fixture'


try:
    import sklearn  # noqa: F401
    importable = True
except Exception:
    importable = False

fitmod.fetch_ohlcv = _bars
outcome, payload = fitmod.run_ml_fit(
    symbol='BTCUSDT', interval='4h', bars=400, n_splits=3, engine='sklearn',
)
print(json.dumps({
    'ran': outcome.ran,
    'engine': outcome.engine,
    'engine_requested': outcome.engine_requested,
    'engine_reason': outcome.engine_reason,
    'recorded_engine': payload['params']['engine'],
    'folds': len(payload['result'].folds),
    'oos_sharpe': payload['result'].oos_sharpe,
    'sklearn_importable': importable,
}))
"""


def _run(body: str, *, block_sklearn: bool = False) -> str:
    """Run `body` in a fresh interpreter rooted at the gateway, return stdout.

    A subprocess is the only way to test an import-time property, which is what
    "nothing imports scikit-learn at module scope" is.
    """
    code = "import sys; sys.path.insert(0, '.')\n"
    if block_sklearn:
        code += _BLOCKER
    code += "\n" + body
    # noqa S603: argv is a literal here and `body` is a constant in this file —
    # nothing on this line is caller-supplied.
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-c", code], cwd=ROOT,
        env={"PATH": "/usr/bin:/bin", "ML_ENGINE": "auto"},
        capture_output=True, text=True, check=False,
    )
    assert completed.returncode == 0, (
        f"the interpreter exited {completed.returncode}:\n{completed.stderr[-2000:]}"
    )
    return completed.stdout.strip().splitlines()[-1]
