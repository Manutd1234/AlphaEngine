"""Lesson 3: the structure comes from the exchange, never from the words.

Two claims are load-bearing and both are tested against payloads Kalshi actually
sent: mutual exclusivity is a flag rather than an inference, and the state space
follows that flag rather than the strikes.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from coherence_fixtures import body, markets

from modules.coherence.drivers.kalshi_parse import Event, parse_event, parse_market
from modules.coherence.kernel.lattice import build_component
from modules.coherence.kernel.states import build_states


def _ladder_event(mutually_exclusive: bool = True) -> Event:
    rows = [parse_market(row) for row in markets("markets_ladder")]
    return Event(
        event_ticker="KXHIGHNY-26AUG23",
        series_ticker="KXHIGHNY",
        title="Highest temperature in NYC today",
        mutually_exclusive=mutually_exclusive,
        exchange_index=0,
        settlement_sources=("The Weather Company",),
        markets=tuple(rows),
    )


def _crypto_event() -> Event:
    rows = [parse_market(row) for row in markets("markets_crypto")]
    first = rows[0].event_ticker
    same = [row for row in rows if row.event_ticker == first]
    return Event(
        event_ticker=first,
        series_ticker="KXBTCD",
        title="Bitcoin price",
        mutually_exclusive=False,
        exchange_index=0,
        settlement_sources=("CF Benchmarks",),
        markets=tuple(same),
    )


class TestTheStructure:
    def test_a_threshold_ladder_becomes_a_chain_of_implications(self):
        """59 edges for 60 strikes: adjacent pairs only, because it is transitive."""
        component = build_component(_crypto_event())
        implications = [edge for edge in component.edges if edge.kind == "implies"]
        assert len(component.nodes) > 20
        assert len(implications) == len(component.nodes) - 1

    def test_each_implication_carries_the_sentence_it_will_print(self):
        component = build_component(_crypto_event())
        edge = next(edge for edge in component.edges if edge.kind == "implies")
        assert "cannot exceed" in edge.because
        assert str(edge.because).strip()

    def test_a_mutually_exclusive_event_gets_the_exclusivity_edge(self):
        component = build_component(parse_event(body("event_mee")))
        assert any(edge.kind == "exclusive" for edge in component.edges)

    def test_an_event_without_the_flag_says_its_prices_need_not_sum(self):
        """The claim is the venue's to make; we do not infer it from strikes."""
        component = build_component(_ladder_event(mutually_exclusive=False))
        assert not any(edge.kind == "exclusive" for edge in component.edges)
        assert any("not required to sum" in note for note in component.notes)

    def test_intra_event_structure_is_always_same_shard(self):
        """Kalshi guarantees an event's children share an exchange instance."""
        component = build_component(_ladder_event())
        assert component.scope == "same-event"

    def test_closed_markets_are_left_out_rather_than_priced_at_their_last_quote(self):
        rows = [parse_market(row) for row in markets("markets_ladder")]
        stale = replace(rows[0], status="settled")
        event = Event(
            event_ticker="X", series_ticker="X", title="", mutually_exclusive=True,
            exchange_index=0, settlement_sources=(), markets=(stale, *rows[1:]),
        )
        component = build_component(event)
        assert len(component.nodes) == len(rows) - 1
        assert any("not active" in note for note in component.notes)


class TestTheStateSpace:
    def test_a_named_family_gets_one_state_per_outcome(self):
        space = build_states(build_component(parse_event(body("event_mee"))))
        assert len(space.states) == len(space.tickers)
        assert space.exhaustive

    def test_the_exclusivity_flag_beats_the_strikes(self):
        """The bug this ordering fixes, kept as a test.

        Cutting the NYC family at its strikes gives nine intervals for six
        markets, and three of them — 81 to 82, 83 to 84, 85 to 86 — no market
        pays in, because the underlying is whole degrees. Treated as reachable
        states they would say the basket does not pay a dollar in every future,
        and the additive constraint would quietly stop applying to a family the
        exchange itself declares exhaustive.
        """
        space = build_states(build_component(_ladder_event(mutually_exclusive=True)))
        assert len(space.states) == 6
        payers = [sum(space.payoff[i][j] for i in range(len(space.tickers))) for j in range(len(space.states))]
        assert payers == [1] * 6, "every state must have exactly one payer for the basket to pay a dollar"

    def test_without_the_flag_the_strikes_are_used_and_the_gaps_appear(self):
        """And they are real: the intervals are our inference, not the venue's."""
        space = build_states(build_component(_ladder_event(mutually_exclusive=False)))
        assert len(space.states) > 6
        payers = [sum(space.payoff[i][j] for i in range(len(space.tickers))) for j in range(len(space.states))]
        assert 0 in payers

    def test_a_threshold_pays_in_every_state_above_its_strike(self):
        space = build_states(build_component(_crypto_event()))
        assert space.exhaustive
        for row in space.payoff:
            # Monotone in the state index: once a threshold starts paying it
            # keeps paying, which is what makes it a survival function.
            switched = False
            for value in row:
                if value:
                    switched = True
                elif switched:
                    raise AssertionError("a threshold stopped paying in a higher state")

    def test_an_unrelatable_family_reports_why_rather_than_inventing_states(self):
        rows = [parse_market(row) for row in markets("markets_ladder")]
        named = [replace(row, strike_kind="custom", floor_strike=None, cap_strike=None) for row in rows]
        event = Event(
            event_ticker="X", series_ticker="X", title="", mutually_exclusive=False,
            exchange_index=0, settlement_sources=(), markets=tuple(named),
        )
        space = build_states(build_component(event))
        assert space.is_empty
        assert "not mutually exclusive" in space.note


def test_settlement_sources_are_what_make_two_markets_the_same_payoff():
    """Not titles. A hedge across two sources is not a hedge on the day they differ."""
    component = build_component(parse_event(body("event_mee")))
    assert all(node.settlement_sources for node in component.nodes)
    assert len({node.settlement_sources for node in component.nodes}) == 1
    assert not any("do not all share a settlement source" in note for note in component.notes)


def test_strikes_never_pass_through_float():
    component = build_component(_crypto_event())
    for node in component.nodes:
        if node.floor_strike is not None:
            assert isinstance(node.floor_strike, Decimal)
