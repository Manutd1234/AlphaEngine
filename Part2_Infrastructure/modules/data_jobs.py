"""Replay and backfill — the data-plane jobs the gateway orchestrates.

Two kinds, on the same job queue the backtester uses (in-process pool or
Celery, whichever is configured):

* ``data.replay`` re-runs one capability for one symbol through the web
  workspace's own validated fetch path — ``GET /api/system/inspect`` with
  ``refresh=1`` — because the provider adapters, credentials and data
  contracts live only there, and a second Python implementation would be a
  second thing to drift. The contract result comes back and is recorded in the
  quality ledger with ``source="replay"``.
* ``data.backfill`` fetches bars for a date range (Binance klines for a crypto
  pair, the workspace's ``/api/ohlcv`` for an equity), runs a Python mirror of
  the bar contract (same check ids), and — only if the series is clean — merges
  the rows into the gateway's bar cache, the offline tier the backtester reads.

Persistence happens in the completion hook, on the gateway's loop, for both
backends: a worker fetches and validates and returns; the gateway writes. The
job list is the queue's in-process memory (the audit log keeps status rows) and
says so.
"""

from __future__ import annotations

import logging
import math
import statistics
import time
from datetime import datetime, timezone
from typing import Any, Callable

from config import settings
from modules.data_ops_store import SqliteStore
from modules.jobs import JobRecord, get_queue
from modules.schemas import DataBackfillRequest, DataReplayRequest

log = logging.getLogger("alphaengine.data_jobs")

REPLAY_KIND = "data.replay"
BACKFILL_KIND = "data.backfill"
DATA_KIND_PREFIX = "data."

INTERVAL_MS: dict[str, int] = {"15m": 15 * 60_000, "1h": 3_600_000, "4h": 4 * 3_600_000, "1d": 86_400_000}

# Mirrors lib/providers/contracts.ts — the same tolerance, the same check ids.
MAX_GAP_MULTIPLE = 4.5

_EQUITY_RE = __import__("re").compile(r"^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$")


def is_equity(symbol: str) -> bool:
    return _EQUITY_RE.fullmatch(symbol.upper()) is not None


def executor_configured() -> bool:
    return bool(settings.resolved_web_workspace_url)


# --------------------------------------------------------------------------- #
# The bar contract, in Python — the same check ids as checkBars
# --------------------------------------------------------------------------- #
def check_bars_rows(rows: list[tuple[Any, ...]], requested: int | None = None) -> dict[str, Any]:
    """rows: (ts_ms, open, high, low, close, volume), ascending or not.

    Returns ``{passed, violations: [{check, severity, message}], not_evaluated: [...]}``
    with the ids and severities ``checkBars`` uses in the web, so a finding
    written by a backfill reads the same as one written by a live fetch.
    """
    violations: list[dict[str, Any]] = []
    not_evaluated: list[str] = []
    if not rows:
        return {
            "passed": False,
            "violations": [{"check": "bars.non_empty", "severity": "fatal", "message": "The provider returned no bars."}],
            "not_evaluated": ["bars.monotonic", "bars.high_ge_low", "bars.no_gaps"],
        }

    def finite(v: Any) -> bool:
        return isinstance(v, (int, float)) and math.isfinite(float(v))

    out_of_order = duplicated = inverted = non_positive = 0
    for i, bar in enumerate(rows):
        ts, o, h, lo, c, _v = bar
        if not all(finite(x) for x in (o, h, lo, c)) or float(c) <= 0:
            non_positive += 1
        if finite(h) and finite(lo) and float(h) < float(lo):
            inverted += 1
        if i > 0:
            prev = rows[i - 1][0]
            if ts == prev:
                duplicated += 1
            elif ts < prev:
                out_of_order += 1
    if non_positive:
        violations.append({"check": "bars.prices_finite", "severity": "fatal", "message": f"{non_positive} bar(s) carry a null or non-positive price."})
    if inverted:
        violations.append({"check": "bars.high_ge_low", "severity": "fatal", "message": f"{inverted} bar(s) have a high below their low."})
    if duplicated:
        violations.append({"check": "bars.unique_timestamps", "severity": "fatal", "message": f"{duplicated} duplicated timestamp(s) — returns would be double-counted."})
    if out_of_order:
        violations.append({"check": "bars.monotonic", "severity": "fatal", "message": f"{out_of_order} bar(s) arrive out of chronological order."})
    if requested:
        if len(rows) < requested * 0.5:
            violations.append({"check": "bars.coverage", "severity": "warn", "message": f"Only {len(rows)} of {requested} requested bars were returned."})
    else:
        not_evaluated.append("bars.coverage")
    if len(rows) >= 5:
        spacings = [rows[i][0] - rows[i - 1][0] for i in range(1, len(rows))]
        median = statistics.median(spacings)
        largest = max(spacings)
        if median > 0 and largest > median * MAX_GAP_MULTIPLE:
            violations.append({"check": "bars.no_gaps", "severity": "warn", "message": f"Largest interval is {largest / median:.1f}x the median spacing — bars are missing."})
    else:
        not_evaluated.append("bars.no_gaps")
    return {
        "passed": not any(v["severity"] == "fatal" for v in violations),
        "violations": violations,
        "not_evaluated": not_evaluated,
    }


# --------------------------------------------------------------------------- #
# Executors — run on a worker; fetch, validate, return; never persist
# --------------------------------------------------------------------------- #
def _client(client: Any | None):
    import httpx

    return client or httpx.Client(timeout=settings.data_job_timeout_s), client is None


def run_replay(params: dict[str, Any], *, client: Any | None = None) -> dict[str, Any]:
    """One capability through the workspace's validated path, cache bypassed."""
    req = DataReplayRequest(**params)
    base = settings.resolved_web_workspace_url
    if not base:
        raise RuntimeError("replay executor not configured — set WEB_WORKSPACE_URL")
    query: dict[str, Any] = {"symbol": req.symbol.upper(), "capability": req.capability, "priority": "interactive", "refresh": "1"}
    if req.capability == "bars":
        query["interval"] = req.interval
        query["bars"] = req.bars
    http, owned = _client(client)
    started = time.time()
    try:
        response = http.get(f"{base}/api/system/inspect", params=query)
        response.raise_for_status()
        body = response.json()
    finally:
        if owned:
            http.close()
    if not isinstance(body, dict):
        raise RuntimeError("the workspace answered with a non-object body")
    provenance = body.get("provenance") if isinstance(body.get("provenance"), dict) else None
    contract = provenance.get("contract") if provenance and isinstance(provenance.get("contract"), dict) else None
    attempts = body.get("attempts") if isinstance(body.get("attempts"), list) else []
    if body.get("reason") == "not_applicable":
        outcome = "not_applicable"
    elif not body.get("ok"):
        outcome = "unanswered"
    elif contract is None:
        outcome = "unchecked"
    elif not contract.get("passed", True):
        outcome = "rejected"
    elif contract.get("violations"):
        outcome = "flagged"
    else:
        outcome = "clean"
    finding = None
    if contract is not None and provenance is not None:
        finding = {
            "capability": req.capability,
            "provider": str(provenance.get("provider") or "unknown"),
            "symbol": req.symbol.upper(),
            "key": str((body.get("cache") or {}).get("key") or ""),
            "passed": bool(contract.get("passed", True)),
            "violations": [v for v in contract.get("violations", []) if isinstance(v, dict)],
            "not_evaluated": len(contract.get("notEvaluated", []) or []),
        }
    return {
        "outcome": outcome,
        "symbol": req.symbol.upper(),
        "capability": req.capability,
        "provider": provenance.get("provider") if provenance else None,
        "cache_state": (body.get("cache") or {}).get("state"),
        "latency_ms": provenance.get("latencyMs") if provenance else None,
        "elapsed_ms": round((time.time() - started) * 1000),
        "contract": contract,
        "attempts": [{"provider": a.get("provider"), "reason": a.get("reason")} for a in attempts if isinstance(a, dict)],
        "error": body.get("error"),
        "finding": finding,
    }


def _binance_rows(symbol: str, interval: str, from_ms: int, to_ms: int, max_bars: int, client: Any | None) -> list[tuple[Any, ...]]:
    from modules.backtester import fetch_binance_range

    raw = fetch_binance_range(symbol, interval, from_ms, to_ms, max_bars=max_bars, client=client)
    rows: list[tuple[Any, ...]] = []
    for k in raw:
        try:
            rows.append((int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])))
        except (TypeError, ValueError, IndexError):
            continue
    return rows


def _web_rows(symbol: str, interval: str, from_ms: int, to_ms: int, max_bars: int, client: Any | None) -> tuple[list[tuple[Any, ...]], str | None]:
    base = settings.resolved_web_workspace_url
    if not base:
        raise RuntimeError("backfill for an equity needs the workspace — set WEB_WORKSPACE_URL")
    span = max(1, int(math.ceil((to_ms - from_ms) / INTERVAL_MS[interval] * 1.4)))
    bars = max(10, min(max_bars, span))
    http, owned = _client(client)
    try:
        response = http.get(f"{base}/api/ohlcv", params={"symbol": symbol, "interval": interval, "bars": bars})
        response.raise_for_status()
        body = response.json()
    finally:
        if owned:
            http.close()
    data = body.get("data") if isinstance(body, dict) else None
    provider = (body.get("provenance") or {}).get("provider") if isinstance(body, dict) else None
    rows: list[tuple[Any, ...]] = []
    for bar in data or []:
        if not isinstance(bar, dict):
            continue
        try:
            ts = int(bar["t"])
        except (KeyError, TypeError, ValueError):
            continue
        if ts < from_ms or ts > to_ms:
            continue
        rows.append((ts, float(bar.get("o", 0)), float(bar.get("h", 0)), float(bar.get("l", 0)), float(bar.get("c", 0)), float(bar.get("v", 0))))
    return rows, provider


def run_backfill(
    params: dict[str, Any],
    *,
    progress: Callable[[float, str], None] | None = None,
    client: Any | None = None,
) -> dict[str, Any]:
    req = DataBackfillRequest(**params)
    symbol = req.symbol.upper()
    from_ms = int(req.from_at.timestamp() * 1000)
    to_ms = int(req.to_at.timestamp() * 1000)
    max_bars = settings.data_backfill_max_bars
    expected = int((to_ms - from_ms) / INTERVAL_MS[req.interval]) + 1
    if expected > max_bars:
        raise ValueError(f"the range spans {expected} bars; the backfill cap is {max_bars}")
    if progress:
        progress(0.05, "fetching")
    if is_equity(symbol):
        rows, provider = _web_rows(symbol, req.interval, from_ms, to_ms, max_bars, client)
        source = "web-registry"
    else:
        rows = _binance_rows(symbol, req.interval, from_ms, to_ms, max_bars, client)
        provider, source = "binance", "binance"
    rows.sort(key=lambda r: r[0])
    if progress:
        progress(0.7, f"{len(rows)} rows fetched; checking")
    contract = check_bars_rows(rows, expected)
    outcome = "empty" if not rows else "rejected" if not contract["passed"] else "flagged" if contract["violations"] else "clean"
    if progress:
        progress(0.95, outcome)
    return {
        "outcome": outcome,
        "symbol": symbol,
        "interval": req.interval,
        "source": source,
        "provider": provider,
        "from_ms": from_ms,
        "to_ms": to_ms,
        "rows_fetched": len(rows),
        "expected": expected,
        "first_ts": rows[0][0] if rows else None,
        "last_ts": rows[-1][0] if rows else None,
        "contract": contract,
        # Rows travel back to the gateway hook, which persists them and drops
        # them from the retained result.
        "rows": rows,
        "finding": {
            "capability": "bars",
            "provider": provider or source,
            "symbol": symbol,
            "key": f"bars:{symbol}:{req.interval}:backfill",
            "passed": contract["passed"],
            "violations": contract["violations"],
            "not_evaluated": len(contract["not_evaluated"]),
        },
    }


# --------------------------------------------------------------------------- #
# Submission and the completion hook (gateway loop)
# --------------------------------------------------------------------------- #
def submit_replay(req: DataReplayRequest, *, actor: str) -> JobRecord:
    params = req.model_dump()
    return get_queue().submit(REPLAY_KIND, run_replay, params, meta={"actor": actor, "params": params})


def submit_backfill(req: DataBackfillRequest, *, actor: str) -> JobRecord:
    params = req.model_dump(mode="json")
    return get_queue().submit(BACKFILL_KIND, run_backfill, params, meta={"actor": actor, "params": params})


def _summary(record: JobRecord) -> dict[str, Any] | None:
    result = record.result if isinstance(record.result, dict) else None
    if result is None:
        return None
    return {k: v for k, v in result.items() if k not in ("rows", "finding")}


async def on_data_job_complete(record: JobRecord) -> None:
    """Persist a finished data job: the finding to the ledger, clean bars to the cache."""
    if not record.kind.startswith(DATA_KIND_PREFIX) or record.status != "succeeded":
        return
    result = record.result if isinstance(record.result, dict) else None
    if result is None:
        return
    import asyncio

    def persist() -> dict[str, Any]:
        written: dict[str, Any] = {}
        finding = result.get("finding")
        if isinstance(finding, dict):
            from modules.data_quality import get_data_quality

            source = "replay" if record.kind == REPLAY_KIND else "backfill"
            opened = get_data_quality().record(
                source=source,  # type: ignore[arg-type]
                capability=str(finding["capability"]),
                provider=str(finding["provider"]),
                symbol=finding.get("symbol"),
                key=str(finding.get("key") or ""),
                passed=bool(finding["passed"]),
                violations=list(finding.get("violations") or []),
                not_evaluated=int(finding.get("not_evaluated") or 0),
                instance=f"gateway:{record.job_id}",
            )
            written["escalations_opened"] = len(opened)
            written["_opened"] = opened
        rows = result.get("rows")
        if record.kind == BACKFILL_KIND and isinstance(rows, list) and rows and result.get("outcome") in ("clean", "flagged"):
            from modules.audit import get_audit

            stamped = [
                (datetime.fromtimestamp(r[0] / 1000.0, tz=timezone.utc).replace(tzinfo=None), r[1], r[2], r[3], r[4], r[5])
                for r in rows
            ]
            written["rows_written"] = get_audit().upsert_ohlcv(str(result["symbol"]), str(result["interval"]), stamped)
        elif record.kind == BACKFILL_KIND:
            written["rows_written"] = 0
        return written

    try:
        written = await asyncio.to_thread(persist)
    except Exception as exc:
        log.error("data job %s persist failed: %s", record.job_id, exc)
        result["persist_error"] = f"{type(exc).__name__}: {exc}"
        return
    opened = written.pop("_opened", [])
    result.pop("rows", None)
    result.update(written)
    result["persisted_at"] = datetime.now(timezone.utc).isoformat()
    for escalation in opened:
        from modules.data_quality import publish_escalation

        asyncio.create_task(publish_escalation(escalation))


# --------------------------------------------------------------------------- #
# Read model
# --------------------------------------------------------------------------- #
def job_view(record: JobRecord) -> dict[str, Any]:
    status = record.to_status().model_dump(mode="json")
    status["params"] = record.meta.get("params", {}) if isinstance(record.meta, dict) else {}
    status["actor"] = str(record.meta.get("actor", "")) if isinstance(record.meta, dict) else ""
    status["summary"] = _summary(record)
    return status


class ScheduleRunStore(SqliteStore):
    """Restart safety for the scheduler: when each schedule last fired."""

    _DDL = [
        """
        CREATE TABLE IF NOT EXISTS data_schedule_runs (
            schedule_id TEXT PRIMARY KEY,
            last_run_at REAL,
            last_job_id TEXT,
            last_outcome TEXT
        )
        """,
    ]

    def __init__(self, path: str) -> None:
        super().__init__(path)
        self.migrate(self._DDL)

    def last_run(self, schedule_id: str) -> dict[str, Any] | None:
        return self.one("SELECT * FROM data_schedule_runs WHERE schedule_id=?", (schedule_id,))

    def record_run(self, schedule_id: str, at_ms: float, job_id: str, outcome: str) -> None:
        self.execute(
            "INSERT INTO data_schedule_runs (schedule_id, last_run_at, last_job_id, last_outcome) VALUES (?,?,?,?) "
            "ON CONFLICT(schedule_id) DO UPDATE SET last_run_at=excluded.last_run_at, last_job_id=excluded.last_job_id, last_outcome=excluded.last_outcome",
            (schedule_id, at_ms, job_id, outcome),
        )
