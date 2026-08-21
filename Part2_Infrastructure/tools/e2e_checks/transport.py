"""Transport, defaults and the one result type every check returns.

Split out of ``tools/e2e_smoke.py``. ``fetch`` never raises for an HTTP status:
a transport failure is a ``Result``, not a crash, because a probe that dies on
the first unreachable host tells an operator less than one that reports every
boundary it could and could not reach.
"""

from __future__ import annotations

import json
import os
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

# Defaults mirror docs/product/FEATURE_TOUR.md; the env vars are authoritative when the
# deployment moves — a stale default here must fail loudly, not silently probe
# the wrong host.
GATEWAY = os.environ.get("E2E_GATEWAY_URL", "http://149.118.48.255:8000").rstrip("/")
VERCEL = os.environ.get("E2E_VERCEL_URL", "https://alphaengine-workspace.vercel.app").rstrip("/")
TIMEOUT = float(os.environ.get("E2E_TIMEOUT", "20"))

OK, FAIL, SKIP = "ok", "fail", "skip"


@dataclass
class Result:
    name: str
    state: str
    detail: str = ""
    fix: str = ""
    data: dict[str, Any] = field(default_factory=dict)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Surfaces a 3xx as the result instead of following it.

    urlopen follows redirects transparently, which is what you want everywhere in
    this file except when the redirect IS the thing being checked: the root now
    answers 307 to /login for a visitor with no desk cookie, and a follower would
    report the 200 from /login and never notice if the guard disappeared.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102, ANN001
        return None


def fetch(
    url: str,
    *,
    token: str | None = None,
    method: str = "GET",
    body: dict | None = None,
    allow_redirects: bool = True,
) -> tuple[int, Any, float]:
    """Returns (status, parsed-or-text, elapsed_ms). Never raises for HTTP status."""
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=payload, method=method)
    request.add_header("User-Agent", "alphaengine-e2e/1.0")
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")

    # The gateway is plain HTTP; Vercel and Supabase are TLS. Default context.
    started = time.perf_counter()
    opener = (
        urllib.request.build_opener(
            _NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context())
        )
        if not allow_redirects
        else None
    )
    try:
        open_url = opener.open if opener else (
            lambda req, timeout: urllib.request.urlopen(
                req, timeout=timeout, context=ssl.create_default_context()
            )
        )
        with open_url(request, timeout=TIMEOUT) as response:
            raw = response.read().decode("utf-8", "replace")
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        status = error.code
    except Exception as error:  # noqa: BLE001 — a transport failure is a result, not a crash
        return 0, str(error), (time.perf_counter() - started) * 1000
    elapsed = (time.perf_counter() - started) * 1000
    try:
        return status, json.loads(raw), elapsed
    except json.JSONDecodeError:
        return status, raw, elapsed
