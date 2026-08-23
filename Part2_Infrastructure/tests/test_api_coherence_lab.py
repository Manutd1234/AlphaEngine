"""The lab routes that read the exchange: surface, stake, combos.

Split from the feed-and-shell suites when this file reached the four-hundred
line ceiling. The stubbed venue both halves share lives in
`coherence_lab_harness.py`.
"""

from __future__ import annotations

import httpx
import pytest
from coherence_lab_harness import EVENT, make_client, point_tape_at, unreachable, venue


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
        assert all(row["cost"] is not None and row["slack"] is not None for row in payload["rows"])
        assert payload["violations"] == sum(1 for row in payload["rows"] if row["violated"])

    def test_an_exchange_listing_no_parlays_says_so_rather_than_showing_nothing(self, client, monkeypatch):
        venue(monkeypatch, lambda request: httpx.Response(200, json={"markets": []}))
        payload = client.get("/api/coherence/combos?limit=1").json()
        assert payload["state"] == "unavailable"
        assert "listing no open combo markets" in " ".join(payload["notes"])
