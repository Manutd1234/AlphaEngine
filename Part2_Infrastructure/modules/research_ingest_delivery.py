"""Delivering one research document, and where it goes when delivery fails.

Split out of ``research_rag/writer.py`` rather than written inside it for two
reasons. The write path there was one flat ``_drain`` in which a single insert
had no name, so there was nowhere to put a retry without the loop growing a
second nesting level; and ``writer.py`` is the only file in that package that
reads ``settings``, which a test patches wholesale — a retry curve living there
would have been swapped out along with the configuration it has nothing to do
with.

**What this replaces is a document being GONE.** The old drain incremented a
``_failed`` counter on a non-2xx insert and on ``httpx.HTTPError`` and moved on.
A proxy 502 during a deploy, or the ten seconds a PostgREST restart is
unreachable, therefore consumed every document submitted in that window and left
one integer behind — no reason, no identity, nothing to replay. Two things are
owed there and both are here: try again on a curve, and when the curve runs out
put the document somewhere a human can read.

THE CURVE IS THE SIBLING'S. ``modules/supabase_mirror.py`` has retried the order
mirror three times against ``Backoff(base_s=1.0, ceiling_s=30.0)`` since it was
written, and the whole point of ``modules/backoff.py`` is that the fourth
hand-rolled geometric backoff in this tree became the last one. This is the same
shape deliberately: same attempt count, same base, same ceiling, ``failed()``
called once per ATTEMPT so the helper's counter and the sleep can never disagree
about how long an outage has been going on.

The tunables are module-level constants read from the environment rather than
``Settings`` fields, for the reason ``research_rerank`` states: ``config.py`` is
the documented un-splittable file, is over the file-length ceiling at 407 lines
with the ratchet holding it there, and four more fields would push it further
into a debt nobody can pay without a breaking refactor. They are read at CALL
time, not bound at import, so a test can move them.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

from modules.backoff import Backoff

log = logging.getLogger("alphaengine.rag")

#: Attempts per document, including the first. Three, like the order mirror.
INGEST_ATTEMPTS = int(os.environ.get("RESEARCH_INGEST_ATTEMPTS", "3"))

#: The retry curve, in seconds. Same base and ceiling as ``supabase_mirror``.
INGEST_BACKOFF_BASE_S = float(os.environ.get("RESEARCH_INGEST_BACKOFF_BASE_S", "1.0"))
INGEST_BACKOFF_CEILING_S = float(os.environ.get("RESEARCH_INGEST_BACKOFF_CEILING_S", "30.0"))

#: How many dead letters are kept. Bounded because this lives in the gateway's
#: memory and an outage that lasts an hour would otherwise turn a failed index
#: into a leak; 50 is enough to see the SHAPE of a failure (which kinds, which
#: reason) without pretending to be a durable queue. When it is full the OLDEST
#: is discarded and the count of discards is reported, because a bounded buffer
#: that quietly forgets is the same defect this module exists to fix.
DEAD_LETTER_MAX = int(os.environ.get("RESEARCH_DEAD_LETTER_MAX", "50"))

#: The closed vocabulary of delivery failures, matching the mirror's.
#: ``auth`` is separated from ``rejected`` because a service-role key that has
#: expired is an operator's problem and a rejected row is a developer's, and an
#: outage in which every document reads "rejected" hides the difference.
REASON_AUTH = "auth"
REASON_REJECTED = "rejected"
REASON_TIMEOUT = "timeout"
REASON_UNREACHABLE = "unreachable"
REASON_ERROR = "error"


@dataclass(frozen=True)
class Delivered:
    """The insert landed. Carries the response so the caller can link edges."""

    attempts: int
    response: Any


@dataclass(frozen=True)
class Undelivered:
    """Every attempt failed. A STATE with a named reason, never an exception.

    The caller must be able to tell "the corpus refused this row" from "the
    corpus could not be reached", because the first is a bug in the document and
    the second is weather. Collapsing both into a ``_failed`` counter is what
    made an ingestion outage indistinguishable from a schema mistake.
    """

    reason: str
    detail: str
    attempts: int


DeliveryOutcome = Delivered | Undelivered


@dataclass
class DeadLetterBook:
    """The bounded record of documents the corpus never took.

    Holds the document's IDENTITY and the reason, not the document — the body is
    the embedded text and can be kilobytes, and fifty of them in the gateway's
    memory buys nothing a source_ref does not. Replaying a dead letter is the
    backfill tool's job; this exists so somebody knows there is something to
    replay.
    """

    maximum: int = 0
    entries: deque[dict[str, Any]] = field(default_factory=deque)
    #: Dead letters pushed out by newer ones. Reported, never silent.
    discarded: int = 0

    def __post_init__(self) -> None:
        if self.maximum <= 0:
            self.maximum = DEAD_LETTER_MAX
        self.entries = deque(self.entries, maxlen=self.maximum)

    def record(self, document: dict[str, Any], outcome: Undelivered) -> None:
        if len(self.entries) == self.maximum:
            self.discarded += 1
        self.entries.append({
            "kind": document.get("kind"),
            "source_ref": document.get("source_ref"),
            "reason": outcome.reason,
            "detail": outcome.detail,
            "attempts": outcome.attempts,
            "at": datetime.now(timezone.utc).isoformat(),
        })

    @property
    def depth(self) -> int:
        return len(self.entries)

    def recent(self, limit: int = 10) -> list[dict[str, Any]]:
        """Newest first — an operator reads the most recent failure first."""
        return list(self.entries)[-limit:][::-1]


async def deliver(
    client: httpx.AsyncClient,
    row: dict[str, Any],
    *,
    path: str = "/rest/v1/research_documents",
    prefer: str = "resolution=ignore-duplicates,return=representation",
    identity: dict[str, Any] | None = None,
) -> DeliveryOutcome:
    """Insert one row, retrying on the mirror's curve. Never raises.

    There is no injected clock and no injected sleeper: a test shortens the
    curve by moving the module constants above, so what runs under test is this
    loop and the real ``Backoff``, not a rehearsal of them. The last attempt
    does not sleep — waiting after the decision to give up is time an operator
    spends waiting for a dead letter that already exists.
    """
    shown = identity or row
    backoff = Backoff(base_s=INGEST_BACKOFF_BASE_S, ceiling_s=INGEST_BACKOFF_CEILING_S)
    attempts = max(1, INGEST_ATTEMPTS)
    reason, detail = REASON_ERROR, "no attempt was made"
    for attempt in range(attempts):
        try:
            response = await client.post(path, json=row, headers={"Prefer": prefer})
            if response.status_code < 300:
                return Delivered(attempts=attempt + 1, response=response)
            reason = REASON_AUTH if response.status_code in (401, 403) else REASON_REJECTED
            detail = f"HTTP {response.status_code}"
        except httpx.TimeoutException:
            reason, detail = REASON_TIMEOUT, "the corpus did not answer in time"
        except httpx.HTTPError as exc:
            reason, detail = REASON_UNREACHABLE, type(exc).__name__
        except Exception as exc:  # a broken response object must not kill the drain
            reason, detail = REASON_ERROR, type(exc).__name__
        log.warning(
            "research document %s/%s not indexed (%s: %s), attempt %d of %d",
            shown.get("kind"), shown.get("source_ref"), reason, detail, attempt + 1, attempts,
        )
        if attempt + 1 < attempts:
            await asyncio.sleep(backoff.failed())
    return Undelivered(reason=reason, detail=detail, attempts=attempts)
