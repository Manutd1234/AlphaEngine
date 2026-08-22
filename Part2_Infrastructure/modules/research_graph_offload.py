"""The Neo4j read model, moved off the event loop this process serves risk on.

WHAT WAS WRONG
--------------

``modules/research_graph_read_model.py`` is synchronous by design and correctly
so: it opens a driver, runs three Cypher reads in one session and closes the
driver on every path (see its ``_session``). What was wrong is where it ran.
``research_graph_reads.community_report`` and ``centrality_report`` are ``async``
and called ``community_labels(...)`` / ``centrality_scores(...)`` DIRECTLY, so a
Neo4j round trip — a TLS handshake to Aura on a cold driver, then three queries —
happened inside a coroutine, with nothing yielding to the loop for its whole
duration. There was not one ``to_thread`` in that module.

That is not a research-plane latency problem. ``modules/research_stages.py``
states the reason in the form this module inherits: *this process owns the
pre-trade risk checks, research may wait and risk may not*. The loop blocked by
a graph read is the same loop that has to answer an order's risk decision, whose
budget is microseconds. A cross-region Neo4j read is four to five orders of
magnitude of that budget, spent on a GET somebody opened in a browser tab, while
an order waits. And it is invisible where anyone would look for it: the research
route's own timing shows nothing unusual, because the time is not lost by the
research route, it is lost by whatever the loop was going to do next.

WHAT THIS DOES, AND WHY IT IS THE SAME BULKHEAD AND NOT A NEW ONE
----------------------------------------------------------------

Both reads go through ``asyncio.to_thread`` behind a semaphore, which is the
shape ``modules/research.py::_off_loop`` uses for OpenBB and
``modules/research_stages.py`` uses for the cross-encoder. The bound is TWO, and
it is two for their reason rather than by imitation: ``asyncio.to_thread`` hands
work to ONE shared default executor, so an unbounded path through it lets N
concurrent requests pin N of its workers — and the default pool is sized
``min(32, cpu_count + 4)``, which a crawler hitting ``/api/research/graph/*``
exhausts long before Neo4j notices. Two here, two in ``research_stages`` and two
in ``research`` is at most six occupied workers across every heavyweight
research path in the gateway, which the default pool absorbs.

REJECTED: SHARING ``research_stages._RERANK_BULKHEAD``. It is tempting because
"research may wait" is one policy. It is wrong because these two waits are
different resources: a re-rank is solid CPU and a Neo4j read is a socket, so one
semaphore across both would let two idle graph reads block a cross-encoder that
had a core free, and the coupling would only be visible as a research request
that inexplicably waited. A separate bound of the same size costs four worker
threads in the worst case and keeps the two failures independent.

REJECTED: ``asyncio.wait_for`` AROUND THE ``to_thread``. Same argument
``research_stages`` writes down. ``to_thread`` cannot cancel the thread it
started, so a timeout releases the waiting request while the Neo4j read carries
on holding its worker — the bulkhead bounds the cost and a timeout would only
hide it. The driver's own connection and transaction timeouts are the right
place for that bound, and they are ``config.py``'s to set, not this module's.

NO SECOND GUARD, deliberately. ``_session`` already turns every exception into a
typed refusal — ``detected: False``/``ranked: False`` with a named reason — so
these two functions do not raise, and wrapping them in an ``except`` here would
either be dead code or would invent a reason string that the read model owns the
vocabulary for. The report comes back exactly as it was minted.

The names match the read model's on purpose. The call sites differ by one word,
``await``, which is the whole change at the seam and the one thing a reader has
to see.
"""

from __future__ import annotations

import asyncio
from typing import Any

from modules import research_graph_read_model as read_model

#: How many Neo4j read-model reads may occupy the default executor at once.
#: Two, matching `research_stages._RERANK_BULKHEAD` and `research._OPENBB_BULKHEAD`;
#: the module docstring argues why it is two and why it is its own.
_NEO4J_READ_BULKHEAD = asyncio.Semaphore(2)


async def _off_loop(read: Any, /, **kwargs: Any) -> dict[str, Any]:
    """Run one synchronous read-model call on a worker thread, behind the bound.

    ``read`` is looked up on ``read_model`` by the caller rather than imported
    by name here, so a test that patches ``research_graph_read_model.community_labels``
    is patching the thing this actually calls. Binding the function at import
    time was the rejected alternative: it makes the module attribute and the
    thing that runs two different objects, which is exactly the shape of bug
    where a stub is installed and the real Neo4j driver still gets dialled.
    """
    async with _NEO4J_READ_BULKHEAD:
        return await asyncio.to_thread(read, **kwargs)


async def community_labels(*, writing: bool = False, offered: bool = True) -> dict[str, Any]:
    """``research_graph_read_model.community_labels``, off the loop.

    The short-circuit branches inside it — ``offered=False``, or ``writing=True``
    for a sweep that must not read its own last output back — return without
    touching Neo4j, and this wrapper still pays a thread hop for them. That is
    deliberate. The alternative is restating those two conditions here so the
    cheap cases stay inline, which puts the read model's control flow in two
    files and guarantees they drift; the hop costs tens of microseconds against
    a call whose expensive branch costs tens of milliseconds.
    """
    return await _off_loop(read_model.community_labels, writing=writing, offered=offered)


async def centrality_scores(*, offered: bool = True) -> dict[str, Any]:
    """``research_graph_read_model.centrality_scores``, off the loop. See above."""
    return await _off_loop(read_model.centrality_scores, offered=offered)
