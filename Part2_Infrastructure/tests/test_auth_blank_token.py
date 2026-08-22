"""A blank ``WEB_API_TOKEN`` must authenticate nobody.

`hmac.compare_digest("", "")` is True. That is correct for HMAC and wrong for a
credential check, and the difference is a privilege escalation rather than a
cosmetic one: `trader_identity` returns the actor `web:token` on a match, which
outranks the `web:anonymous` the same request would otherwise receive, so a
gateway whose token is blank hands the HIGHER actor to a caller who presented
nothing.

Blank is reachable without anyone making a mistake in code. `config.py` reads
the value through `_env("WEB_API_TOKEN", "alphaengine-dev-token")`, and
`env_coerce.env` returns `os.getenv(key, default).strip()` — so the default
applies only when the key is ABSENT. `WEB_API_TOKEN=` present-but-empty in a
`.env`, or a CI secret that failed to interpolate, both yield `""`, and both
look like an ordinary deployment.

These tests exist because the guard is one word (`expected and ...`) whose
purpose is invisible from the line itself. Anyone tidying that expression would
delete the whole protection and see a green suite, because every other auth test
configures a real token. `test_api.py` is over the file-length ceiling and on
the ratchet, so this lives in its own file rather than beside its siblings.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

import main
from modules.api import deps as gateway_auth


def deployment(monkeypatch, **overrides) -> None:
    """Reconfigure the gateway the way a deployment would, for both readers.

    Copied deliberately rather than imported from ``test_api``: importing a
    helper out of a sibling test module couples two files whose only relation is
    that they both need this, and pytest collection order would decide whether
    the import works. The reasoning behind patching BOTH readers is recorded at
    ``tests/test_api.py:18`` and holds identically here — ``main`` renders the
    console and ``modules.api.deps`` owns ``trader_identity``, so patching one
    leaves the other reading the real settings and the assertions below would
    measure the default configuration while staying green.
    """
    patched = replace(main.settings, **overrides)
    monkeypatch.setattr(main, "settings", patched)
    monkeypatch.setattr(gateway_auth, "settings", patched)


@pytest.fixture()
def client() -> TestClient:
    with TestClient(main.app) as test_client:
        yield test_client


class TestBlankGatewayToken:
    """A configured token of "" is not a credential, it is the absence of one."""

    @pytest.mark.parametrize(
        "header",
        [
            pytest.param({"X-AlphaEngine-Token": ""}, id="dedicated-header-empty"),
            pytest.param({"Authorization": "Bearer "}, id="bearer-empty"),
            pytest.param({"Authorization": "Bearer    "}, id="bearer-whitespace"),
        ],
    )
    def test_blank_token_rejects_blank_credential(self, client, monkeypatch, header):
        """The exact escalation: empty config, empty header, 401 not 200.

        Both header forms are covered because ``trader_identity`` normalises them
        to the same ``presented`` string — the dedicated header first, then
        ``Authorization``, both ``.strip()``ed — so a fix applied to one path and
        not the other would still ship the hole. The whitespace bearer is here
        because ``.strip()`` turns "Bearer    " into "" too, and that is the form
        a hand-edited curl or a templated header most easily produces.
        """
        deployment(monkeypatch, require_auth=True, web_api_token="")

        response = client.get("/api/portfolio", headers=header)

        assert response.status_code == 401, (
            "a gateway with a blank WEB_API_TOKEN authenticated an empty credential; "
            "hmac.compare_digest('', '') is True, so the emptiness guard in "
            "modules/api/deps.py is the only thing standing between a blank "
            "deployment variable and the web:token actor"
        )

    def test_blank_token_still_rejects_a_guessed_credential(self, client, monkeypatch):
        """A blank config must not become a wildcard in the other direction either.

        Asserted separately because a careless fix — comparing only when the
        PRESENTED value is non-empty — would pass the test above and still let
        any non-empty guess through against a blank configured token.
        """
        deployment(monkeypatch, require_auth=True, web_api_token="")

        response = client.get(
            "/api/portfolio",
            headers={"X-AlphaEngine-Token": "alphaengine-dev-token"},
        )

        assert response.status_code == 401
        assert response.json()["error"] == "invalid gateway token"

    def test_a_real_token_is_unaffected(self, client, monkeypatch):
        """The guard must not have cost the feature it protects.

        Without this, deleting the whole comparison would satisfy both tests
        above — every credential rejected is trivially a credential not leaked.
        """
        token = "pytest-blank-token-control"
        deployment(monkeypatch, require_auth=True, web_api_token=token)

        assert client.get("/api/portfolio", headers={"X-AlphaEngine-Token": token}).status_code == 200
        assert client.get("/api/portfolio", headers={"Authorization": f"Bearer {token}"}).status_code == 200
        assert client.get("/api/portfolio", headers={"X-AlphaEngine-Token": "wrong"}).status_code == 401
