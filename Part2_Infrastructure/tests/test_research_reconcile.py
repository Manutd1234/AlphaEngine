"""The reconciliation sweep, tested against a store that behaves like the real one.

The fake here is not a recorder. It holds documents and edges, enforces
``unique (src_id, dst_id, relation)`` the way the migration does, and echoes
back only the rows it actually inserted — because every claim this sweep makes
about itself ("no duplicate", "a retroactive link was made", "nothing was
deferred") is a claim about what a store did, and a fake that accepts everything
would agree with all of them.

One of these tests is the whole reason ``_EdgeWriteGuard`` exists:
``_StrictStore`` rejects a multi-row array containing an already-present edge,
which is what PostgREST does if it resolves ``ignore-duplicates`` against the
primary key rather than the constraint the write forgot to name. Under that
store an unguarded sweep reports a clean tick and writes nothing.
"""

from __future__ import annotations

from typing import Any

from modules.research_reconcile import sweep_edges

NOW_MS = 1_755_000_000_000  # 2025-08-12T12:00:00Z, well after every fixture below


def _doc(doc_id: str, *, occurred_at: str, **over: Any) -> dict[str, Any]:
    base = {
        "id": doc_id,
        "kind": "backtest_run",
        "symbol": "BTCUSDT",
        "strategy": "ma_cross",
        "data_hash": "abc123",
        "occurred_at": occurred_at,
        "metrics": {},
    }
    base.update(over)
    return base


class _Reply:
    def __init__(self, payload: Any, status: int = 200, headers: dict[str, str] | None = None) -> None:
        self._payload = payload
        self.status_code = status
        self.headers = headers or {}

    def json(self) -> Any:
        return self._payload


class _Store:
    """documents + edges, with the migration's uniqueness enforced.

    ``select`` is honoured loosely — enough to keep the desk filter and the
    keyset cursor honest, which is what the sweep's correctness rests on.
    """

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = list(documents)
        self.edges: list[dict[str, Any]] = []
        self.gets: list[dict[str, Any]] = []
        self.posts: list[list[dict[str, Any]]] = []
        self.post_params: list[dict[str, Any] | None] = []

    # -- reads ------------------------------------------------------------- #
    async def get(self, path: str, params: dict[str, Any] | None = None, **_kw: Any) -> _Reply:
        params = params or {}
        self.gets.append(params)
        rows = self._select(params)
        limit = int(params.get("limit") or len(rows) or 1)
        return _Reply(rows[:limit])

    async def head(self, path: str, params: dict[str, Any] | None = None, **_kw: Any) -> _Reply:
        rows = self._select(params or {})
        return _Reply(None, 200, {"content-range": f"0-0/{len(rows)}"})

    def _select(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        rows = list(self.documents)
        horizon = str(params.get("occurred_at") or "")
        if horizon.startswith("lt."):
            rows = [r for r in rows if str(r["occurred_at"]) < horizon[3:]]
        predicate = str(params.get("or") or "")
        if predicate.startswith("(occurred_at.lt."):
            at = predicate[len("(occurred_at.lt."):].split(",")[0]
            doc_id = predicate.split("id.lt.")[-1].rstrip(")")
            rows = [r for r in rows if (str(r["occurred_at"]), str(r["id"])) < (at, doc_id)]
        elif predicate:  # the candidate lookup: symbol.eq.X,strategy.eq.Y,…
            wanted = [term.split(".eq.", 1) for term in predicate.strip("()").split(",")]
            rows = [r for r in rows if any(str(r.get(f)) == v for f, v in wanted)]
        return sorted(rows, key=lambda r: (str(r["occurred_at"]), str(r["id"])), reverse=True)

    # -- writes ------------------------------------------------------------ #
    async def post(self, path: str, json: Any = None, headers: dict[str, str] | None = None,
                   params: dict[str, Any] | None = None, **_kw: Any) -> _Reply:
        rows = json if isinstance(json, list) else [json]
        self.posts.append(rows)
        self.post_params.append(params)
        return self._insert(rows)

    def _insert(self, rows: list[dict[str, Any]]) -> _Reply:
        inserted = []
        for row in rows:
            if self._key(row) in {self._key(e) for e in self.edges}:
                continue  # the unique constraint, under resolution=ignore-duplicates
            self.edges.append(row)
            inserted.append(row)
        return _Reply(inserted, 201)

    @staticmethod
    def _key(row: dict[str, Any]) -> tuple[Any, Any, Any]:
        return (row["src_id"], row["dst_id"], row["relation"])


class _StrictStore(_Store):
    """PostgREST resolving ``ignore-duplicates`` against the primary key.

    A batch containing one already-present edge is rejected ENTIRELY. This is
    the failure the survey called fatal to a sweep: unguarded, every new edge in
    that array is lost and ``persist_edges`` returns 0 without raising.
    """

    def _insert(self, rows: list[dict[str, Any]]) -> _Reply:
        held = {self._key(e) for e in self.edges}
        if len(rows) > 1 and any(self._key(row) in held for row in rows):
            return _Reply({"code": "23505"}, 409)
        if len(rows) == 1 and self._key(rows[0]) in held:
            return _Reply({"code": "23505"}, 409)
        return super()._insert(rows)


class _Unreachable:
    async def get(self, *_a: Any, **_k: Any) -> _Reply:
        raise ConnectionError("connection reset by peer")

    async def post(self, *_a: Any, **_k: Any) -> _Reply:  # pragma: no cover - never reached
        raise ConnectionError("connection reset by peer")


def _corpus() -> list[dict[str, Any]]:
    """A backtest, then an incident four days later — the retroactive case.

    When the backtest was written the incident did not exist, so the write path
    could not have derived the edge between them, and nothing ever revisits the
    backtest.
    """
    return [
        _doc("run-1", occurred_at="2025-08-01T00:00:00Z"),
        _doc("incident-1", occurred_at="2025-08-05T00:00:00Z", kind="risk_incident",
             strategy=None, data_hash=None),
    ]


async def test_a_retroactive_link_is_actually_made():
    store = _Store(_corpus())
    report = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS)

    relations = {(e["src_id"], e["dst_id"], e["relation"]) for e in store.edges}
    assert ("run-1", "incident-1", "same_symbol") in relations
    assert ("run-1", "incident-1", "followed_by") in relations, (
        "the incident that followed a run is the edge the write path could not "
        "have derived: on the day the run was filed the incident did not exist"
    )
    assert report["documents_swept"] == 2
    assert report["edges_written"] == len(store.edges)
    assert report["reachable"] is True


async def test_running_twice_adds_no_duplicate_edge():
    store = _Store(_corpus())
    first = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS)
    after_first = [dict(e) for e in store.edges]

    second = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS)

    assert store.edges == after_first, "a second sweep must add no row at all"
    assert second["edges_written"] == 0
    assert second["edges_already_present"] == first["edges_derived"], (
        "the second tick derives the same edges and finds every one of them "
        "already present — that is what idempotent looks like from the caller"
    )
    assert second["edges_derived"] == first["edges_derived"]


def _two_islands() -> list[dict[str, Any]]:
    """Two pairs that share nothing with each other. Nothing links across."""
    return [
        _doc("btc-1", occurred_at="2025-08-01T00:00:00Z", symbol="BTCUSDT", strategy="s1", data_hash="h1"),
        _doc("btc-2", occurred_at="2025-08-02T00:00:00Z", symbol="BTCUSDT", strategy="s1", data_hash="h1"),
        _doc("eth-1", occurred_at="2025-08-03T00:00:00Z", symbol="ETHUSDT", strategy="s2", data_hash="h2"),
        _doc("eth-2", occurred_at="2025-08-04T00:00:00Z", symbol="ETHUSDT", strategy="s2", data_hash="h2"),
    ]


async def test_a_batch_holding_one_present_edge_does_not_lose_the_new_ones():
    """The guard, against a store that rejects the whole array on one conflict.

    The fixture is the case the guard was written for, and it is not a contrived
    one: an entity that becomes linkable LATER. Every document then derives a
    MIXED array — the edges it already has, plus the one that only just became
    derivable — and under a store that resolves ``ignore-duplicates`` against the
    primary key, every one of those arrays is rejected whole. Both ends of the
    new edge are in that position, so nothing writes it from either side and the
    tick reports success having written nothing.
    """
    store = _StrictStore(_two_islands())
    await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS)
    settled = {(e["src_id"], e["dst_id"], e["relation"]) for e in store.edges}
    assert len(settled) == 6, "three relations across each island, and none between them"

    # The backfill that arrives later: eth-1 turns out to have been run over the
    # same bars as the BTC pair, and its data_hash is corrected to say so.
    for document in store.documents:
        if document["id"] == "eth-1":
            document["data_hash"] = "h1"
    store.posts.clear()
    report = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS)

    gained = {(e["src_id"], e["dst_id"], e["relation"]) for e in store.edges} - settled
    assert gained == {("btc-1", "eth-1", "same_data"), ("btc-2", "eth-1", "same_data")}, (
        "an unguarded batch write loses every new edge in an array that also "
        f"holds one already-present edge, and reports a clean tick: {gained}"
    )
    assert report["edges_written"] == 2
    assert report["writes_failed"] == 0
    assert any(len(rows) == 1 for rows in store.posts), (
        "the guard pays one round trip per edge rather than accepting the loss"
    )


async def test_the_edge_write_names_the_constraint_it_targets():
    store = _Store(_corpus())
    await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS)
    assert store.post_params, "the sweep wrote no edges at all"
    assert all(p and p.get("on_conflict") == "src_id,dst_id,relation" for p in store.post_params), (
        "resolution=ignore-duplicates with no on_conflict target may resolve "
        "against the primary key, which is never in conflict"
    )


async def test_the_batch_bound_holds_and_what_it_deferred_is_reported():
    documents = [
        _doc(f"run-{i:02d}", occurred_at=f"2025-08-{i + 1:02d}T00:00:00Z")
        for i in range(12)
    ]
    store = _Store(documents)
    report = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS, max_documents=4, candidates=5)

    assert report["documents_swept"] == 4, "the tick must stop at its ceiling"
    assert report["deferred"] == 8, (
        "a sweep that silently truncates reads as 'everything is linked'"
    )
    assert report["wrapped"] is False
    assert report["bounds"]["max_documents"] == 4
    assert report["bounds"]["pair_comparisons_at_most"] == 4 * 15

    # The cursor is the last document swept, and the next tick starts below it.
    assert report["cursor"] == {"occurred_at": documents[8]["occurred_at"], "id": documents[8]["id"]}
    following = await sweep_edges(
        store, desk_id="desk-1", now_ms=NOW_MS, cursor=report["cursor"], max_documents=4, candidates=5,
    )
    assert following["cursor"] != report["cursor"], "the cursor must advance or the old documents are never reached"
    assert following["deferred"] == 4


async def test_the_walk_reaches_the_end_and_says_it_wrapped():
    store = _Store(_corpus())
    report = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS, max_documents=8)
    assert report["wrapped"] is True
    assert report["cursor"] is None
    assert report["deferred"] == 0


async def test_an_empty_window_reports_itself_rather_than_being_hidden():
    store = _Store(_corpus())
    exhausted = {"occurred_at": "2000-01-01T00:00:00Z", "id": "0"}
    report = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS, cursor=exhausted)

    assert report["documents_swept"] == 0
    assert report["wrapped"] is True
    assert report["reachable"] is True
    assert "no document older than the cursor" in report["why"]


async def test_an_unreachable_corpus_is_reported_rather_than_counted_as_clean():
    report = await sweep_edges(_Unreachable(), desk_id="desk-1", now_ms=NOW_MS)

    assert report["reachable"] is False
    assert report["documents_swept"] == 0
    assert report["deferred"] is None, "a backlog that could not be counted is not a backlog of zero"
    assert "could not read research_documents" in report["why"]
    assert report["wrapped"] is False, "an unreachable corpus has not been walked to the end"


async def test_an_unconfigured_corpus_is_reported_rather_than_counted_as_clean():
    report = await sweep_edges(None, desk_id="desk-1", now_ms=NOW_MS)
    assert report["reachable"] is False
    assert "not configured" in report["why"]
    assert report["deferred"] is None


async def test_a_corpus_that_dies_mid_sweep_does_not_report_a_clean_tick():
    class _DiesOnCandidates(_Store):
        async def get(self, path: str, params: dict[str, Any] | None = None, **kw: Any) -> _Reply:
            if params and "select" in params and params.get("or", "").startswith("(symbol"):
                return _Reply([], 503)
            return await super().get(path, params, **kw)

    store = _DiesOnCandidates(_corpus())
    report = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS)

    assert report["reachable"] is False
    assert report["documents_not_assessable"] == 2
    assert report["documents_swept"] == 0
    assert store.edges == []


async def test_the_clock_is_injected_and_the_newest_documents_are_left_to_the_write_path():
    """Freshly written documents were linked minutes ago; the sweep starts behind them."""
    fresh = _doc("run-fresh", occurred_at="2025-08-12T11:59:00Z")  # one minute before NOW_MS
    store = _Store([*_corpus(), fresh])
    report = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS, grace_ms=15 * 60_000)

    assert report["documents_swept"] == 2, "the document inside the grace window is not re-swept"
    assert store.gets[0]["occurred_at"] == "lt.2025-08-12T11:45:00Z", (
        "the window boundary is the injected clock minus the grace, not a wall clock"
    )
    assert report["swept_at"] == "2025-08-12T12:00:00Z"
    # It is still a CANDIDATE for the older documents — that is the retroactive
    # link. The grace window bounds which documents the sweep is the subject of,
    # not which documents it may link them to.

    # Move the injected clock forward; no waiting, and now the document is due.
    later = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS + 20 * 60_000, grace_ms=15 * 60_000)
    assert later["documents_swept"] == 3
    assert any("run-fresh" in (e["src_id"], e["dst_id"]) for e in store.edges)


async def test_an_uncountable_backlog_is_null_rather_than_zero():
    class _NoCount(_Store):
        async def head(self, *_a: Any, **_k: Any) -> _Reply:
            return _Reply(None, 500, {})

    store = _NoCount([_doc(f"r-{i}", occurred_at=f"2025-08-{i + 1:02d}T00:00:00Z") for i in range(6)])
    report = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS, max_documents=2, candidates=3)

    assert report["deferred"] is None
    assert "HTTP 500" in report["deferred_reason"]


async def test_the_edge_count_is_null_when_the_store_will_not_say_what_it_wrote():
    class _Minimal(_Store):
        def _insert(self, rows: list[dict[str, Any]]) -> _Reply:
            super()._insert(rows)
            return _Reply(None, 201)  # return=minimal: the split is unknowable

    store = _Minimal(_corpus())
    report = await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS)

    assert report["edges_derived"] > 0
    assert report["edges_written"] is None, "a count that cannot be taken is not zero"
    assert report["edges_already_present"] is None


async def test_the_sweep_is_desk_scoped():
    store = _Store(_corpus())
    await sweep_edges(store, desk_id="desk-9", now_ms=NOW_MS)
    assert store.gets[0]["desk_id"] == "eq.desk-9"
    assert all(e["desk_id"] == "desk-9" for e in store.edges)


def test_the_job_body_reports_an_unconfigured_desk_rather_than_a_clean_tick(monkeypatch):
    """`run_reconcile` is what the scheduler arm calls; it must not answer 'nothing to do'."""
    import config
    from modules.research_reconcile import run_reconcile

    monkeypatch.setattr(config, "settings", type("S", (), {
        "supabase_url": "", "supabase_service_role_key": "",
    })())
    report = run_reconcile({}, now_ms=NOW_MS)

    assert report["reachable"] is False
    assert "SUPABASE_URL" in report["why"]
    assert report["deferred"] is None and report["documents_swept"] == 0


async def test_no_module_level_state_survives_a_tick():
    """The cursor travels in the report, not in a map keyed by anything unbounded."""
    import modules.research_reconcile as reconcile

    store = _Store(_corpus())
    await sweep_edges(store, desk_id="desk-1", now_ms=NOW_MS)
    mutable = {
        name: value for name, value in vars(reconcile).items()
        if isinstance(value, (dict, list, set)) and not name.startswith("__")
    }
    assert not mutable, f"a module-level mutable is a leak waiting to happen: {sorted(mutable)}"
