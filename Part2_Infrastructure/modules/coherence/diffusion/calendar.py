"""The earnings calendar, and the assumption it is forced to make.

The gateway does not fetch this itself. The provider adapters, their
credentials and their contracts live in the workspace and in the research
service, and a second Python implementation of any of them is a second thing to
drift — the argument `modules/data_jobs.py` makes for reaching equity bars
through the web rather than re-implementing them. So this reads a JSON envelope
and normalises it into event rows.

THE SECOND STAGE IS AN ASSUMPTION, AND EVERY ROW SAYS SO. A rate decision
publishes both of its stages to the minute. An earnings release does not: no
free feed anywhere says when the conference call starts. The desk's own
convention is `release + DIFFUSION_CALL_OFFSET_MIN`, written with
`call_at_source: "estimated_offset"` and the offset stored beside it, so a
horizon measured from a guessed start is never mistaken for one measured from a
recorded start. `POST /api/research/diffusion/events/{ref}/stage` is how an
operator retires the guess one event at a time.

THE TIMING WORD IS NOT FOLDED INTO THE TIMESTAMP. BMO, AMC, TAS and TNS say
where in the session a release lands, and a vendor that stamps every AMC row at
20:00 UTC is stating a convention rather than an observation. The word travels
so a later reader can tell the two apart.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from modules.coherence.diffusion import tunables
from modules.coherence.diffusion.events import EventUpsert

ReadState = Literal["ok", "unconfigured", "unavailable", "empty"]

#: The vendor's session-placement vocabulary, kept exactly.
TIMINGS = {"BMO", "AMC", "TAS", "TNS"}


@dataclass(frozen=True)
class CalendarRead:
    """What came back, or why nothing did."""

    state: ReadState
    events: tuple[EventUpsert, ...] = ()
    skipped: int = 0
    reason: str | None = None


def _parse_stamp(value: Any) -> float | None:
    """An ISO stamp into epoch ms, or None. Never `now`.

    `isoOrNow` is the documented hazard on the web side: an adapter that
    substitutes the fetch clock for an unparseable vendor stamp turns a missing
    timestamp into a plausible one, and an event study built on that is
    measuring its own poll. A row this cannot date is dropped.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).timestamp() * 1000.0


def _float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if number != number else number


def earnings_events(payload: Any, *, offset_min: float | None = None) -> CalendarRead:
    """Normalise a `{ok, data}` calendar envelope into event rows."""
    offset = tunables.DIFFUSION_CALL_OFFSET_MIN if offset_min is None else offset_min
    if not isinstance(payload, dict):
        return CalendarRead("unavailable", reason="the calendar answered with a non-object body")
    if payload.get("ok") is False:
        return CalendarRead("unavailable", reason=str(payload.get("error") or "the source refused"))
    rows = payload.get("data")
    if not isinstance(rows, list):
        return CalendarRead("unavailable", reason="the calendar envelope carried no data array")
    if not rows:
        return CalendarRead("empty", reason="the window holds no scheduled announcements")

    events: list[EventUpsert] = []
    skipped = 0
    for row in rows:
        if not isinstance(row, dict):
            skipped += 1
            continue
        symbol = str(row.get("symbol") or "").strip().upper()
        release_at = _parse_stamp(row.get("start_at"))
        if not symbol or release_at is None:
            skipped += 1
            continue
        timing = str(row.get("timing") or "").strip().upper() or None
        stamp = datetime.fromtimestamp(release_at / 1000.0, tz=timezone.utc).date().isoformat()
        events.append(EventUpsert(
            kind="earnings",
            source_ref=f"yf:{symbol}:{stamp}",
            title=str(row.get("company") or row.get("event_name") or symbol),
            symbol=symbol,
            release_at=release_at,
            release_at_source="vendor",
            release_timing=timing if timing in TIMINGS else None,
            # Assumed, and recorded as assumed. Nothing free says otherwise.
            call_at=release_at + offset * 60_000.0,
            call_at_source="estimated_offset",
            call_offset_min=offset,
            eps_estimate=_float(row.get("eps_estimate")),
            eps_actual=_float(row.get("eps_actual")),
            surprise_pct=_float(row.get("surprise_pct")),
        ))
    return CalendarRead("ok", tuple(events), skipped=skipped)


def fetch_earnings(base_url: str, *, start: str | None = None, end: str | None = None,
                   limit: int = 50, client: Any | None = None,
                   timeout_s: float = 12.0) -> CalendarRead:
    """Read the service's calendar route, or say why it could not be read."""
    if not base_url:
        return CalendarRead("unconfigured",
                            reason="no calendar source is configured; set the research "
                                   "service URL before the earnings arm can accumulate")
    try:
        import httpx
    except ImportError:  # pragma: no cover - httpx is a core dependency
        return CalendarRead("unconfigured", reason="the httpx package is not installed")
    owned = client is None
    http = client or httpx.Client(timeout=timeout_s)
    params: dict[str, Any] = {"kind": "earnings", "limit": int(limit)}
    if start:
        params["start"] = start
    if end:
        params["end"] = end
    try:
        response = http.get(f"{base_url.rstrip('/')}/api/research/openbb/calendar", params=params)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001 - the reason is the answer
        return CalendarRead("unavailable", reason=str(exc))
    finally:
        if owned:
            http.close()
    return earnings_events(payload)
