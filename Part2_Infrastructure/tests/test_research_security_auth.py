"""Every research route, held to the authentication gate — the matrix that was missing.

`tests/test_api.py`'s `TestReadAuthentication` covers nine gateway collections
and names no research route at all. So nothing in this suite proved that
`/api/research/rag/*` refuses an unauthenticated caller: the routes DO carry
`Depends(trader_identity)`, and a route that lost it — a signature edited to
take a body parameter, a decorator copied from a sibling — would have gone out
green. `test_api.py` is over the length ceiling `tests/test_file_size.py`
ratchets and may not grow, which is why this is a file of its own rather than
nine more lines there.

THE ROUTE TABLE IS COMPARED AGAINST THE APP, NOT ASSUMED
--------------------------------------------------------

The failure this file exists to prevent is a route nobody wrote a case for, so a
hard-coded list of paths would reproduce it exactly: the list would stay green
while a new `/api/research/...` route shipped unguarded beside it. `test_the_table
_covers_every_research_route_the_app_publishes` reads `main.app.routes` and
compares the sets, which is the shape `tests/test_supabase_schema.py` uses for
its gate harvest and for the same reason — a scan whose subject has moved on
does not fail, it passes having read the wrong thing.

WHAT IS EXERCISED, AND WHAT IS DELIBERATELY NOT
-----------------------------------------------

The refusal half drives EVERY route, because a 401 is answered by the dependency
before the handler runs and can therefore cost nothing. The acceptance half
drives every route except `POST /api/research/ml/fit`, which submits a job: the
claim being made here is about the gate, and running a fit to prove a credential
was accepted would make this file's runtime a function of the ML engine. That
exclusion is named in `SIDE_EFFECTING` rather than left as a gap in a list.

Nothing here reaches the network. Supabase and Neo4j are blank in
`tests/conftest.py`, so retrieval and the graph reads answer with their own
`unavailable` states; the OpenBB bridge is served by conftest's
`fake_market_data`, which patches `modules.research`'s five entry points.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

import main
from modules.api import deps as gateway_auth
from modules.research_quota import reset_ask_quota

TOKEN = "pytest-research-gateway-token"

#: One concrete request per research route: (method, url, json body or None).
#:
#: Path parameters are filled with values that reach the handler and come back
#: as a miss rather than a match — the gate is what is under test, and a 404
#: from inside the handler is proof the request got past it.
ROUTES: dict[str, tuple[str, str, dict | None]] = {
    "POST /api/research/rag/search": ("POST", "/api/research/rag/search", {"query": "btcusdt drawdown"}),
    "POST /api/research/rag/ask": ("POST", "/api/research/rag/ask", {"query": "btcusdt drawdown"}),
    "POST /api/research/rag/embed": ("POST", "/api/research/rag/embed", {"texts": ["a sweep card"]}),
    "GET /api/research/rag/status": ("GET", "/api/research/rag/status", None),
    "GET /api/research/graph/communities": ("GET", "/api/research/graph/communities", None),
    "GET /api/research/graph/centrality": ("GET", "/api/research/graph/centrality", None),
    "GET /api/research/graph/{document_id}": (
        "GET", "/api/research/graph/11111111-2222-3333-4444-555555555555", None,
    ),
    "GET /api/research/openbb/health": ("GET", "/api/research/openbb/health", None),
    "GET /api/research/openbb/quote": ("GET", "/api/research/openbb/quote?symbol=BTCUSDT&asset=crypto", None),
    "GET /api/research/openbb/bars": ("GET", "/api/research/openbb/bars?symbol=BTCUSDT&asset=crypto&limit=10", None),
    "GET /api/research/openbb/news": ("GET", "/api/research/openbb/news?symbols=BTCUSDT&limit=1", None),
    "GET /api/research/openbb/fundamentals": ("GET", "/api/research/openbb/fundamentals?symbol=AAPL", None),
    "POST /api/research/ml/fit": ("POST", "/api/research/ml/fit", {"symbol": "BTCUSDT"}),
    "GET /api/research/ml/runs": ("GET", "/api/research/ml/runs", None),
    "GET /api/research/ml/runs/{run_id}": ("GET", "/api/research/ml/runs/not-a-run", None),
    "GET /api/research/diffusion/events": ("GET", "/api/research/diffusion/events?limit=1", None),
    "GET /api/research/diffusion/absorption": ("GET", "/api/research/diffusion/absorption?limit=1", None),
    "GET /api/research/diffusion/findings": ("GET", "/api/research/diffusion/findings", None),
    "POST /api/research/diffusion/events/{source_ref}/stage": (
        "POST", "/api/research/diffusion/events/fed:1970-01-01/stage",
        {"at": "1970-01-01T00:30:00Z"},
    ),
}

#: Driven for the refusal, never for the acceptance. Submitting a fit is a real
#: side effect and the claim here is about the door, not the room.
SIDE_EFFECTING = frozenset({
    "POST /api/research/ml/fit",
    # Records an observed conference-call start against a ledger row.
    "POST /api/research/diffusion/events/{source_ref}/stage",
})


def deployment(monkeypatch, **overrides) -> None:
    """Reconfigure the gateway the way a deployment would, for both readers.

    Two modules on the request path hold their own reference to `settings`:
    `main`, which renders the console, and `modules.api.deps`, where
    `trader_identity` lives. Patching only one binds a name no authenticated
    request consults, and every assertion below would then measure the default
    configuration while staying green — the scar `tests/test_api.py` records.
    """
    patched = replace(main.settings, **overrides)
    monkeypatch.setattr(main, "settings", patched)
    monkeypatch.setattr(gateway_auth, "settings", patched)


@pytest.fixture
def client():
    """No lifespan: no feeds, no bot, no drain task — just the routes."""
    return TestClient(main.app)


@pytest.fixture(autouse=True)
def _fresh_quota():
    """A bucket of its own per test.

    `/ask` is bounded by a process-wide `AskQuota` now, and a burst of five is
    spent by the fifth request in a run. Without this, whether a case here reads
    200 or 429 would depend on how many other tests had asked first — a test
    ordering dependency, which is the failure `conftest._fresh_injected_books`
    was written for.
    """
    reset_ask_quota()
    yield
    reset_ask_quota()


def _published() -> set[str]:
    """Every research route the app publishes, read off its own schema.

    `app.routes` was the rejected reader: this FastAPI version wraps an included
    router in a `_IncludedRouter` whose `path` is None, so walking that list
    finds the four docs routes, three page routes and NOTHING from any router —
    a scan that returns an empty set and passes every set comparison made
    against it. The OpenAPI document is the surface the two client deployments
    actually consume, which makes it the right subject as well as the working
    one.
    """
    return {
        f"{method.upper()} {path}"
        for path, operations in main.app.openapi()["paths"].items()
        if path.startswith("/api/research")
        for method in operations
    }


class TestTheTableIsTheApp:
    def test_the_table_covers_every_research_route_the_app_publishes(self):
        published, declared = _published(), set(ROUTES)
        assert published == declared, (
            "the research auth matrix and the app disagree — "
            f"uncovered routes: {sorted(published - declared)}, "
            f"stale entries: {sorted(declared - published)}"
        )

    def test_the_scan_actually_found_routes(self):
        """A filter that matched nothing would make every assertion above pass."""
        assert len(_published()) >= 12, f"only found {len(_published())} research routes"


class TestResearchRoutesRequireACredential:
    def test_auth_mode_refuses_every_research_route_without_one(self, client, monkeypatch):
        deployment(monkeypatch, require_auth=True, web_api_token=TOKEN)

        for name, (method, url, body) in ROUTES.items():
            response = client.request(method, url, json=body)
            assert response.status_code == 401, f"{name} answered {response.status_code}"
            assert response.json()["error"] == "authentication required", name

    def test_auth_mode_refuses_a_wrong_credential(self, client, monkeypatch):
        """A refusal for the WRONG reason would pass the test above.

        A route that ignored the header entirely and 401'd on something else —
        a missing body, an unparsed path — is indistinguishable there. Presenting
        a bad token separates them: only the dependency says "invalid gateway
        token", and `hmac.compare_digest` is what it says it through.
        """
        deployment(monkeypatch, require_auth=True, web_api_token=TOKEN)
        headers = {"Authorization": "Bearer not-the-configured-token"}

        for name, (method, url, body) in ROUTES.items():
            response = client.request(method, url, json=body, headers=headers)
            assert response.status_code == 401, f"{name} answered {response.status_code}"
            assert response.json()["error"] == "invalid gateway token", name

    def test_auth_mode_accepts_the_bearer_token(self, client, monkeypatch, fake_market_data):
        deployment(monkeypatch, require_auth=True, web_api_token=TOKEN)
        headers = {"Authorization": f"Bearer {TOKEN}"}

        for name, (method, url, body) in ROUTES.items():
            if name in SIDE_EFFECTING:
                continue
            response = client.request(method, url, json=body, headers=headers)
            assert response.status_code != 401, f"{name} refused a valid credential"
            # A handler that raised would also be "not 401", and a green test
            # over a broken route proves the gate and hides the road. 503 is
            # allowed and is not a lapse: the ML store and the graph reads
            # answer "could not" as a status on a deployment with neither
            # configured, which is this codebase's rule rather than an error.
            assert response.status_code != 500, f"{name} answered {response.status_code}"

    def test_auth_mode_accepts_the_dedicated_gateway_header(self, client, monkeypatch):
        """The server-to-server header, which some tunnels rewrite `Authorization` out of.

        One route is enough for this claim: the header is resolved in
        `trader_identity`, which every route above reaches through the same
        `Depends`. Driving all fifteen would be testing FastAPI's dependency
        injection rather than this gateway's.
        """
        deployment(monkeypatch, require_auth=True, web_api_token=TOKEN)

        accepted = client.post(
            "/api/research/rag/search",
            json={"query": "btcusdt drawdown"},
            headers={"X-AlphaEngine-Token": TOKEN},
        )
        assert accepted.status_code == 200
        refused = client.post(
            "/api/research/rag/search",
            json={"query": "btcusdt drawdown"},
            headers={"X-AlphaEngine-Token": "wrong-token"},
        )
        assert refused.status_code == 401


class TestLocalModeStillReachesTheHandlers:
    def test_local_mode_leaves_every_research_route_available(self, client, monkeypatch, fake_market_data):
        """`REQUIRE_AUTH=0` is the developer deployment and must not be broken by the gate."""
        deployment(monkeypatch, require_auth=False)

        for name, (method, url, body) in ROUTES.items():
            if name in SIDE_EFFECTING:
                continue
            response = client.request(method, url, json=body)
            assert response.status_code != 401, f"{name} refused an anonymous caller in local mode"
            assert response.status_code != 500, f"{name} answered {response.status_code}"
