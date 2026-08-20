"""Prove a RUNNING service answers every route with real data.

Why this exists, and why HTTP 200 is not what it checks
-------------------------------------------------------
``_envelope`` in ``app.py`` catches ``ProviderUnavailable`` and answers HTTP
**200** with ``{"ok": false, "error": ...}``. That is the right answer and it is
kept deliberately: a 5xx would be counted against *this service* by the web
app's circuit breaker and by the platform health check, when the service is
perfectly healthy and Yahoo is the thing that declined. Failing over to another
data provider is a routing decision, and it needs a body to read, not a status
to guess from.

The cost of that choice is that the status line carries no information. A
rate-limited Yahoo, a delisted symbol and a working call all return 200. So
anything that checks this service by status alone reports a total upstream
outage as healthy — and until this file existed, that was every check there was.
This one reads ``ok`` and refuses to call an empty payload a success.

Network-bound, and therefore deliberately NOT under ``tests/``: the offline
suite replaces the provider fetchers with fakes and must stay offline. That is
also why a green ``pytest`` never proved this service could serve anything.

    python scripts/smoke.py                             # 127.0.0.1:8010
    python scripts/smoke.py https://openbb.example.com  # a deployment
    OPENBB_API_TOKEN=... python scripts/smoke.py https://openbb.example.com
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

TIMEOUT_SECONDS = 30

#: (label, path, what counts as a real answer). The third element is the whole
#: point of the file: `ok` is true AND the payload is not empty.
PROBES: list[tuple[str, str, str]] = [
    ("health", "/api/research/openbb/health", "provider"),
    ("quote equity", "/api/research/openbb/quote?symbol=AAPL&asset=equity", "price"),
    ("quote crypto", "/api/research/openbb/quote?symbol=BTCUSDT&asset=crypto", "price"),
    ("bars equity", "/api/research/openbb/bars?symbol=AAPL&asset=equity&interval=1d&limit=30", "rows"),
    ("bars crypto", "/api/research/openbb/bars?symbol=BTCUSDT&asset=crypto&interval=4h&limit=30", "rows"),
    ("news", "/api/research/openbb/news?symbols=AAPL,MSFT&limit=5&asset=equity", "rows"),
    ("fundamentals", "/api/research/openbb/fundamentals?symbol=AAPL", "name"),
]


def fetch(url: str, token: str) -> tuple[int, Any]:
    """GET one route. A non-200 is returned, never raised — it is a result."""
    request = urllib.request.Request(url, headers={"accept": "application/json"})  # noqa: S310 — http(s) only, checked below
    if token:
        request.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def evidence(body: Any, wants: str) -> tuple[bool, str]:
    """Is there an actual measurement in here, and what is it?

    Emptiness is reported, never hidden, and never counted as a pass: a bars
    route answering ``ok:true`` with no rows has not proved anything about
    Yahoo, and reading it as healthy is the exact defect this file exists for.
    """
    if not isinstance(body, dict):
        return False, f"not a JSON object ({type(body).__name__})"
    if body.get("ok") is not True:
        return False, f"ok={body.get('ok')!r} error={body.get('error')!r}"
    if wants == "provider":
        provider = body.get("provider")
        return bool(provider), f"provider={provider!r} versions={body.get('versions')}"
    data = body.get("data")
    if wants == "rows":
        rows = data if isinstance(data, list) else []
        return bool(rows), f"{len(rows)} rows, first={json.dumps(rows[0])[:70] if rows else 'none'}"
    if not isinstance(data, dict):
        return False, f"data is {type(data).__name__}, not an object"
    value = data.get(wants)
    # `is None` rather than falsy: a real zero is a measurement and must not be
    # read as a missing one.
    return value is not None, f"{wants}={value!r} as_of={data.get('as_of', data.get('exchange'))!r}"


def main() -> int:
    argv = [a for a in sys.argv[1:] if not a.startswith("-")]
    base = (argv[0] if argv else "http://127.0.0.1:8010").rstrip("/")
    if not base.startswith(("http://", "https://")):
        print(f"✗ not an http(s) origin: {base}")
        return 2
    token = os.environ.get("OPENBB_API_TOKEN", "").strip()
    print(f"OpenBB service smoke test → {base}" + (" (bearer sent)" if token else " (no token)"))

    failures = 0
    for label, path, wants in PROBES:
        status, body = fetch(f"{base}{path}", token)
        healthy, detail = (False, str(body)[:110]) if status != 200 else evidence(body, wants)
        failures += 0 if healthy else 1
        print(f"  {'✓' if healthy else '✗'} {label:<14} HTTP {status:<3} {detail[:110]}")

    print(
        f"\n{len(PROBES) - failures}/{len(PROBES)} routes answered with real data."
        + ("" if failures else " HTTP 200 was not taken as evidence for any of them.")
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
