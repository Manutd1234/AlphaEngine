"""Who is on call, and a second place to reach them.

E2.10 of the plan, and the plan is blunt about what this can and cannot be:
*the mechanism ships; the roster is yours to fill*. A rota is a roster of
people, and this desk has one. So what is here is the machinery — a grammar, a
resolver and a webhook channel — and an empty `DATA_ONCALL` is a supported
state that reports itself rather than a misconfiguration.

── The grammar ────────────────────────────────────────────────────────────────

    DATA_ONCALL="mei@mon-fri=09:00-18:00;ravi@sat,sun=00:00-23:59"

Entries are separated by `;`, and the first one whose window contains the
moment wins — so order is precedence, and a catch-all goes last. Days are the
three-letter abbreviations, either a range (`mon-fri`) or a comma list
(`sat,sun`). Times are 24-hour local, and a window whose end is before its start
wraps past midnight (`22:00-06:00`), which is what a night shift is.

Deliberately NOT cron. `DATA_SCHEDULES` uses a cadence grammar because it
answers "how often"; a rota answers "who, between when and when", and the two
questions do not share an answer shape. Reusing the cadence grammar here would
have meant `@every=15m` describing a person.

── Why an unparseable entry is kept, not dropped ─────────────────────────────

A rota that silently ignores the line with the typo in it pages nobody and says
nothing. Every entry carries its own `error`, `health()` publishes them, and
`oncall_at` skips only the invalid ones — so a desk with one broken entry still
pages through the others AND can see which one is broken.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, time
from typing import Any

log = logging.getLogger("alphaengine.oncall")

_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


@dataclass
class OnCallEntry:
    """One line of the rota, valid or not."""

    raw: str
    who: str = ""
    days: frozenset[int] = field(default_factory=frozenset)
    start: time = time(0, 0)
    end: time = time(23, 59)
    valid: bool = False
    error: str | None = None

    def covers(self, when: datetime) -> bool:
        """Does this entry own that moment?

        The wrapped case is the one worth being careful about. `mon-fri=22:00-06:00`
        means "on Monday through Friday NIGHTS", so Friday's shift runs into
        Saturday morning and nobody is on for Monday's small hours — that tail
        belongs to Sunday night, which the entry does not name.

        Testing the calendar day of the moment gets this exactly backwards: it
        covers Monday 03:00 and leaves Saturday 03:00 uncovered, which is the
        one hour a weekday rota most needs to reach. So the after-midnight tail
        is matched against the PREVIOUS day — the day the shift began, which is
        the day a night shift is named for.
        """
        if not self.valid:
            return False
        moment, day = when.time(), when.weekday()
        if self.start <= self.end:
            return day in self.days and self.start <= moment <= self.end
        if moment >= self.start:
            return day in self.days
        if moment <= self.end:
            return (day - 1) % 7 in self.days
        return False


def _parse_days(text: str) -> frozenset[int]:
    wanted: set[int] = set()
    for chunk in text.split(","):
        chunk = chunk.strip().lower()
        if "-" in chunk:
            first, _, last = chunk.partition("-")
            if first not in _DAYS or last not in _DAYS:
                raise ValueError(f"unknown day in {chunk!r}")
            a, b = _DAYS.index(first), _DAYS.index(last)
            # `fri-mon` is a real thing to want and wraps the week.
            wanted.update(range(a, b + 1) if a <= b else [*range(a, 7), *range(0, b + 1)])
        elif chunk in _DAYS:
            wanted.add(_DAYS.index(chunk))
        else:
            raise ValueError(f"unknown day {chunk!r}")
    if not wanted:
        raise ValueError("no days")
    return frozenset(wanted)


def _parse_time(text: str) -> time:
    match = _TIME.match(text.strip())
    if not match:
        raise ValueError(f"not a 24-hour time: {text!r}")
    return time(int(match.group(1)), int(match.group(2)))


def parse_entry(expression: str) -> OnCallEntry:
    entry = OnCallEntry(raw=expression.strip())
    try:
        who, _, rest = entry.raw.partition("@")
        if not who.strip():
            raise ValueError("missing name before @")
        days, _, window = rest.partition("=")
        if not window:
            raise ValueError("missing =HH:MM-HH:MM")
        start, _, end = window.partition("-")
        if not end:
            raise ValueError("window needs a start and an end")
        entry.who = who.strip()
        entry.days = _parse_days(days)
        entry.start = _parse_time(start)
        entry.end = _parse_time(end)
        entry.valid = True
    except ValueError as exc:
        entry.error = str(exc)
    return entry


def parse_rota(expressions: list[str] | str | None) -> list[OnCallEntry]:
    if not expressions:
        return []
    if isinstance(expressions, str):
        expressions = [e for e in expressions.split(";") if e.strip()]
    return [parse_entry(e) for e in expressions]


def oncall_at(rota: list[OnCallEntry], when: datetime) -> str | None:
    """The first entry covering this moment, or None.

    None is a real answer and the caller must be able to say it: "nobody is on
    call right now" and "the rota is empty" are both honest, and neither is the
    same as naming somebody who is not.
    """
    for entry in rota:
        if entry.covers(when):
            return entry.who
    return None


def rota_health(rota: list[OnCallEntry], when: datetime | None = None) -> dict[str, Any]:
    """What the ops surface publishes about the rota.

    `configured: false` with `entries: 0` is the shipped-empty state, and it is
    reported as such rather than as an error — the mechanism exists, the roster
    is the desk's to fill.
    """
    now = when or datetime.now().astimezone()
    invalid = [e for e in rota if not e.valid]
    return {
        "configured": bool(rota),
        "entries": len(rota),
        "valid": len(rota) - len(invalid),
        "on_call": oncall_at(rota, now),
        # Named, not counted. "1 invalid entry" sends somebody to read the
        # whole variable; the raw line sends them to the typo.
        "invalid": [{"raw": e.raw, "error": e.error} for e in invalid],
    }


async def post_webhook(url: str, payload: dict[str, Any], *, timeout_s: float = 10.0) -> bool:
    """Deliver one escalation to a webhook. Never raises; returns whether it landed.

    The second channel the plan asks for. It exists so that a desk whose
    Telegram is down is not a desk with no escalation path, which is the whole
    argument for having two.

    Same contract as every other alert path here: a delivery failure must not
    propagate into the sync round trip that opened the escalation.
    """
    if not url:
        return False
    import httpx

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(url, json=payload)
        if response.status_code >= 400:
            log.warning("on-call webhook refused: HTTP %s", response.status_code)
            return False
        return True
    except Exception as exc:  # never the URL, which can carry a token
        log.error("on-call webhook failed (%s)", type(exc).__name__)
        return False


async def escalation_channel(escalation: Any, *, telegram_ok: bool, url: str, rota: str = "") -> str:
    """Deliver to the webhook if one is configured, and name the channel reached.

    Two channels, and the reason for two is that a desk whose Telegram is down
    would otherwise be a desk with no escalation path at all.

    The webhook fires whenever it is configured — redundancy is the point, so it
    does not wait for Telegram to fail. What the return value names is the
    *strongest* channel that carried it, preferring Telegram because that is the
    one a person is actually watching. `"log"` means nothing carried it, which
    is exactly the state an operator needs to be able to see.

    The payload names who is on call when the rota can say. A page that reaches
    a webhook and cannot say who should act on it has moved the problem rather
    than solved it.
    """
    landed = False
    if url:
        on_call = oncall_at(parse_rota(rota), datetime.now().astimezone()) if rota else None
        landed = await post_webhook(url, {
            "kind": "data_quality_escalation",
            "rule": getattr(escalation, "rule", ""),
            "provider": getattr(escalation, "provider", ""),
            "detail": getattr(escalation, "detail", ""),
            "window_minutes": getattr(escalation, "window_minutes", None),
            # Null rather than absent, and never a name the rota did not give.
            "on_call": on_call,
        })
    if telegram_ok:
        return "telegram"
    return "webhook" if landed else "log"
