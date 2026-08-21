"""Reconciliation for the research graph — the edges nothing was in a position to derive.

``persist_edges`` runs one statement after each document is written, over the
candidates that existed AT THAT MOMENT, so the graph is only as complete as the
order the corpus happened to be written in. A backtest filed on Monday is never
joined to the incident that arrives on Friday, and an entity that becomes
linkable later — a ``data_hash`` filled in on an older row — has the same shape.
Every mechanism in this plane is event-driven, so nothing looks back. This module
looks back, on a bounded budget, through the SAME linker.

One linker, never a second: direction is a pure function of ``(occurred_at, id)``
(``_order_key``) and the constraint is on the ORDERED triple, so a sweep that
normalised direction even slightly differently would write the reverse of an
existing edge and the constraint would NOT catch it. Every row goes through
``persist_edges``; ``derive_edges`` is never called here. That reuse costs round
trips rather than edges — ``persist_edges`` keeps only the edges touching the
document it was handed, and a sweep visiting every document reaches every pair
from whichever end it passes first: considered twice, written once.

Repeating a ROW is safe: ``unique (src_id, dst_id, relation)`` rejects it.
Repeating a BATCH is not, and that is the whole reason ``_EdgeWriteGuard``
exists. ``persist_edges`` posts every derived edge as ONE array with
``resolution=ignore-duplicates`` and no ``on_conflict`` naming the constraint —
the omission ``data_ops_postgrest`` corrects for every other table ("a caller
naming the business key alone would target a constraint that does not exist").
If PostgREST resolves that against the primary key (``gen_random_uuid()``, never
in conflict) instead of emitting a bare ``ON CONFLICT DO NOTHING``, one
already-present edge rejects the whole array and every new edge in it is lost,
while ``persist_edges`` returns 0 and never raises. The write path barely feels
it — a duplicate document exits before deriving, so its batches are nearly always
all-new — but a sweep hits it every tick by design, and silent loss, not
duplication, is what would make a sweep worse than no sweep. So the guard names
the constraint, falls back to one edge per request when a batch is rejected
whole, and counts what was inserted rather than what was sent, deriving nothing
itself. ``modules/research_graph.py`` is left alone: it is the write path's, and
the write path works.

State between ticks is a cursor and nothing else, carried in the job params and
returned in the result, so nothing module-level can grow here. The clock is
injected — a tick starts at ``now_ms`` minus a grace window, because documents
written minutes ago were just linked by the write path — which is also what makes
the schedule testable without waiting.

Nothing is ever DELETED. A relation that stopped being derivable keeps its row:
pruning needs a rule separating "no longer true" from "not re-derived because the
candidate window moved", and that rule is not written yet.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from modules.research_corpus_reads import _backlog, _fetch, _iso, _query, _report
from modules.research_graph import persist_edges

log = logging.getLogger("alphaengine.research_reconcile")

_EDGES = "/rest/v1/research_edges"

#: The columns ``persist_edges`` reads off a stored row — named rather than ``*``,
#: so a column added to the table does not silently widen every tick.

#: The constraint the edge write must name. Not ``desk_id``-prefixed: unlike the
#: data-operations tables, ``research_edges_are_unique`` is on the triple alone.
_CONFLICT_TARGET = "src_id,dst_id,relation"

#: Per-tick ceiling, fixed and independent of corpus size — which is why the
#: report carries the cursor and the backlog. A sweep that writes edges every tick
#: while never catching up looks healthy; only those two numbers say otherwise.
MAX_DOCUMENTS_PER_TICK = 25

#: Candidates per document, passed straight to ``persist_edges``. ``derive_edges``
#: is O(n²) over what it is given: 41 documents is 820 pair comparisons, so a full
#: tick is at most 20,500 of them in pure Python. That number, not the word
#: "bounded".
MAX_CANDIDATES_PER_DOCUMENT = 40

#: Documents younger than this were linked by the write path minutes ago, and
#: re-sweeping them would spend the budget on the one corner already correct.
RECENT_GRACE_MS = 15 * 60_000




class _Reply:
    """A status and a body — all ``persist_edges`` reads off a response. Presents a
    stored row to it as though just inserted, and hands the guard's verdict back."""

    def __init__(self, payload: Any, status: int = 200) -> None:
        self._payload = payload
        self.status_code = status

    def json(self) -> Any:
        return self._payload


class _EdgeWriteGuard:
    """Wraps the client so a repeated edge write cannot lose the new edges in it.

    Derives nothing: it re-sends the array ``persist_edges`` built, with the
    conflict target that array should always have carried, and counts.
    """

    def __init__(self, client: Any) -> None:
        self._client = client
        self.edges_derived = 0
        #: ``None`` — never 0 — once the store stops saying which rows were new.
        #: The reconciler's telemetry is held to the desk's own rule about
        #: measurements that could not be taken.
        self.edges_written: int | None = 0
        self.edges_already_present: int | None = 0
        self.reads_failed = 0
        self.writes_failed = 0
        self.last_error: str | None = None
        #: The edge rows this tick derived, kept so the Neo4j projection can
        #: MERGE exactly what Postgres was asked to hold — rather than reading
        #: them back and risking a second, subtly different view of the same
        #: sweep. Bounded by the tick's own document and candidate ceilings.
        self.rows_seen: list[dict[str, Any]] = []

    async def get(self, path: str, params: dict[str, Any] | None = None, **kwargs: Any) -> Any:
        try:
            response = await self._client.get(path, params=params, **kwargs)
        except Exception as exc:
            self._fail_read(f"{type(exc).__name__} reading {path}")
            raise
        if getattr(response, "status_code", 599) >= 300:
            self._fail_read(f"HTTP {response.status_code} reading {path}")
        return response

    def _fail_read(self, why: str) -> None:
        self.reads_failed += 1
        self.last_error = why

    async def post(self, path: str, json: Any = None, headers: dict[str, str] | None = None, **kwargs: Any) -> Any:
        if path != _EDGES:
            return await self._client.post(path, json=json, headers=headers, **kwargs)
        rows = _deduped(json)
        self.edges_derived += len(rows)
        self.rows_seen.extend(rows)
        if not rows:
            return _Reply([], 200)
        response = await self._send(rows)
        if response is not None and response.status_code < 300:
            self._count(len(rows), response)
            return response
        # Rejected as a whole: the case where a sweep would otherwise report a
        # clean tick having written nothing. Pay the round trips instead.
        return await self._one_at_a_time(rows)

    async def _send(self, rows: list[dict[str, Any]]) -> Any | None:
        # `return=representation` is the honest half: under `return=minimal` the
        # split between "newly written" and "already there" is unknowable, and
        # reporting that split is this sweep's job.
        try:
            return await self._client.post(
                _EDGES, json=rows, params={"on_conflict": _CONFLICT_TARGET},
                headers={"Prefer": "resolution=ignore-duplicates,return=representation"},
            )
        except Exception as exc:
            self.last_error = f"{type(exc).__name__} writing edges"
            return None

    async def _one_at_a_time(self, rows: list[dict[str, Any]]) -> _Reply:
        worst = 200
        for row in rows:
            response = await self._send([row])
            status = getattr(response, "status_code", 599) if response is not None else 599
            if status == 409:
                # One row conflicting on the unique constraint means that edge is
                # already there: reconciled, not failed.
                self._add(0, 1)
            elif status >= 300:
                self.writes_failed += 1
                self.last_error = f"HTTP {status} writing an edge"
                worst = max(worst, status)
            else:
                self._count(1, response)
        return _Reply([], worst)

    def _count(self, sent: int, response: Any) -> None:
        try:
            body = response.json()
        except Exception:
            body = None
        if isinstance(body, list):
            # `ignore-duplicates` echoes back only the rows it inserted, so the
            # shortfall is the count that was already present.
            self._add(len(body), max(sent - len(body), 0))
        else:
            self.edges_written = None
            self.edges_already_present = None

    def _add(self, written: int, already: int) -> None:
        if self.edges_written is not None:
            self.edges_written += written
        if self.edges_already_present is not None:
            self.edges_already_present += already


def _deduped(json: Any) -> list[dict[str, Any]]:
    """One row per ordered triple: "edges derived" must mean distinct edges, not rows sent.
    The candidate lookup returns the swept document itself, so ``derive_edges`` sees it
    twice and emits each of its edges twice."""
    rows = json if isinstance(json, list) else [json] if isinstance(json, dict) else []
    seen: set[tuple[Any, Any, Any]] = set()
    unique: list[dict[str, Any]] = []
    for row in rows:
        key = (row.get("src_id"), row.get("dst_id"), row.get("relation"))
        if key not in seen:
            seen.add(key)
            unique.append(row)
    return unique




async def sweep_edges(
    client: Any, *, desk_id: str, now_ms: float, cursor: dict[str, Any] | None = None,
    max_documents: int = MAX_DOCUMENTS_PER_TICK, candidates: int = MAX_CANDIDATES_PER_DOCUMENT,
    grace_ms: float = RECENT_GRACE_MS,
) -> dict[str, Any]:
    """One tick: re-link at most ``max_documents`` documents older than the cursor.

    Nothing survives the call but the cursor in the returned report, which the
    caller feeds back next tick. When it does not, the sweep restarts at the
    newest document and says so through ``wrapped``, rather than pretending it
    reached the old ones.
    """
    report = _report(now_ms, max_documents=max_documents, candidates=candidates)
    report["cursor"] = cursor
    if client is None:
        return _unreachable(report, "the research corpus is not configured, so nothing could be swept")

    horizon = _iso(now_ms - grace_ms)
    batch = await _fetch(client, _query(desk_id=desk_id, cursor=cursor, horizon=horizon), max_documents)
    if batch is None:
        return _unreachable(report, "could not read research_documents; this tick swept nothing")
    if not batch:
        report["why"] = "no document older than the cursor and outside the grace window; the next tick starts at the newest"
        return _wrapped(report)

    guard = _EdgeWriteGuard(client)
    last_clean = await _sweep_batch(guard, batch, desk_id=desk_id, candidates=candidates, report=report)
    report["graph"] = _project_graph(batch, guard.rows_seen)
    report["edges_derived"] = guard.edges_derived
    report["edges_written"] = guard.edges_written
    report["edges_already_present"] = guard.edges_already_present
    report["writes_failed"] = guard.writes_failed
    if report["documents_swept"] == 0:
        return _unreachable(report, f"every document in the batch failed to link ({guard.last_error})")

    # The cursor advances only over documents that linked cleanly: a window swept
    # twice is idempotent and cheap, a window skipped is the silent defect this
    # module exists to close.
    if last_clean is not None:
        report["cursor"] = {"occurred_at": last_clean.get("occurred_at"), "id": last_clean.get("id")}
    if len(batch) < max_documents and report["documents_not_assessable"] == 0:
        return _wrapped(report)
    report["deferred"], report["deferred_reason"] = await _backlog(
        client, _query(desk_id=desk_id, cursor=report["cursor"], horizon=horizon),
    )
    return report


def _project_graph(batch: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    """Copy this tick's derived edges into Neo4j, if one is configured.

    Postgres is authoritative and this is a read model, so a projection failure
    is reported and the sweep carries on: the edges are already durable in
    `research_edges`, and the graph can be rebuilt from them at any time. That
    is the whole reason this is safe to call inline.
    """
    from modules.research_graph_projection import project

    return project(
        [{k: d.get(k) for k in ("id", "kind", "symbol", "strategy", "data_hash", "occurred_at")}
         for d in batch],
        edges,
    )


async def _sweep_batch(
    guard: _EdgeWriteGuard, batch: list[dict[str, Any]], *,
    desk_id: str, candidates: int, report: dict[str, Any],
) -> dict[str, Any] | None:
    """Link each document through ``persist_edges``; return the last clean one."""
    last_clean: dict[str, Any] | None = None
    for document in batch:
        before = (guard.reads_failed, guard.writes_failed)
        try:
            await persist_edges(guard, _Reply([document]), desk_id=desk_id, limit=candidates)
        except Exception as exc:  # persist_edges swallows its own; belt and braces
            guard.last_error = f"{type(exc).__name__} linking {document.get('id')}"
        if (guard.reads_failed, guard.writes_failed) != before:
            report["documents_not_assessable"] += 1
            continue
        report["documents_swept"] += 1
        last_clean = document
    return last_clean


def _wrapped(report: dict[str, Any]) -> dict[str, Any]:
    """The walk reached the oldest document; the next tick starts from the newest."""
    report["wrapped"] = True
    report["cursor"] = None
    report["deferred"], report["deferred_reason"] = 0, "counted"
    return report


def _unreachable(report: dict[str, Any], why: str) -> dict[str, Any]:
    """"Could not sweep" is not "nothing to do", and must not read as clean."""
    report["reachable"] = False
    report["why"] = why
    report["deferred_reason"] = "unknown — the corpus could not be read"
    log.warning("research reconcile: %s", why)
    return report


def run_reconcile(params: dict[str, Any], *, now_ms: float) -> dict[str, Any]:
    """The job body, for a scheduler arm submitting kind ``data.reconcile``.

    Synchronous like every other job executor here, and it builds its OWN client
    rather than borrowing the one ``ResearchRag`` holds: that one is bound to the
    gateway's event loop and this runs on the queue's worker thread. The result
    keys stay clear of ``finding``, which the data-job completion hook files as a
    data-quality escalation.
    """
    from config import settings

    cursor = params.get("cursor") if isinstance(params.get("cursor"), dict) else None
    documents = int(params.get("max_documents") or MAX_DOCUMENTS_PER_TICK)
    candidates = int(params.get("candidates") or MAX_CANDIDATES_PER_DOCUMENT)
    key = settings.supabase_service_role_key
    if not (settings.supabase_url and key):
        return _unreachable(
            _report(now_ms, max_documents=documents, candidates=candidates),
            "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset, so the corpus could not be reached",
        )

    import httpx

    async def _run() -> dict[str, Any]:
        headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(
            base_url=settings.supabase_url.rstrip("/"), headers=headers, timeout=settings.supabase_timeout_s,
        ) as client:
            return await sweep_edges(
                client, desk_id=settings.supabase_desk_id, now_ms=now_ms, cursor=cursor,
                max_documents=documents, candidates=candidates,
            )

    return asyncio.run(_run())

def reconcile_graph(
    *,
    desk_id: str,
    limit: int = MAX_DOCUMENTS_PER_TICK,
    now_ms: float | None = None,
    job_id: str | None = None,
) -> dict[str, Any]:
    """The name and shape ``modules/research_schedule`` resolves and calls.

    A thin adapter over :func:`run_reconcile`, and it exists because the two
    modules were written in parallel and did not meet: the scheduler resolves
    an entry point by NAME and calls it with keyword arguments it filters
    against the callee's signature, while ``run_reconcile`` takes a positional
    params dict. Resolution therefore failed, the sweep never ran, and the
    suite stayed green because the scheduler's own tests substitute a stand-in
    for this module — so the mismatch was invisible from both sides.

    ``tests/test_research_contract.py`` pins the two together against the REAL
    modules, which is the check that was missing rather than this function.
    """
    del job_id  # accepted so the scheduler may offer it; the sweep has no use for it
    params: dict[str, Any] = {"desk_id": desk_id, "max_documents": int(limit)}
    return run_reconcile(params, now_ms=now_ms if now_ms is not None else time.time() * 1000.0)


# Resolved by NAME from `research_schedule` like every other entry point; it
# LIVES in `research_graph_reads` because this module is fenced off from the
# community machinery — a tick carries one window's edges, and the fence keeps
# the whole-corpus partition from ever looking like the obvious next commit.
from modules.research_graph_reads import reconcile_communities  # noqa: E402, F401
