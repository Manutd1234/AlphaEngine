"""``shell`` — the market universe as a filesystem, because it already is one.

The spec asks for a shell view, and the reason it is worth building is not
novelty. A Kalshi universe has exactly the shape a filesystem has: shards
contain series, series contain events, events contain markets, and each market
has contents you can read. Naming that structure with ``ls`` and ``cat`` makes
two things obvious that a dashboard hides.

**Where a thing lives is a cost.** ``/shards/2/KXBTCD/...`` and
``/shards/3/KXEPLGAME/...`` are different directories because they are different
exchange instances, and a portfolio spanning them cannot be protected by an
order group. A tree makes that a property of the path rather than a footnote.

**A derived number is a file, and files can be missing.** ``implied_pmf`` is not
an attribute an event has; it is something computed from its books, and on an
event with no strike ladder the computation has no answer. ``cat`` on it returns
the reason, the same way ``cat`` on anything else would.

The tree is over the *watchlist*, not the exchange. Thirteen thousand series
would make an ``ls`` that nobody reads and a read budget nobody can afford, and
a shell that silently lists a fraction of what exists is worse than one that
says which fraction. The root says so.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Sequence

from modules.coherence.kernel import distribution
from modules.coherence.kernel.book import Book
from modules.coherence.kernel.certificate import Certificate
from modules.coherence.kernel.lattice import build_component
from modules.coherence.syscalls.observe import Observation

Kind = Literal["dir", "file"]


def _plural(count: int, noun: str) -> str:
    """The noun, singular or plural, rather than the "(s)" that stands for both.

    A listing that reads "1 watched event(s)" is a sentence written for a
    variable rather than for a reader, and this string is drawn on the desk's
    Shell section beside a count of one for every shard the demo watchlist has.
    """
    return noun if count == 1 else f"{noun}s"

#: The derived readings an event directory offers. Names are permanent: they are
#: what a saved command line refers to.
EVENT_FILES: tuple[tuple[str, str], ...] = (
    ("implied_pmf", "the probability mass each interval carries, differenced off the ladder"),
    ("survival", "the survival function the strike ladder samples, strike by strike"),
    ("lattice", "which markets imply which, and why the exchange says so"),
    ("certificate", "the coherence test and its proof"),
    ("books", "the two bid ladders and the offers implied from them"),
)


@dataclass(frozen=True, slots=True)
class Entry:
    """One line of an ``ls``."""

    name: str
    kind: Kind
    detail: str


@dataclass(frozen=True, slots=True)
class Listing:
    """What a path contains, or why it contains nothing."""

    path: str
    entries: tuple[Entry, ...]
    detail: str
    exists: bool = True


@dataclass(frozen=True, slots=True)
class FileBody:
    """What ``cat`` returns: text, and the state that produced it."""

    path: str
    state: Literal["ok", "unavailable", "missing"]
    body: str
    detail: str


def _split(path: str) -> list[str]:
    return [part for part in path.strip().strip("/").split("/") if part]


def _root(observations: Sequence[Observation]) -> Listing:
    shards: dict[int, int] = {}
    for observation in observations:
        shards[observation.event.exchange_index] = shards.get(observation.event.exchange_index, 0) + 1
    entries = tuple(
        Entry(
            name=str(index),
            kind="dir",
            detail=f"{count} watched {_plural(count, 'event')} on this exchange instance",
        )
        for index, count in sorted(shards.items())
    )
    return Listing(
        path="/shards",
        entries=entries,
        detail=(
            "the watchlist, not the exchange: Kalshi lists some thirteen thousand series and this "
            "tree holds the ones the recorder is configured to watch"
        ),
    )


def _series_in(observations: Sequence[Observation], shard: int) -> Listing:
    series: dict[str, int] = {}
    for observation in observations:
        if observation.event.exchange_index != shard:
            continue
        key = observation.event.series_ticker
        series[key] = series.get(key, 0) + 1
    if not series:
        return Listing(f"/shards/{shard}", (), f"no watched event trades on shard {shard}", exists=False)
    return Listing(
        path=f"/shards/{shard}",
        entries=tuple(
            Entry(name=key, kind="dir", detail=f"{count} watched {_plural(count, 'event')}")
            for key, count in sorted(series.items())
        ),
        detail=f"series on exchange instance {shard}",
    )


def _events_in(observations: Sequence[Observation], shard: int, series: str) -> Listing:
    found = [
        observation
        for observation in observations
        if observation.event.exchange_index == shard and observation.event.series_ticker == series
    ]
    if not found:
        return Listing(f"/shards/{shard}/{series}", (), f"{series} has no watched event", exists=False)
    return Listing(
        path=f"/shards/{shard}/{series}",
        entries=tuple(
            Entry(
                name=observation.event.event_ticker,
                kind="dir",
                detail=(
                    f"{len(observation.markets)} market(s); "
                    + ("mutually exclusive" if observation.event.mutually_exclusive else "not marked exclusive")
                ),
            )
            for observation in found
        ),
        detail=f"events listed under {series}",
    )


def _event_dir(observation: Observation) -> Listing:
    entries = [
        Entry(name=item.ticker, kind="file", detail=item.market.yes_sub_title or item.ticker)
        for item in observation.markets
    ]
    entries.extend(Entry(name=name, kind="file", detail=detail) for name, detail in EVENT_FILES)
    return Listing(
        path=f"/shards/{observation.event.exchange_index}/{observation.event.series_ticker}"
        f"/{observation.event.event_ticker}",
        entries=tuple(entries),
        detail="markets, and the readings derived from them",
    )


def _find(observations: Sequence[Observation], event_ticker: str) -> Observation | None:
    return next(
        (item for item in observations if item.event.event_ticker == event_ticker),
        None,
    )


def ls(observations: Sequence[Observation], path: str = "/") -> Listing:
    """List a path in the watched universe."""
    parts = _split(path)
    if not parts or parts == ["shards"]:
        return _root(observations)
    if parts[0] != "shards":
        return Listing(path, (), "the tree has one root, /shards", exists=False)
    try:
        shard = int(parts[1])
    except (IndexError, ValueError):
        return Listing(path, (), f"{parts[1] if len(parts) > 1 else ''} is not an exchange instance", exists=False)
    if len(parts) == 2:
        return _series_in(observations, shard)
    if len(parts) == 3:
        return _events_in(observations, shard, parts[2])
    observation = _find(observations, parts[3])
    if observation is None:
        return Listing(path, (), f"{parts[3]} is not a watched event", exists=False)
    if len(parts) == 4:
        return _event_dir(observation)
    return Listing(path, (), f"{parts[4]} is a file; read it with cat", exists=False)


def _pmf_body(observation: Observation) -> FileBody:
    component = build_component(observation.event, [item.market for item in observation.markets])
    books = {item.ticker: item.book for item in observation.markets}
    surface = distribution.build_surface(component, books)
    if surface.is_empty:
        return FileBody("implied_pmf", "unavailable", "", surface.detail)
    lines = [f"{'interval':<34}{'mass':>12}"]
    for item in surface.bins:
        flag = "  NEGATIVE MASS" if item.is_negative else ""
        lines.append(f"{item.label:<34}{item.mass:>12}{flag}")
    lines.append("")
    lines.append(f"read off the {surface.basis} of each book; {surface.detail}")
    if surface.mean is not None:
        lines.append(f"mean {surface.mean}    variance {surface.variance}")
    else:
        lines.append(f"no mean: {surface.moments_note}")
    return FileBody("implied_pmf", "ok", "\n".join(lines), surface.detail)


def _survival_body(observation: Observation) -> FileBody:
    component = build_component(observation.event, [item.market for item in observation.markets])
    books = {item.ticker: item.book for item in observation.markets}
    surface = distribution.build_surface(component, books)
    if not surface.probes:
        # The surface's own detail describes whatever reading it DID build,
        # which on a bucket family is a sentence about intervals and reads as a
        # non-sequitur under a file called "survival". Say what is actually
        # true of this file instead.
        return FileBody(
            "survival",
            "unavailable",
            "",
            "this event quotes its outcomes as intervals rather than sampling a survival function "
            "at a ladder of strikes, so there is no curve to read off it",
        )
    lines = [f"{'strike':>14}{'P(above)':>12}   read from"]
    for probe in surface.probes:
        lines.append(f"{probe.strike:>14}{probe.survival:>12}   {probe.origin} market {probe.ticker}")
    return FileBody("survival", "ok", "\n".join(lines), surface.detail)


def _lattice_body(observation: Observation) -> FileBody:
    component = build_component(observation.event, [item.market for item in observation.markets])
    lines = [f"{len(component.nodes)} market(s), {len(component.edges)} relation(s), scope {component.scope}", ""]
    for edge in component.edges:
        lines.append(f"[{edge.kind}] {edge.source} -> {edge.target}  ({edge.scope})")
        lines.append(f"    {edge.because}")
    for note in component.notes:
        lines.append(f"note: {note}")
    return FileBody("lattice", "ok", "\n".join(lines), "built from the exchange's own metadata")


def _books_body(observation: Observation) -> FileBody:
    lines = [f"{'market':<34}{'yes bid':>10}{'yes ask':>10}{'spread':>10}"]
    for item in observation.markets:
        book: Book = item.book
        lines.append(
            f"{(item.market.yes_sub_title or item.ticker)[:32]:<34}"
            f"{_or_dash(book.best_yes_bid):>10}{_or_dash(book.best_yes_ask):>10}{_or_dash(book.spread):>10}"
        )
    lines.append("")
    lines.append("an empty side reads as a dash, never as a price of zero")
    return FileBody("books", "ok", "\n".join(lines), f"depth: {observation.depth}")


def _or_dash(value: Any) -> str:
    return "-" if value is None else str(value)


def cat(
    observations: Sequence[Observation],
    path: str,
    certificate: Certificate | None = None,
) -> FileBody:
    """Read one derived file out of an event directory."""
    parts = _split(path)
    if len(parts) != 5 or parts[0] != "shards":
        return FileBody(path, "missing", "", "a readable file lives at /shards/<n>/<series>/<event>/<name>")
    observation = _find(observations, parts[3])
    if observation is None:
        return FileBody(path, "missing", "", f"{parts[3]} is not a watched event")
    name = parts[4]

    if name == "implied_pmf":
        return _pmf_body(observation)
    if name == "survival":
        return _survival_body(observation)
    if name == "lattice":
        return _lattice_body(observation)
    if name == "books":
        return _books_body(observation)
    if name == "certificate":
        if certificate is None:
            return FileBody(path, "unavailable", "", "no certificate was computed for this event in this read")
        return FileBody(path, "ok", certificate.render_text(), f"engine: {certificate.engine}")
    if any(item.ticker == name for item in observation.markets):
        return FileBody(path, "unavailable", "", "a single market is a directory entry, not a readable file yet")
    return FileBody(path, "missing", "", f"no file called {name} in this event")
