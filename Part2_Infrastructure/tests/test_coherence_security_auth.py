"""Every ``/api/coherence`` route is behind the same door as the rest of the desk.

``tests/test_research_security_auth.py`` sweeps ``/api/research`` and nothing
else, so a new prefix inherits no coverage at all: a coherence route shipped
without ``Depends(trader_identity)`` would be reachable unauthenticated on a
deployment that requires auth, and no existing test would notice. This file is
that sweep for this prefix, built the same way — the table is compared against
the app's own schema, so a route added without an entry fails here rather than
quietly escaping the matrix.

Reading the OpenAPI document rather than ``app.routes`` is deliberate and the
research suite records why: this FastAPI version wraps an included router in a
``_IncludedRouter`` whose ``path`` is None, so walking that list finds nothing
from any router and every set comparison against it passes.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

import main
from modules.api import deps as gateway_auth

TOKEN = "pytest-coherence-gateway-token"

#: One concrete request per coherence route: (method, url, json body or None).
#: Every one is a read; there is no write path in this router by design.
ROUTES: dict[str, tuple[str, str, dict | None]] = {
    "GET /api/coherence/status": ("GET", "/api/coherence/status", None),
    "GET /api/coherence/universe": ("GET", "/api/coherence/universe?series=KXNOTAREALSERIES&max_events=1", None),
    "GET /api/coherence/books": ("GET", "/api/coherence/books?tickers=KX-NOT-A-REAL-TICKER", None),
}


def deployment(monkeypatch, **overrides) -> None:
    """Reconfigure the gateway the way a deployment would, for both readers.

    Two modules on the request path hold their own reference to ``settings``.
    Patching only one binds a name no authenticated request consults, and every
    assertion here would then measure the default configuration while staying
    green.
    """
    patched = replace(main.settings, **overrides)
    monkeypatch.setattr(main, "settings", patched)
    monkeypatch.setattr(gateway_auth, "settings", patched)


@pytest.fixture
def client():
    """No lifespan: no feeds, no recorder, no ledger — just the routes."""
    return TestClient(main.app)


def _published() -> set[str]:
    """Every coherence route the app publishes, read off its own schema."""
    return {
        f"{method.upper()} {path}"
        for path, operations in main.app.openapi()["paths"].items()
        if path.startswith("/api/coherence")
        for method in operations
    }


class TestTheTableIsTheApp:
    def test_the_table_covers_every_coherence_route_the_app_publishes(self):
        published, declared = _published(), set(ROUTES)
        assert published == declared, (
            "the coherence auth matrix and the app disagree — "
            f"published but undeclared: {sorted(published - declared)}; "
            f"declared but unpublished: {sorted(declared - published)}"
        )

    def test_the_router_publishes_no_write_route(self):
        """The engine reads, records and certifies. It does not send orders.

        Not a stylistic preference: a write route here would be a change to
        what this subsystem is, and it should fail a test on the way in rather
        than arrive as a diff nobody read closely.
        """
        methods = {method.upper() for _, _, method in _split(_published())}
        assert methods == {"GET"}, f"a non-GET coherence route appeared: {sorted(methods)}"


def _split(entries: set[str]) -> list[tuple[str, str, str]]:
    rows = []
    for entry in entries:
        method, _, path = entry.partition(" ")
        rows.append((path, entry, method))
    return rows


class TestTheDoor:
    @pytest.mark.parametrize("name", sorted(ROUTES))
    def test_an_unauthenticated_request_is_refused_when_auth_is_required(self, client, monkeypatch, name):
        deployment(monkeypatch, require_auth=True, web_api_token=TOKEN)
        method, url, body = ROUTES[name]
        response = client.request(method, url, json=body)
        assert response.status_code == 401, f"{name} answered {response.status_code} without a token"

    @pytest.mark.parametrize("name", sorted(ROUTES))
    def test_a_wrong_token_is_refused(self, client, monkeypatch, name):
        deployment(monkeypatch, require_auth=True, web_api_token=TOKEN)
        method, url, body = ROUTES[name]
        response = client.request(method, url, json=body, headers={"X-AlphaEngine-Token": "not-the-token"})
        assert response.status_code == 401, f"{name} accepted the wrong token"

    @pytest.mark.parametrize("name", sorted(ROUTES))
    def test_the_right_token_gets_past_the_door(self, client, monkeypatch, name):
        """Past the door, not necessarily to an answer.

        These routes reach the live exchange, which a test must not depend on,
        so the claim is only that the request was not refused for its
        credentials: anything other than 401/403 means the gate let it through.
        """
        deployment(monkeypatch, require_auth=True, web_api_token=TOKEN)
        method, url, body = ROUTES[name]
        response = client.request(method, url, json=body, headers={"X-AlphaEngine-Token": TOKEN})
        assert response.status_code not in (401, 403), f"{name} refused a valid token"
