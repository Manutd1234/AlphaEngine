"""The text an announcement actually said, from the issuer's own page.

Free, and that is the whole design constraint. There is no transcript vendor on
this desk, so the text channel is built from what the issuer publishes: the
FOMC statement, which lives at a URL keyed by the decision date.

    https://www.federalreserve.gov/newsevents/pressreleases/monetary{YYYYMMDD}a.htm

That URL does a second job worth as much as the first. The calendar in
`fomc.py` is written knowledge rather than fetched data, so every row ships
`verified_at: None` and no number built on it may be cited. A 200 from the
date's own statement page falsifies nothing and confirms the date; a 404 says
the row is wrong. Fetching the text and verifying the calendar are the same
request, so the module that reads the news is also the one that retires the
disclaimer.

THE PARSER IS DELIBERATELY BLUNT. It strips tags, collapses whitespace and
keeps the paragraphs between the release stamp and the voting record. A proper
DOM parse would need a dependency, and the thing being measured is the
resolution at which one text explains another — a stray navigation label
changes that far less than a missing dependency changes whether this runs at
all. What it must never do is silently return a nearly-empty document: below
`MIN_STATEMENT_CHARS` the fetch is a refusal with the length it got.

Nothing here writes a zero. A page that could not be read is a state with a
reason, and its row carries no text rather than an empty string.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Literal

FetchState = Literal["ok", "not_found", "too_short", "unavailable", "unconfigured"]

#: The Fed asks automated readers to identify themselves. A tool that does not
#: is a tool that gets the desk's address blocked for everyone.
USER_AGENT = "AlphaEngine research (contact: desk operator)"

#: Below this the page was a redirect, an error shell or a navigation stub.
#:
#: 300, and the number was measured rather than chosen. It started at 600 and
#: rejected exactly one real document: the emergency inter-meeting cut of
#: 3 March 2020, which is 537 characters of complete statement — four sentences
#: announcing a half-point move — because an unscheduled announcement is short.
#: A floor that discards the largest monetary surprise in the sample because it
#: was briefly worded is a floor measuring the wrong thing. The isolated body of
#: a genuine statement has never been under 500; a navigation shell is under 200.
MIN_STATEMENT_CHARS = 300

#: Politeness, not rate limiting: one statement per meeting, sixty-odd meetings.
DEFAULT_DELAY_S = 0.35

#: The statement body sits between the release stamp and the voting record.
#: Both markers have been stable across every meeting since 2019; when one
#: stops matching the fetch keeps the whole page and SAYS so rather than
#: silently returning a document with the navigation in it.
_BODY_START = re.compile(r"^For release at\s+(.+)$", re.M | re.I)
#: 2019 wrote "Voting for the FOMC monetary policy action"; later years dropped
#: the acronym. Both are matched rather than the union being assumed.
_BODY_END = re.compile(r"^Voting (for|against) the (FOMC )?monetary policy action", re.M | re.I)

#: "For release at 2:00 p.m. EDT" — the issuer's own claim about the stage
#: timestamp, which is a stronger confirmation of the calendar than a 200.
_RELEASE_TIME = re.compile(r"(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\s*(E[SD]T)", re.I)

_TAG = re.compile(r"<[^>]+>")
_SCRIPT = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.S | re.I)
_WHITESPACE = re.compile(r"[ \t\r\f\v]+")
_BLANKS = re.compile(r"\n{3,}")
_ENTITY = {
    "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&rsquo;": "’",
    "&ldquo;": "“", "&rdquo;": "”", "&mdash;": "—", "&ndash;": "–",
}


@dataclass(frozen=True)
class StatementText:
    """One fetched document, or the reason there is not one."""

    source_ref: str
    url: str
    state: FetchState
    text: str | None = None
    sha256: str | None = None
    characters: int = 0
    fetched_at_ms: float | None = None
    reason: str | None = None
    #: The issuer's own release time, e.g. "14:00 EDT", or None when the page
    #: did not carry one. This is what verifies a calendar row's HOUR.
    release_time: str | None = None
    #: False when the body markers did not match and the whole page was kept.
    body_isolated: bool = True
    #: The roll call, kept separately because `body_of` cuts the body AT it.
    #: Dissents are the sharpest discrete signal a statement carries and they
    #: would otherwise be discarded by the very trim that isolates the prose.
    vote_line: str | None = None

    @property
    def verified(self) -> bool:
        """A 200 from the date's own page is what confirms the calendar row."""
        return self.state == "ok"


def strip_html(raw: str) -> str:
    """Tags out, entities in, whitespace collapsed. No dependency, no DOM."""
    without_scripts = _SCRIPT.sub(" ", raw)
    # Block-level tags become newlines first, or every paragraph runs together
    # into one line and the sentence boundaries the encoder needs are gone.
    spaced = re.sub(r"</(p|div|li|h[1-6]|tr|blockquote)>", "\n", without_scripts, flags=re.I)
    spaced = re.sub(r"<br\s*/?>", "\n", spaced, flags=re.I)
    text = _TAG.sub("", spaced)
    for entity, replacement in _ENTITY.items():
        text = text.replace(entity, replacement)
    text = _WHITESPACE.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _BLANKS.sub("\n\n", text).strip()


def _import_http() -> tuple[Any, str | None]:
    """The one seam. Tests substitute this and nothing else."""
    try:
        import httpx
    except ImportError:  # pragma: no cover - httpx is a core dependency
        return None, "the httpx package is not installed"
    return httpx, None


def fetch_statement(source_ref: str, url: str, *, client: Any | None = None,
                    now_ms: float | None = None, timeout_s: float = 12.0) -> StatementText:
    """One statement, or a typed refusal that says which kind of nothing it got."""
    httpx, reason = _import_http()
    if httpx is None:
        return StatementText(source_ref, url, "unconfigured", reason=reason)
    owned = client is None
    http = client or httpx.Client(timeout=timeout_s, headers={"User-Agent": USER_AGENT},
                                  follow_redirects=True)
    stamp = now_ms if now_ms is not None else time.time() * 1000.0
    try:
        response = http.get(url)
        if response.status_code == 404:
            return StatementText(source_ref, url, "not_found", fetched_at_ms=stamp,
                                 reason="the issuer has no statement at this date's URL, "
                                        "so the calendar row is wrong")
        response.raise_for_status()
        text = strip_html(response.text)
    except Exception as exc:  # noqa: BLE001 - the reason is the answer
        return StatementText(source_ref, url, "unavailable", fetched_at_ms=stamp, reason=str(exc))
    finally:
        if owned:
            http.close()
    released_at = release_time_of(text)
    vote = vote_line_of(text)
    body, isolated = body_of(text)
    if len(body) < MIN_STATEMENT_CHARS:
        return StatementText(source_ref, url, "too_short", characters=len(body),
                             fetched_at_ms=stamp, release_time=released_at,
                             body_isolated=isolated, vote_line=vote,
                             reason=f"the page yielded {len(body)} characters, below the floor of "
                                    f"{MIN_STATEMENT_CHARS}; it was probably a redirect or a shell")
    return StatementText(source_ref, url, "ok", text=body,
                         sha256=sha256(body.encode("utf-8")).hexdigest(),
                         characters=len(body), fetched_at_ms=stamp,
                         release_time=released_at, body_isolated=isolated, vote_line=vote)


def vote_line_of(text: str) -> str | None:
    """The roll call sentence, which the body trim removes.

    `body_of` ends the statement at "Voting for the monetary policy action",
    which is right for the prose and wrong for the record: who dissented is a
    fact about the decision, not chrome around it. Captured before the cut.
    """
    start = _BODY_END.search(text or "")
    if not start:
        return None
    tail = text[start.start():]
    # The block is TWO sentences when anyone dissented — "Voting for ... were
    # <names>." then "Voting against ... were <names>, who preferred ...".
    # Stopping at the first full stop keeps only the unanimous half and reports
    # every meeting as unanimous, which is how 62 meetings yielded one dissent.
    for marker in ("Implementation Note", "Last Update", "\n\n"):
        cut = tail.find(marker)
        if cut != -1:
            tail = tail[:cut]
    return tail.strip() or None


def body_of(text: str) -> tuple[str, bool]:
    """The statement itself, and whether the markers were found.

    Returning the whole page when they are not is deliberate: a caller that
    wanted the statement and got the navigation should be able to see that it
    did, which a silently truncated document does not allow.
    """
    start = _BODY_START.search(text)
    end = _BODY_END.search(text, start.end() if start else 0)
    if not start or not end:
        return text, False
    body = text[start.end():end.start()]
    # "Share" is a navigation control the strip leaves behind between the
    # release stamp and the first paragraph.
    lines = [line for line in body.split("\n") if line.strip() and line.strip() != "Share"]
    return "\n".join(lines).strip(), True


def release_time_of(text: str) -> str | None:
    """`For release at 2:00 p.m. EDT` as a 24-hour stamp, or None."""
    marker = _BODY_START.search(text)
    if not marker:
        return None
    found = _RELEASE_TIME.search(marker.group(1))
    if not found:
        return None
    hour = int(found.group(1)) % 12
    if found.group(3).lower() == "p":
        hour += 12
    return f"{hour:02d}:{found.group(2)} {found.group(4).upper()}"


def headline_of(text: str, *, sentences: int = 2) -> str:
    """The first couple of sentences: what a headline scraper would carry.

    The two conditionings the instrument compares are the headline and the body,
    and on a rate decision the headline IS the opening sentences — the target
    range and whether it moved. Splitting on sentence punctuation rather than
    on a character count keeps the boundary where a reader would put it.
    """
    body = " ".join(text.split("\n"))
    parts = re.split(r"(?<=[.!?])\s+", body)
    return " ".join(parts[:sentences]).strip()


def statement_documents(rows: list[dict[str, Any]], *, client: Any | None = None,
                        delay_s: float = DEFAULT_DELAY_S, sleep: Any = time.sleep,
                        limit: int | None = None) -> list[StatementText]:
    """Fetch every row's statement, politely, keeping the refusals."""
    out: list[StatementText] = []
    for index, row in enumerate(rows if limit is None else rows[:limit]):
        url = row.get("statement_url")
        if not url:
            out.append(StatementText(str(row.get("source_ref")), "", "unconfigured",
                                     reason="the calendar row carries no statement URL"))
            continue
        out.append(fetch_statement(str(row["source_ref"]), str(url), client=client))
        if delay_s and index + 1 < len(rows):
            sleep(delay_s)
    return out
