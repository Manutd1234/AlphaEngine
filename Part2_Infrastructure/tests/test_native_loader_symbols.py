"""The loader checks executable native symbols, not metadata alone."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("mode", ["auto", "native"])
def test_metadata_only_native_module_falls_back_or_fails_closed(mode: str) -> None:
    script = r'''
import importlib
import os
import sys
import types

os.environ["DECISION_CORE"] = "python"
import modules
import modules.decision_core as contract

fake = types.ModuleType("modules._decision_core")
fake.ABI_VERSION = contract.EXPECTED_ABI_VERSION
fake.BUILD_ID = f"alphaengine-decision-core/abi-{contract.EXPECTED_ABI_VERSION}"
fake.DECIDE_ARGUMENT_COUNT = len(contract.EXPECTED_DECIDE_ARGUMENTS)
fake.DECIDE_ARGUMENTS = contract.EXPECTED_DECIDE_ARGUMENTS
fake.CAPABILITY_VERSION = contract.EXPECTED_CAPABILITY_VERSION
fake.CAPABILITIES = contract.REQUIRED_CAPABILITIES
sys.modules["modules._decision_core"] = fake
setattr(modules, "_decision_core", fake)

mode = sys.argv[1]
os.environ["DECISION_CORE"] = mode
sys.modules.pop("modules.decision_core", None)
if hasattr(modules, "decision_core"):
    delattr(modules, "decision_core")

if mode == "auto":
    loader = importlib.import_module("modules.decision_core")
    assert loader.ENGINE == "python"
    assert loader.FALLBACK_REASON == "native_symbol_contract_mismatch"
else:
    try:
        importlib.import_module("modules.decision_core")
    except RuntimeError as exc:
        assert "native_symbol_contract_mismatch" in str(exc), str(exc)
    else:
        raise AssertionError("forced native accepted a metadata-only module")
print(f"SYMBOL_CONTRACT_{mode.upper()}_OK")
'''
    run = subprocess.run(  # noqa: S603 - fixed interpreter and committed test program
        [sys.executable, "-c", script, mode],
        cwd=ROOT,
        env={**os.environ, "DECISION_CORE": "python"},
        capture_output=True,
        text=True,
        check=False,
    )

    assert run.returncode == 0, run.stderr
    assert run.stdout.strip() == f"SYMBOL_CONTRACT_{mode.upper()}_OK"
