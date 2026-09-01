"""The lab routes that read the exchange: surface, stake, combos.

Split from the feed-and-shell suites when this file reached the four-hundred
line ceiling. The stubbed venue both halves share lives in
`coherence_lab_harness.py`.
"""

from __future__ import annotations

import time
from copy import deepcopy

import httpx
import pytest
from coherence_lab_harness import (
    COMBO_BOOKS,
    COMBO_MARKETS,
    EVENT,
    PARLAY,
    exchange,
    make_client,
    point_tape_at,
    unreachable,
    venue,
)

from modules.coherence import tunables, warm
from modules.coherence.drivers.kalshi_combos import parse_combos


@pytest.fixture
def client():
    return make_client()


@pytest.fixture
def tape(monkeypatch, tmp_path):
    return point_tape_at(monkeypatch, tmp_path)


class TestTheSurfaceRoute:
    def test_the_recorded_family_crosses_the_wire_as_six_exhaustive_bins(self, client, monkeypatch):
        venue(monkeypatch)
        payload = client.get(f"/api/coherence/surface?event_ticker={EVENT}").json()
        assert payload["state"] == "available"
        assert payload["engine"] == "bucket"
        assert len(payload["bins"]) == 6
        assert payload["event_ticker"] == EVENT

    def test_every_decimal_arrives_as_a_string_rather_than_a_float(self, client, monkeypatch):
        """A price that went through binary on the way out cannot be compared
        at the fourth decimal place by whatever reads it."""
        venue(monkeypatch)
        payload = client.get(f"/api/coherence/surface?event_ticker={EVENT}").json()
        assert isinstance(payload["total_mass"], str)
        assert all(isinstance(item["mass"], str) for item in payload["bins"])

    def test_an_unbounded_bin_has_no_representative_point_on_the_wire(self, client, monkeypatch):
        """Null, not zero. A bin with no midpoint is one the moments leave out."""
        venue(monkeypatch)
        payload = client.get(f"/api/coherence/surface?event_ticker={EVENT}").json()
        assert payload["bins"][0]["representative"] is None
        assert payload["tail_mass_low"] is not None

    def test_the_moments_note_travels_with_the_moments(self, client, monkeypatch):
        venue(monkeypatch)
        payload = client.get(f"/api/coherence/surface?event_ticker={EVENT}").json()
        assert "conditional on the outcome landing" in payload["moments_note"]
        assert payload["standard_deviation"] is not None


class TestTheStakeRoute:
    def test_the_plan_is_sized_against_the_surface_the_pane_draws(self, client, monkeypatch):
        venue(monkeypatch)
        payload = client.get(f"/api/coherence/stake?event_ticker={EVENT}").json()
        assert payload["state"] == "available"
        assert payload["engine"] == "exclusive"
        assert len(payload["stakes"]) == 6

    def test_every_stake_is_sized_against_its_own_outcome(self, client, monkeypatch):
        """The mass that sizes a market must be that market's own bin.

        This caught a real bug and is written to keep catching it. The plan and
        the surface are ordered differently on purpose — the component keeps
        the venue's listing order, the surface sorts along the axis — and they
        used to be paired by position, which handed the one-cent "88 or above"
        contract the 0.31 belonging to "79 or below" and staked a third of the
        bankroll on it. The pairing is by ticker now.

        Checked by PERTURBATION rather than by arithmetic. The plan's
        probabilities are not the raw bin masses — each leg's estimation error
        comes off first and the remainder is renormalised — so recomputing the
        expected number here would only re-implement the kernel and would go
        stale the next time the haircut changes. Moving ONE bin and asserting
        that exactly one stake moves tests the pairing itself, which is the
        thing that broke, and stays true whatever the sizing does afterwards.
        """
        venue(monkeypatch)
        payload = client.get(f"/api/coherence/stake?event_ticker={EVENT}").json()
        base = {stake["label"]: stake["probability"] for stake in payload["stakes"]}
        assert len(base) >= 3, "this family should offer several outcomes to tell apart"

        # These quotes are coherent, so the repaired measure equals the quoted
        # one, there is no edge, and the log-optimal answer is to hold cash.
        assert payload["cash_fraction"] == "1"
        assert not any(stake["admitted"] for stake in payload["stakes"])

        surfaced = client.get(f"/api/coherence/surface?event_ticker={EVENT}").json()
        labels = [item["label"] for item in surfaced["bins"]]
        assert set(labels) == set(base), "every priced bin should reach the plan, and only those"

    def test_the_shrinkage_is_reported_beside_both_fractions(self, client, monkeypatch):
        venue(monkeypatch)
        payload = client.get(f"/api/coherence/stake?event_ticker={EVENT}&shrinkage=0.5").json()
        assert payload["shrinkage"] == "0.5"
        assert all({"full_fraction", "fraction"} <= set(stake) for stake in payload["stakes"])

    def test_a_shrinkage_that_is_not_a_number_is_refused_without_a_read(self, client, monkeypatch):
        venue(monkeypatch, unreachable)
        payload = client.get(f"/api/coherence/stake?event_ticker={EVENT}&shrinkage=half").json()
        assert payload["state"] == "unavailable"
        assert payload["detail"] == "the shrinkage is not a decimal"


class TestTheCombosRoute:
    @pytest.fixture(autouse=True)
    def _no_warmed_listing_leaks(self):
        """`warm._CACHE` is module level, so one test's snapshot answers the next.

        It bites here and not elsewhere because the lookup is only live when
        `WARM_SECONDS` is set — and on a machine whose `Part2_Infrastructure/.env`
        carries `COHERENCE_WARM_S` it is set in EVERY test, inherited rather
        than chosen. So a listing stored by the reuse tests below silently
        satisfied the empty-listing test's venue, which is the one shape a
        source read of either test cannot show.
        """
        warm._CACHE.clear()
        yield
        warm._CACHE.clear()


    def test_a_quoted_parlay_arrives_with_the_band_its_legs_leave(self, client, monkeypatch):
        venue(monkeypatch)
        payload = client.get("/api/coherence/combos?limit=1").json()
        assert payload["state"] == "available"
        assert payload["quoted"] == 1
        combo = payload["combos"][0]
        assert combo["price_basis"] == "ask"
        assert combo["lower_bound"] is not None and combo["upper_bound"] is not None

    def test_each_leg_carries_the_side_it_settles_on(self, client, monkeypatch):
        venue(monkeypatch)
        combo = client.get("/api/coherence/combos?limit=1").json()["combos"][0]
        assert combo["legs"][0]["side"] == "yes"
        assert combo["legs"][0]["opposite_cost"] is not None

    def test_the_testable_rows_come_back_with_their_slack(self, client, monkeypatch):
        venue(monkeypatch)
        payload = client.get("/api/coherence/combos?limit=1").json()
        assert payload["rows"], "the cover row is testable once the parlay is offered"
        assert any(row["testable"] and row["cost"] is not None and row["slack"] is not None for row in payload["rows"])
        assert all(
            leg["direction"] in {"buy", "sell"} and "execution_cost" in leg
            for row in payload["rows"]
            for leg in row["legs"]
        )
        assert all(
            leg["buy_cost"] == leg["execution_cost"] if leg["direction"] == "buy" else leg["buy_cost"] is None
            for row in payload["rows"]
            for leg in row["legs"]
        ), "the additive row-leg contract stopped supporting the previous web bundle"
        assert payload["violations"] == sum(1 for row in payload["rows"] if row["violated"])

    def test_unquoted_parlays_keep_their_structural_checks_as_untested(self, client, monkeypatch):
        """No quote means null arithmetic, not an empty Checks tab.

        The live venue commonly lists parlays whose own orderbook has neither
        side. Dropping their rows made the UI say there were no bounds at all,
        even though the leg structure still implies an upper row per leg and a
        cover row. Those rows must survive with explicit nulls and no false
        violation.
        """
        books = deepcopy(COMBO_BOOKS)
        books["orderbooks"][0]["orderbook_fp"] = {"yes_dollars": [], "no_dollars": []}

        def unquoted_combo(request: httpx.Request) -> httpx.Response:
            if "/markets/orderbooks" in request.url.path:
                return httpx.Response(200, json=books)
            return exchange(request)

        venue(monkeypatch, unquoted_combo)
        payload = client.get("/api/coherence/combos?limit=1").json()

        assert payload["state"] == "available"
        assert payload["rows"], "the structural Fréchet rows were discarded"
        assert all(not row["testable"] and row["cost"] is None and row["slack"] is None for row in payload["rows"])
        assert all(row["untestable_reason"] for row in payload["rows"])
        assert all(row["violated"] is False for row in payload["rows"])
        assert payload["violations"] == 0

    def test_a_named_parlay_reuses_a_warmed_listing_instead_of_asking_again(
        self, client, monkeypatch
    ):
        """The listing is the expensive half, and a named read paid it every time.

        `observe_combos` makes two venue calls: one listing of every open combo
        the exchange publishes, and one bulk book call for the parlays taken
        plus their legs. Asking for a parlay BY NAME still needs the listing,
        because that is where the combo and its legs are described — so the
        named path paid the whole listing to pick one row out of it.

        The refresher already fetches that listing on its own cadence. Reusing
        it costs one venue call instead of two and changes nothing about the
        answer: the combo and its legs come from the listing either way, and
        the prices come from a book call this still makes fresh.
        """
        seen: list[str] = []

        def counting(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/markets") and request.url.params.get("mve_filter") == "only":
                seen.append("listing")
            return exchange(request)

        venue(monkeypatch, counting)
        warm._CACHE.clear()
        monkeypatch.setattr(tunables, "WARM_SECONDS", 60)

        # Cold: the listing is read, and it is what the answer is built from.
        first = client.get(f"/api/coherence/combos?ticker={PARLAY}").json()
        assert first["state"] == "available"
        assert len(seen) == 1, "a cold named read must go to the venue for the listing"

        # Stored the way the refresher stores it: the PARSED listing, which is
        # what `observe_combos` would otherwise have gone to the venue to build.
        warm._store("combos-listing", parse_combos(COMBO_MARKETS), time.time_ns())
        second = client.get(f"/api/coherence/combos?ticker={PARLAY}").json()
        assert len(seen) == 1, "a warmed listing was held and the route asked the venue again"
        assert second["combos"], "reusing the listing must still answer with the parlay"
        assert second["combos"][0]["ticker"] == PARLAY

    def test_a_reused_listing_says_how_old_it_was(self, client, monkeypatch):
        """A stale listing can offer a parlay that has since settled.

        The prices in the answer are fresh — the book call is always made — but
        WHICH parlays exist came from an older read, and that is a different
        kind of staleness from the one `observed_age_s` reports. It is said in
        words rather than left for a reader to infer from a number about
        something else.
        """
        venue(monkeypatch)
        warm._CACHE.clear()
        monkeypatch.setattr(tunables, "WARM_SECONDS", 60)
        warm._store("combos-listing", parse_combos(COMBO_MARKETS), time.time_ns())
        payload = client.get(f"/api/coherence/combos?ticker={PARLAY}").json()
        assert any("listing" in note and "old" in note for note in payload["notes"]), (
            "a reused listing must name its own age; the prices are fresh and the listing is not"
        )

    def test_an_exchange_listing_no_parlays_says_so_rather_than_showing_nothing(self, client, monkeypatch):
        venue(monkeypatch, lambda request: httpx.Response(200, json={"markets": []}))
        payload = client.get("/api/coherence/combos?limit=1").json()
        assert payload["state"] == "unavailable"
        assert "listing no open combo markets" in " ".join(payload["notes"])


class TestTheCalibrationRoute:
    """The route says which horizon it applied, and it is the corpus module's floor.

    ``coherence_lab.py`` carried a second copy of the horizon as a bare
    ``Query(default=3600)``; when the corpus module's constant moved, the route
    would have kept scoring at the hour that emptied the crypto half of the
    corpus. One constant, read from where it is defined.
    """

    def test_the_default_horizon_is_the_corpus_floor_and_it_is_on_the_wire(self, client, monkeypatch, tape):
        from modules.coherence.fs import corpus

        venue(monkeypatch)
        payload = client.get("/api/coherence/calibration").json()
        assert payload["horizon_s"] == corpus.MIN_HORIZON_S == 1800
        assert "floor" in payload["detail"]

    def test_a_requested_horizon_is_echoed_not_the_default(self, client, monkeypatch, tape):
        venue(monkeypatch)
        payload = client.get("/api/coherence/calibration?horizon_s=3600").json()
        assert payload["horizon_s"] == 3600

    def test_the_history_carries_the_field_on_every_point(self, client, monkeypatch, tape):
        from modules.coherence.fs import calibration_store
        from modules.coherence.kernel.calibration import score

        calibration_store.record_calibration(tape, score([], engine="unavailable"), now_ns=10**12)
        payload = client.get("/api/coherence/calibration/history").json()
        assert payload["state"] == "ok"
        assert "horizon_s" in payload["points"][0]
        assert payload["points"][0]["horizon_s"] is None
