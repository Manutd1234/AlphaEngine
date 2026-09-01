"""The lab routes that read a feed, a corpus or the tree: calibration,
settlement, RFQ, shell — and what every route does when the venue is down.

Split from the exchange-reading suites when that file reached the four-hundred
line ceiling. The stubbed venue both halves share lives in
`coherence_lab_harness.py`.
"""

from __future__ import annotations

import httpx
import pytest
from coherence_lab_harness import EVENT, make_client, point_tape_at, unreachable, venue

from modules.api import coherence_lab as lab
from modules.coherence import tunables
from modules.coherence.drivers import kalshi_auth
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.fs.store import TapeUnavailable
from modules.coherence.scheduler.budget import ReadBudget


@pytest.fixture
def client():
    return make_client()


@pytest.fixture
def tape(monkeypatch, tmp_path):
    return point_tape_at(monkeypatch, tmp_path)


class TestTheCalibrationRoute:
    def test_a_harvest_scores_the_settled_markets_it_read(self, client, monkeypatch, tape):
        venue(monkeypatch)
        payload = client.get("/api/coherence/calibration?harvest=true").json()
        assert payload["state"] == "available"
        assert payload["engine"] == "final_trade"
        assert payload["count"] == 12
        assert len(payload["bins"]) == 10

    def test_the_engine_name_says_these_are_last_trades_not_forecasts(self, client, monkeypatch, tape):
        venue(monkeypatch)
        payload = client.get("/api/coherence/calibration?harvest=true").json()
        assert "scores the exchange's convergence, not its foresight" in payload["detail"]

    def test_an_unquoted_band_arrives_as_null_rather_than_zero(self, client, monkeypatch, tape):
        venue(monkeypatch)
        payload = client.get("/api/coherence/calibration?harvest=true").json()
        empty = [band for band in payload["bins"] if band["count"] == 0]
        assert empty
        assert all(band["mean_forecast"] is None and band["deviation"] is None for band in empty)

    def test_an_empty_tape_scored_without_a_harvest_is_unavailable(self, client, monkeypatch, tape):
        venue(monkeypatch)
        payload = client.get("/api/coherence/calibration?harvest=false").json()
        assert payload["state"] == "unavailable"
        assert payload["brier"] is None

    def test_a_tape_that_cannot_be_opened_is_reported_rather_than_raised(self, client, monkeypatch):
        def refuse():
            raise TapeUnavailable("the tape could not be opened here")

        monkeypatch.setattr(lab, "get_store", refuse)
        payload = client.get("/api/coherence/calibration?harvest=false").json()
        assert payload["state"] == "unavailable"
        assert "could not be opened" in payload["detail"]


class TestTheSettlementRoute:
    def test_the_published_index_arrives_whole_with_its_quality_control(self, client, monkeypatch):
        venue(monkeypatch)
        payload = client.get("/api/coherence/settlement?city=miami").json()
        assert payload["state"] == "available"
        assert payload["sample_count"] == 1435
        assert payload["degraded_samples"] == 2
        assert (payload["contributors_min"], payload["contributors_max"]) == (5, 5)

    def test_the_gap_between_the_print_and_the_window_is_the_number_on_offer(self, client, monkeypatch):
        venue(monkeypatch)
        payload = client.get("/api/coherence/settlement?city=miami").json()
        assert payload["latest_value"] == "88.52"
        assert payload["window_average"] == "87.812"
        assert payload["spot_minus_window"] == "0.708"
        assert payload["window_minutes"] == 60

    def test_the_reference_rate_is_a_state_beside_the_feed_rather_than_a_failure(self, client, monkeypatch):
        venue(monkeypatch)
        payload = client.get("/api/coherence/settlement?city=miami").json()
        assert payload["reference_rate_state"] == "entitlement_required"
        assert "entitlement" in payload["reference_rate_detail"]

    def test_a_city_the_venue_refuses_returns_a_state_and_no_samples(self, client, monkeypatch):
        venue(monkeypatch, lambda request: httpx.Response(400, json={"error": "weather covers: miami"}))
        response = client.get("/api/coherence/settlement?city=chicago")
        assert response.status_code == 200
        payload = response.json()
        assert payload["state"] != "available"
        assert payload["samples"] == [] and payload["sample_count"] == 0


class TestTheRfqRoute:
    def test_an_unsigned_deployment_reports_no_view_rather_than_an_empty_one(self, client):
        payload = client.get("/api/coherence/rfq").json()
        assert payload["state"] == "signing_unavailable"
        assert "KALSHI_DEMO_KEY_ID" in payload["detail"]
        assert "Public market reads remain available" in payload["detail"]
        assert payload["dispersions"] == []

    def test_a_signed_read_of_a_quiet_sandbox_is_empty_rather_than_refused(self, client, monkeypatch):
        venue(monkeypatch)
        monkeypatch.setattr(lab, "signing_available", lambda: True)
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "a-demo-key")
        payload = client.get("/api/coherence/rfq").json()
        assert payload["state"] == "empty"
        assert "makers do not quote a sandbox" in payload["detail"]

    def test_a_refused_channel_is_a_refusal_and_not_an_empty_market(self, client, monkeypatch):
        venue(monkeypatch, lambda request: httpx.Response(401, json={"error": "signed only"}))
        monkeypatch.setattr(lab, "signing_available", lambda: True)
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "a-demo-key")
        payload = client.get("/api/coherence/rfq").json()
        assert payload["state"] == "refused"
        assert payload["open_requests"] == 0

    def test_a_crypto_signing_error_returns_a_typed_state_not_a_500(self, client, monkeypatch):
        class BrokenRsaKey:
            def sign(self, *_args, **_kwargs):
                raise TypeError("test-only crypto detail")

        transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={}))

        def signed_client(*_args, **_kwargs):
            return KalshiClient(
                base_url=tunables.DEMO_BASE_URL,
                failover_url="",
                signed=True,
                transport=transport,
                budget=ReadBudget(),
            )

        monkeypatch.setattr(lab, "KalshiClient", signed_client)
        monkeypatch.setattr(lab, "signing_available", lambda: True)
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "a-demo-key")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", "/configured/do-not-disclose.pem")
        monkeypatch.setattr(kalshi_auth, "_load_key", lambda _path: BrokenRsaKey())

        response = client.get("/api/coherence/rfq")

        assert response.status_code == 200
        assert response.json()["state"] == "signing_unavailable"
        assert "could not sign" in response.json()["detail"]
        assert "do-not-disclose.pem" not in response.json()["detail"]
        assert "test-only crypto detail" not in response.json()["detail"]


class TestTheShellRoute:
    def test_an_empty_watchlist_is_reported_as_such_rather_than_as_an_empty_tree(self, client, monkeypatch):
        venue(monkeypatch)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ())
        payload = client.get("/api/coherence/shell?path=/&command=ls").json()
        assert payload["state"] == "unavailable"
        assert payload["exists"] is False
        assert "COHERENCE_SERIES sets" in payload["detail"]

    def test_an_ls_of_the_root_lists_the_shards_it_watches(self, client, monkeypatch):
        venue(monkeypatch)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXHIGHNY",))
        payload = client.get("/api/coherence/shell?path=/&command=ls").json()
        assert payload["state"] == "available"
        assert payload["command"] == "ls"
        assert [entry["name"] for entry in payload["entries"]] == ["0"]

    def test_a_cat_returns_a_body_and_no_entries(self, client, monkeypatch):
        venue(monkeypatch)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXHIGHNY",))
        path = f"/shards/0/KXHIGHNY/{EVENT}/implied_pmf"
        payload = client.get(f"/api/coherence/shell?path={path}&command=cat").json()
        assert payload["state"] == "ok"
        assert payload["entries"] == []
        assert "interval" in payload["body"]

    def test_a_native_market_cat_returns_its_live_quotes_and_metadata(self, client, monkeypatch):
        venue(monkeypatch)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXHIGHNY",))
        event_path = f"/shards/0/KXHIGHNY/{EVENT}"
        listing = client.get(
            "/api/coherence/shell", params={"path": event_path, "command": "ls"},
        ).json()
        market = listing["entries"][0]["name"]

        payload = client.get(
            "/api/coherence/shell", params={"path": f"{event_path}/{market}", "command": "cat"},
        ).json()

        assert payload["state"] == "ok"
        assert f"ticker            {market}" in payload["body"]
        assert "top of book (dollars)" in payload["body"]
        assert payload["detail"].startswith("native contract;")

    def test_a_cat_of_a_file_that_is_not_there_is_missing_and_says_so(self, client, monkeypatch):
        venue(monkeypatch)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXHIGHNY",))
        path = f"/shards/0/KXHIGHNY/{EVENT}/implied_cdf"
        payload = client.get(f"/api/coherence/shell?path={path}&command=cat").json()
        assert payload["state"] == "missing"
        assert payload["exists"] is False

    def test_a_certificate_cannot_be_solved_below_a_false_parent(self, client, monkeypatch):
        venue(monkeypatch)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXHIGHNY",))

        async def schedule_must_not_run(*_args, **_kwargs):
            pytest.fail("a false namespace path reached certificate work")

        monkeypatch.setattr(lab.fee_meta, "schedule_for_event", schedule_must_not_run)
        for path in (
            f"/shards/9/KXHIGHNY/{EVENT}/certificate",
            f"/shards/0/KXNOTREAL/{EVENT}/certificate",
        ):
            payload = client.get(
                "/api/coherence/shell", params={"path": path, "command": "cat"},
            ).json()
            assert payload["state"] == "missing"
            assert payload["exists"] is False
            assert "is not a watched event at" in payload["detail"]

    def test_a_partial_watchlist_read_cannot_be_mislabeled_as_a_missing_path(self, client, monkeypatch):
        path = "/shards/1/REFUSED/REFUSED-EVENT/implied_pmf"
        calls = []

        async def partial_read(_client, series, **kwargs):
            calls.append(kwargs)
            if series == "REFUSED":
                raise KalshiUnavailable("read budget exhausted before /markets")
            return [object()]

        monkeypatch.setattr(lab, "observe_series", partial_read)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("GOOD", "REFUSED"))

        response = client.get("/api/coherence/shell", params={"path": path, "command": "cat"})
        payload = response.json()

        assert response.status_code == 200
        assert payload["state"] == "unavailable"
        assert payload["path"] == path and payload["command"] == "cat"
        assert payload["exists"] is True
        assert payload["entries"] == [] and payload["body"] == ""
        assert "REFUSED: read budget exhausted" in payload["detail"]
        assert "not a statement about the path" in payload["detail"]
        assert "not a watched event" not in payload["detail"]
        assert all(call == {
            "max_events": tunables.SHELL_MAX_EVENTS_PER_SERIES,
            "require_complete": True,
        } for call in calls)

    def test_only_ls_and_cat_are_commands(self, client, monkeypatch):
        venue(monkeypatch)
        assert client.get("/api/coherence/shell?path=/&command=rm").status_code == 422


class TestWhenTheVenueCannotBeReached:
    """Seven routes, one dead socket. None of them may answer with a 500."""

    ROUTES = (
        f"/api/coherence/surface?event_ticker={EVENT}",
        f"/api/coherence/stake?event_ticker={EVENT}",
        "/api/coherence/combos?limit=1",
        "/api/coherence/calibration?harvest=true",
        "/api/coherence/settlement?city=miami",
        "/api/coherence/rfq",
        "/api/coherence/shell?path=/&command=ls",
    )

    @pytest.mark.parametrize("url", ROUTES)
    def test_the_route_answers_two_hundred_with_a_state(self, client, monkeypatch, tape, url):
        venue(monkeypatch, unreachable)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXHIGHNY",))
        response = client.get(url)
        assert response.status_code == 200, f"{url} answered {response.status_code}"
        assert response.json()["state"], f"{url} answered without a state"

    @pytest.mark.parametrize("url", ROUTES)
    def test_and_never_claims_a_reading_it_does_not_have(self, client, monkeypatch, tape, url):
        venue(monkeypatch, unreachable)
        monkeypatch.setattr(tunables, "SERIES_WATCHLIST", ("KXHIGHNY",))
        payload = client.get(url).json()
        assert payload["state"] != "available", f"{url} reported a reading with no venue behind it"
        said = payload.get("detail") or " ".join(payload.get("notes") or [])
        assert said, f"{url} reported a state with no reason attached to it"
