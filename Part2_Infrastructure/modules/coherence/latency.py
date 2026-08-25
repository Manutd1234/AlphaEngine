"""How long the venue actually takes to answer, kept so a verdict can use it.

**THE NUMBER THIS REPLACES WAS NEVER MEASURED.** `/api/coherence/episodes`
declares `round_trip_s: str = Query(default="0.240")`, nothing on the desk ever
passes it, and `verdict_for` compares the median violation lifetime against it.
So the engine's honest gate — *if the median lifetime is under the round trip,
the opportunity was never available* — has been decided by a query parameter's
default echoing back, and the desk drew "round trip 240ms" as though something
had timed it. That is the shape this codebase is most alert to: a figure that
looks measured and is not.

**WHAT IS MEASURED HERE IS A READ, AND A READ IS NOT AN ORDER.** This times the
HTTP round trip of the reads the recorder already makes. An order round trip is
at least that and almost certainly more — it carries a signature, it is written
rather than read, and it queues behind a matching engine. So the measured read
is a **lower bound**, and a verdict computed from it is OPTIMISTIC: it will call
an opportunity tradeable slightly more often than a real order path would.

That is stated everywhere the figure is, and it is still a large improvement on
a constant: a lower bound derived from this deployment's own network beats a
number nobody took, and it moves when the network does.

**A ROLLING WINDOW, NOT AN AVERAGE OF EVERYTHING.** The venue's latency is not
stationary — it changes with the time of day and with the shard — so a mean over
all history describes a network that no longer exists. The median of a bounded
window is what a reader means by "how long is it taking now", and the median
rather than the mean because one 8-second timeout should not move it.

**IT IS NOT PERSISTED.** The window lives for the life of the process. A
restart returns the route to saying "assumed" until reads land, which is honest:
nothing timed this deployment's network before it started.
"""

from __future__ import annotations

import threading
from collections import deque
from decimal import Decimal

#: How many recent reads the median is taken over.
#:
#: The recorder polls every `COHERENCE_POLL_S` and each poll makes several
#: reads, so 200 is roughly the last few minutes at any configured cadence —
#: long enough that one slow call cannot move the median, short enough that it
#: still describes the network the reader is on.
WINDOW = 200

_samples: deque[float] = deque(maxlen=WINDOW)
_lock = threading.Lock()


def record(seconds: float) -> None:
    """One completed read's wall time.

    Failures are NOT recorded, and that is deliberate: a call that timed out at
    eight seconds measures this client's patience rather than the venue's speed,
    and feeding it in would push the median toward the timeout and make every
    opportunity look untradeable. A refused or unreachable venue is reported by
    the status route, which is where that belongs.
    """
    if seconds <= 0 or seconds != seconds:  # non-positive, or NaN
        return
    with _lock:
        _samples.append(seconds)


def median_s() -> Decimal | None:
    """The median read round trip over the window, or None before any landed.

    None rather than a default: "we have not timed this yet" and "we timed it
    and it is 240ms" are different answers, and collapsing them is exactly the
    defect this module exists to end. The caller decides what to do without a
    measurement; it does not get one invented here.

    Quantised to a millisecond because that is the resolution the claim can
    carry — a round trip reported to the microsecond over a public network
    asserts a precision the measurement does not have.
    """
    with _lock:
        if not _samples:
            return None
        ordered = sorted(_samples)
        middle = len(ordered) // 2
        value = (
            ordered[middle]
            if len(ordered) % 2
            else (ordered[middle - 1] + ordered[middle]) / 2
        )
    return Decimal(str(round(value, 3)))


def count() -> int:
    """How many reads the median is taken over, so a figure can say so."""
    with _lock:
        return len(_samples)


def reset() -> None:
    """Testing seam: drops the window, so one suite cannot see another's reads."""
    with _lock:
        _samples.clear()
