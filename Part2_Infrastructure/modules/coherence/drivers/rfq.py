"""Request-for-quote: the only place the exchange reveals what makers disagree about.

An order book shows one number — the best bid — and that number is the *most
aggressive* opinion on the book, not the typical one. For a combo there is
usually no book at all: the eight-leg parlays sit unquoted, so the public tape
says nothing about how the market prices the dependence between their legs.

The RFQ channel says something. A taker asks for a market in a specific combo;
several makers answer privately with two-sided quotes; each answer is one
professional's estimate of a joint probability, arrived at independently. The
spread *between* those answers is a quantity nothing else on the venue exposes.
It is not liquidity and it is not a bid-offer — it is disagreement, and it is
the empirical counterpart to the Fréchet band in ``kernel/frechet.py``: the band
says how much room the legs leave, and the quote dispersion says how much of
that room the people who price it for a living actually use.

**Reading the channel requires signing, and this engine reads it on demo.** The
endpoints answer 401 to a keyless call. That is not a degradation to route
around — an unsigned RFQ read is not a worse view of the market, it is no view —
so the state model here distinguishes four things that a single ``None`` would
flatten:

``signing_unavailable``   no key configured, or ``cryptography`` not installed
``refused``               signed and rejected — wrong key, wrong host, wrong env
``unavailable``           the channel could not be reached at all: a dead socket,
                          a 503, an exhausted read budget. Worth retrying, unlike
                          a refusal, and about the network rather than the key
``empty``                 read successfully; the demo environment has no RFQs open
``available``             quotes in hand

``empty`` is the expected state on demo most of the time, and it is reported as
a fact about the sandbox rather than dressed up as a quiet market. A dispersion
computed from one maker is not a dispersion, so a single-quote RFQ reports its
count and declines to produce a spread.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, Sequence

from modules.coherence.drivers.kalshi_auth import SigningUnavailable
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiRefused, KalshiUnavailable
from modules.coherence.kernel.money import DOLLAR, one_minus

State = Literal["available", "empty", "refused", "unavailable", "signing_unavailable"]

#: Below this many independent makers a spread is an anecdote. Reported anyway,
#: flagged as thin, because two disagreeing makers is still more than the public
#: book shows for a combo — which is nothing.
THIN_PANEL = 3


def _decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


#: Quote states that still represent a maker's live opinion. Anything else —
#: cancelled, executed, expired — was a view at some past moment, and averaging
#: those into a panel measures history rather than disagreement now.
LIVE_QUOTE_STATES = {"open", "active", "live", ""}


@dataclass(frozen=True, slots=True)
class Quote:
    """One maker's two-sided answer, as an interval on the joint probability.

    Kalshi quotes both sides as bids, so a maker who bids 0.31 for YES and 0.63
    for NO is saying "I will pay 0.31" and "I will pay 0.63 for the other side",
    which brackets their estimate between 0.31 and 0.37. The midpoint is the
    estimate; the width is that maker's own uncertainty and inventory charge,
    and the two are not the same thing as the disagreement across makers.
    """

    quote_id: str
    rfq_id: str
    market_ticker: str
    yes_bid: Decimal | None
    no_bid: Decimal | None
    created_ts: str
    status: str = ""

    @property
    def live(self) -> bool:
        return self.status.strip().lower() in LIVE_QUOTE_STATES

    @property
    def implied_low(self) -> Decimal | None:
        return self.yes_bid

    @property
    def implied_high(self) -> Decimal | None:
        return None if self.no_bid is None else one_minus(self.no_bid)

    @property
    def estimate(self) -> Decimal | None:
        """The maker's own midpoint, and only when they quoted both sides.

        A one-sided quote is not an estimate of anything: a maker bidding 0.31
        for YES and offering nothing has said their value is AT LEAST 0.31, not
        that it is 0.31. Folding that bound into the panel as a point pulls the
        median toward whichever side happened to be quoted and understates the
        spread, which is the one number this class exists to report.
        """
        low, high = self.implied_low, self.implied_high
        if low is None or high is None:
            return None
        return (low + high) / 2

    @property
    def one_sided(self) -> bool:
        return (self.implied_low is None) != (self.implied_high is None)

    @property
    def width(self) -> Decimal | None:
        low, high = self.implied_low, self.implied_high
        if low is None or high is None:
            return None
        return high - low

    @property
    def crossed(self) -> bool:
        """Both sides bid to more than a dollar between them.

        The Lesson-0 identity again: two bids summing above one would mean the
        maker pays more than the dollar the pair is certain to return. Seen in
        the wild it means the two sides were quoted at different moments, and
        the quote should not be averaged into a panel as though it were one view.
        """
        if self.yes_bid is None or self.no_bid is None:
            return False
        return self.yes_bid + self.no_bid > DOLLAR


@dataclass(frozen=True, slots=True)
class Rfq:
    """One request, and the market it asks about."""

    rfq_id: str
    market_ticker: str
    contracts: int | None
    status: str
    created_ts: str


@dataclass(frozen=True, slots=True)
class Dispersion:
    """How far apart the makers are on one market."""

    market_ticker: str
    quotes: int
    usable: int
    median: Decimal | None
    lowest: Decimal | None
    highest: Decimal | None
    spread: Decimal | None
    median_width: Decimal | None
    crossed: int
    thin: bool
    detail: str

    @property
    def uses_band(self) -> Decimal | None:
        """The disagreement, for comparison against a Fréchet band width.

        Same units as the band — dollars of probability — so the two numbers can
        be put beside each other, which is the only reason this class exists.
        """
        return self.spread


def _median(values: Sequence[Decimal]) -> Decimal | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _side(row: dict[str, Any], name: str) -> Decimal | None:
    """One side of a quote, in dollars, or None.

    Reads the ``_dollars`` field and nothing else. The bare ``yes_bid`` on a
    market object is in CENTS, so falling back to it would read a 31-cent bid
    as $31 and mark every such quote crossed. Keyed on presence rather than
    truthiness for the same class of reason: a legitimate bid of zero is falsy,
    and ``a or b`` would silently reach past it.
    """
    value = row.get(f"{name}_dollars")
    return _decimal(value) if value is not None else None


def parse_quotes(payload: dict[str, Any]) -> list[Quote]:
    rows = payload.get("quotes")
    if not isinstance(rows, list):
        return []
    parsed: list[Quote] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        parsed.append(
            Quote(
                quote_id=str(row.get("id") or row.get("quote_id") or ""),
                rfq_id=str(row.get("rfq_id") or ""),
                market_ticker=str(row.get("market_ticker") or row.get("ticker") or ""),
                yes_bid=_side(row, "yes_bid"),
                no_bid=_side(row, "no_bid"),
                created_ts=str(row.get("created_ts") or row.get("created_time") or ""),
                status=str(row.get("status") or ""),
            )
        )
    return parsed


def parse_rfqs(payload: dict[str, Any]) -> list[Rfq]:
    rows = payload.get("rfqs")
    if not isinstance(rows, list):
        return []
    parsed: list[Rfq] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        contracts = row.get("contracts")
        parsed.append(
            Rfq(
                rfq_id=str(row.get("id") or row.get("rfq_id") or ""),
                market_ticker=str(row.get("market_ticker") or row.get("ticker") or ""),
                contracts=int(contracts) if isinstance(contracts, int) else None,
                status=str(row.get("status") or ""),
                created_ts=str(row.get("created_ts") or row.get("created_time") or ""),
            )
        )
    return parsed


def disperse(market_ticker: str, quotes: Sequence[Quote]) -> Dispersion:
    """The panel's disagreement about one market."""
    all_rows = [quote for quote in quotes if quote.market_ticker == market_ticker]
    rows = [quote for quote in all_rows if quote.live]
    stale = len(all_rows) - len(rows)
    crossed = [quote for quote in rows if quote.crossed]
    one_sided = [quote for quote in rows if quote.one_sided]
    usable = [quote for quote in rows if quote.estimate is not None and not quote.crossed]
    estimates = [quote.estimate for quote in usable if quote.estimate is not None]

    if len(estimates) < 2:
        return Dispersion(
            market_ticker=market_ticker,
            quotes=len(rows),
            usable=len(estimates),
            median=_median(estimates),
            lowest=min(estimates) if estimates else None,
            highest=max(estimates) if estimates else None,
            spread=None,
            median_width=None,
            crossed=len(crossed),
            thin=True,
            detail=(
                f"{len(estimates)} usable quote(s) on this market; a disagreement needs at least two "
                "independent makers, so no spread is reported"
            ),
        )

    widths = [quote.width for quote in usable if quote.width is not None]
    notes = [f"{len(estimates)} maker(s) quoted"]
    if crossed:
        notes.append(
            f"{len(crossed)} quote(s) bid over a dollar across both sides and were left out — "
            "the two sides were priced at different moments and are not one view"
        )
    if stale:
        notes.append(
            f"{stale} quote(s) are cancelled, executed or expired and were left out — a maker's past "
            "view is not their current disagreement with anyone"
        )
    if one_sided:
        notes.append(
            f"{len(one_sided)} quote(s) named only one side and were left out — a bid with no offer "
            "is a bound on a maker's value, not an estimate of it"
        )
    if len(estimates) < THIN_PANEL:
        notes.append("fewer than three makers, so the spread is an anecdote rather than a distribution")

    return Dispersion(
        market_ticker=market_ticker,
        quotes=len(rows),
        usable=len(estimates),
        median=_median(estimates),
        lowest=min(estimates),
        highest=max(estimates),
        spread=max(estimates) - min(estimates),
        median_width=_median(widths),
        crossed=len(crossed),
        thin=len(estimates) < THIN_PANEL,
        detail="; ".join(notes),
    )


async def read_panel(client: KalshiClient, limit: int = 50) -> dict[str, Any]:
    """The open RFQs and their quotes, or the honest reason there are none.

    One shape for all four states so the pane never has to guess which of
    "nothing quoted" and "not allowed to look" it is rendering.
    """
    try:
        # A quote is private to its maker and the RFQ's requester.  Kalshi no
        # longer accepts an unfiltered quote-list request, and a global RFQ
        # page cannot be joined honestly to quotes only this requester may
        # read.  Keep both halves on the authenticated requester's own RFQs.
        rfq_page = await client.get(
            "/communications/rfqs",
            {"limit": limit, "user_filter": "self"},
        )
        quote_page = await client.get(
            "/communications/quotes",
            {"limit": limit, "rfq_user_filter": "self"},
        )
    except KalshiRefused as exc:
        return {
            "state": "refused",
            "detail": (
                "the RFQ channel refused this key. It is signed-only and environment-specific: "
                "a demo key signs demo, never production. " + exc.reason
            ),
            "rfqs": [],
            "dispersions": [],
        }
    except SigningUnavailable as exc:
        # Configuration can pass the cheap presence check and still fail at
        # the signing boundary: the PEM may have moved, become unreadable, or
        # stopped parsing. That is an operator setup state, not a gateway 500
        # and not a venue refusal — no request left this process.
        return {
            "state": "signing_unavailable",
            "detail": f"private-channel signing is not ready: {exc}",
            "rfqs": [],
            "dispersions": [],
        }
    except KalshiUnavailable as exc:
        # A dead socket, a 503 or an exhausted read budget is not a refusal.
        # "Refused" says the venue answered and said no, which is a fact about
        # this deployment's credentials; an outage is a fact about the network
        # and is worth retrying. Reporting the second as the first sends a
        # reader to check a key that was never the problem.
        return {"state": "unavailable", "detail": exc.reason, "rfqs": [], "dispersions": []}

    rfqs = parse_rfqs(rfq_page.payload)
    quotes = parse_quotes(quote_page.payload)
    if not rfqs and not quotes:
        return {
            "state": "empty",
            "detail": (
                "the channel answered, and there is nothing in it. On the demo environment that is "
                "the usual state: makers do not quote a sandbox"
            ),
            "rfqs": [],
            "dispersions": [],
        }

    tickers: list[str] = []
    for item in list(rfqs) + list(quotes):  # type: ignore[arg-type]
        ticker = item.market_ticker
        if ticker and ticker not in tickers:
            tickers.append(ticker)
    return {
        "state": "available",
        "detail": f"{len(rfqs)} open request(s) and {len(quotes)} quote(s) across {len(tickers)} market(s)",
        "rfqs": rfqs,
        "dispersions": [disperse(ticker, quotes) for ticker in tickers],
    }
