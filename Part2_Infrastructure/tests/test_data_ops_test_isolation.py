"""The default pytest process refuses a deployment-selected data backend."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_hostile_exported_backend_is_replaced_before_config_import() -> None:
    code = """
import os
import runpy

os.environ['DATA_OPS_BACKEND'] = 'postgres'
os.environ['ENABLE_MARKET_DATA'] = '1'
os.environ['TELEGRAM_BOT_TOKEN'] = 'live-token'
os.environ['REQUIRE_AUTH'] = '1'
os.environ['SUPABASE_URL'] = 'https://live-project.invalid'
os.environ['SUPABASE_SERVICE_ROLE_KEY'] = 'must-not-be-used'
runpy.run_path('tests/conftest.py')
import config

assert os.environ['DATA_OPS_BACKEND'] == 'sqlite'
assert os.environ['ENABLE_MARKET_DATA'] == '0'
assert os.environ['TELEGRAM_BOT_TOKEN'] == ''
assert os.environ['REQUIRE_AUTH'] == '0'
assert config.settings.data_ops_backend == 'sqlite'
assert str(config.settings.data_ops_db_path).startswith(os.environ['DATA_DIR'])
"""
    # Fixed interpreter and literal test program; no user-controlled command.
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-c", code],
        cwd=ROOT,
        env={**os.environ},
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
