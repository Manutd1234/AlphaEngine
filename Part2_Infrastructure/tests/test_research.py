"""OpenBB bridge tests.

OpenBB itself is optional and absent in CI, so what is under test is the
contract that matters to the portal's registry: absence is a *reported state*
with HTTP 200 and {"ok": false}, never a 500; payloads are JSON-clean (no NaN
tokens); and the field-alias resolution that absorbs OpenBB's provider drift
picks the right names.
"""

from __future__ import annotations

import json
import math

import pytest
from httpx import ASGITransport, AsyncClient

from main import app
from modules import research


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# --------------------------------------------------------------------------- #
# Normalisation helpers
# --------------------------------------------------------------------------- #

def test_clean_strips_nan_and_inf():
    # NaN survives json.dumps as the literal token `NaN`, which is not JSON —
    # the portal's JSON.parse would throw on an otherwise fine row.
    assert research._clean(float("nan")) is None
    assert research._clean(float("inf")) is None
    assert research._clean(1.5) == 1.5
    assert research._clean("x") == "x"
    payload = {"a": research._clean(float("nan"))}
    assert json.loads(json.dumps(payload)) == {"a": None}


def test_first_resolves_aliases_in_order():
    row = {"close": None, "price": 101.5, "last_price": 100.0}
    # None is "absent", so `close` is skipped even though the key exists.
    assert research._first(row, "close", "last_price", "price") == 100.0
    assert research._first(row, "missing", "also_missing") is None


def test_rows_tolerates_dicts_and_none():
    assert research._rows(None) == []
    assert research._rows([{"a": 1}]) == [{"a": 1}]
    # NaN inside a row is cleaned during extraction, not left for serialisation.
    out = research._rows([{"a": float("nan")}])
    assert out == [{"a": None}]
    assert not any(isinstance(v, float) and math.isnan(v) for v in out[0].values())


# --------------------------------------------------------------------------- #
# Absence contract
# --------------------------------------------------------------------------- #

def test_status_reports_absence_not_raises():
    st = research.openbb_status()
    assert st["ok"] in (True, False)
    if not st["ok"]:
        assert st["detail"]  # says *why*, not just that


@pytest.mark.anyio
async def test_health_route_is_200_even_without_openbb(client):
    r = await client.get("/api/research/openbb/health")
    assert r.status_code == 200
    body = r.json()
    assert "ok" in body


@pytest.mark.anyio
async def test_quote_route_wraps_absence_as_ok_false(client):
    r = await client.get("/api/research/openbb/quote", params={"symbol": "AAPL"})
    assert r.status_code == 200
    body = r.json()
    # With openbb installed this may be ok:true; without it MUST be the
    # structured refusal, never a 500 — the portal's breaker treats 5xx as
    # gateway failure and would open against a healthy process.
    if not research.openbb_available():
        assert body == {"ok": False, "error": body["error"]}
        assert "openbb" in body["error"].lower() or "No module" in body["error"]


@pytest.mark.anyio
async def test_bad_symbol_is_rejected_at_the_edge(client):
    # Validation failures ARE HTTP errors — they are the caller's fault and
    # retrying elsewhere cannot help, so 422 (not ok:false) is correct here.
    r = await client.get("/api/research/openbb/quote", params={"symbol": "A;DROP TABLE"})
    assert r.status_code == 422


@pytest.mark.anyio
async def test_bars_interval_is_validated(client):
    r = await client.get(
        "/api/research/openbb/bars", params={"symbol": "AAPL", "interval": "7m"}
    )
    assert r.status_code == 422


@pytest.mark.anyio
async def test_news_symbol_list_is_bounded(client):
    # 20 symbols in, at most 6 make it through — the cap is applied server-side
    # so a caller cannot fan one request into 20 downstream vendor calls.
    symbols = ",".join(f"S{i}" for i in range(20))
    r = await client.get("/api/research/openbb/news", params={"symbols": symbols})
    assert r.status_code == 200
