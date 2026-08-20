"""Persisting an ML run: the row, its folds, its features, its artefact.

Nothing wrote to the ml_* tables. The migrations defined them, the runner
produced results, and the two never met — which made every downstream slice
(the corpus card, the routes, the panel) a route over an empty table.

Two properties this store is built around.

**A run is written whole or not at all.** The row goes in first with
status='running', the children follow, and the status is set to 'succeeded' last.
A reader that finds status='running' on a run nobody is running is looking at a
crash, which is a true and useful thing to see. The alternative — writing
'succeeded' first and the folds after — produces a run that claims a verdict it
has no evidence for, and that is the failure mode worth engineering against.

**Unconfigured is a state, not an error.** With no Supabase the store reports
``persisted=False`` and the run still happened; the caller keeps its result. The
gateway already treats a missing mirror this way everywhere else, and a research
tool that refuses to compute because it cannot file the answer is worse than one
that computes and says it could not file it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from config import settings
from modules.ml.engine import ENGINE
from modules.ml.features import FeatureSet
from modules.ml.runner import MLRunResult

log = logging.getLogger("alphaengine.ml.store")


def _git_sha() -> str | None:
    """The tree that fitted the model, or None.

    A fitted model is a function of the code that fitted it in a way a moving
    average is not, so two runs with the same data_hash and different shas are
    two different experiments. None when git is unavailable — a fabricated sha
    would be worse than an absent one.
    """
    try:
        return subprocess.run(  # noqa: S603 — fixed argv, no caller input
            ["git", "rev-parse", "HEAD"],  # noqa: S607
            capture_output=True, text=True, timeout=2, check=True,
        ).stdout.strip() or None
    except Exception:  # noqa: BLE001 — a tarball build has no git and that is fine
        return None


@dataclass(frozen=True, slots=True)
class PersistResult:
    """What the store managed to write, and why not when it did not."""

    persisted: bool
    run_id: str | None = None
    reason: str | None = None

    @property
    def as_dict(self) -> dict[str, Any]:
        return {"persisted": self.persisted, "run_id": self.run_id, "reason": self.reason}


class MLRunStore:
    """Writes runs, folds, features and artefacts to Supabase over PostgREST."""

    def __init__(self) -> None:
        self.enabled = bool(settings.supabase_url and settings.supabase_service_role_key)
        self._client: httpx.AsyncClient | None = None

    async def start(self) -> None:
        if not self.enabled or self._client:
            return
        self._client = httpx.AsyncClient(
            base_url=settings.supabase_url.rstrip("/"),
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
                # Ask PostgREST for the inserted row so the run id comes back
                # without a second round trip to find what we just wrote.
                "Prefer": "return=representation",
            },
            timeout=settings.supabase_timeout_s,
        )

    async def stop(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _insert(self, table: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
        if not self._client or not rows:
            return None
        response = await self._client.post(f"/rest/v1/{table}", json=rows)
        if response.status_code >= 400:
            log.warning("ml store: %s insert failed HTTP %s", table, response.status_code)
            return None
        try:
            return response.json()
        except ValueError:
            return []

    async def _fail(self, run_id: str, error: str) -> None:
        """Mark a run failed with its reason. The schema refuses a failed row
        that carries no error, so this is the only way a run can end badly."""
        if not self._client:
            return
        try:
            await self._client.patch(
                f"/rest/v1/ml_runs?id=eq.{run_id}",
                json={"status": "failed", "error": error[:500],
                      "finished_at": datetime.now(UTC).isoformat()},
            )
        except Exception:  # noqa: BLE001
            log.warning("ml store: could not mark run %s failed", run_id)

    # ---------------------------------------------------------------- #
    # Reading
    # ---------------------------------------------------------------- #
    # THE RLS CAVEAT, STATED WHERE THE QUERY IS.
    #
    # ml_runs' SELECT policy is `auth.uid() = user_id`, written for a browser
    # holding a user's JWT. This client holds the SERVICE ROLE key, which
    # bypasses RLS entirely, and the gateway's own auth (`trader_identity`)
    # resolves to 'web:token' or 'web:anonymous' — an access decision, not an
    # identity. There is no uid here to scope by.
    #
    # So the scope is applied in the QUERY, by desk_id, and that is the only
    # thing standing between one desk and another on this path. It is honest
    # today because the deployment is single-desk — desk_id has one value and
    # a default — and it is written here rather than assumed so that the day a
    # second desk exists, this is the line that has to change. A policy that
    # cannot fire is not a policy; pretending otherwise is how a boundary is
    # discovered to have never existed.
    DEFAULT_DESK_ID = "00000000-0000-0000-0000-000000000001"

    async def list_runs(self, limit: int = 25, desk_id: str | None = None) -> list[dict[str, Any]] | None:
        """Recent runs, newest first.

        ``None`` means the question could not be asked; ``[]`` means it was
        asked and the answer is none. Every branch used to return ``[]``,
        including a bad service-role key and a missing table — so a corpus that
        could not be READ reported as a desk that had never fitted anything, and
        the panel said "the corpus is reachable" about a corpus it had failed to
        reach. The docstring already promised this behaviour; the code did not
        have it.
        """
        if not self.enabled:
            return None
        if self._client is None:
            await self.start()
        if self._client is None:
            return None
        params = {
            "desk_id": f"eq.{desk_id or self.DEFAULT_DESK_ID}",
            "select": (
                "id,model,symbol,interval,data_hash,seed,git_sha,engine,status,"
                "oos_sharpe,deflated_sharpe,pbo,started_at,finished_at,error"
            ),
            "order": "started_at.desc",
            "limit": str(max(1, min(int(limit), 100))),
        }
        try:
            response = await self._client.get("/rest/v1/ml_runs", params=params)
        except Exception as exc:
            log.warning("ml store: list_runs failed (%s)", type(exc).__name__)
            return None
        if response.status_code >= 400:
            log.warning("ml store: list_runs HTTP %s", response.status_code)
            return None
        return response.json() or []

    async def get_run(self, run_id: str, desk_id: str | None = None) -> dict[str, Any] | None:
        """One run with its folds and feature spec, or None when there is no
        such run on this desk. None is 'not found', never 'not configured' —
        the caller distinguishes those and so must this."""
        if not self.enabled:
            return None
        if self._client is None:
            await self.start()
        if self._client is None:
            return None
        scope = f"eq.{desk_id or self.DEFAULT_DESK_ID}"

        runs = await self._client.get("/rest/v1/ml_runs", params={
            "id": f"eq.{run_id}", "desk_id": scope, "select": "*",
        })
        if runs.status_code >= 400 or not runs.json():
            return None
        run = runs.json()[0]

        folds = await self._client.get("/rest/v1/ml_folds", params={
            "run_id": f"eq.{run_id}",
            "select": ("fold_index,train_start,train_end,test_start,test_end,train_rows,"
                       "test_rows,purge_bars,embargo_bars,oos_return,oos_sharpe,"
                       "oos_max_drawdown,trades"),
            "order": "fold_index.asc",
        })
        features = await self._client.get("/rest/v1/ml_features", params={
            "run_id": f"eq.{run_id}",
            "select": "spec,spec_hash,feature_count,label,label_horizon_bars",
        })
        run["folds"] = folds.json() if folds.status_code < 400 else []
        feature_rows = features.json() if features.status_code < 400 else []
        run["features"] = feature_rows[0] if feature_rows else None
        return run

    async def persist(
        self,
        *,
        model: str,
        symbol: str,
        interval: str,
        data_hash: str,
        params: dict[str, Any],
        seed: int,
        features: FeatureSet,
        result: MLRunResult,
        label: str,
        label_horizon_bars: int,
        bar_times: list[datetime] | None = None,
    ) -> PersistResult:
        """Write one completed run. Never raises — a research result is not
        lost because a mirror is down."""
        if not self.enabled:
            return PersistResult(False, reason="supabase is not configured on this deployment")
        if self._client is None:
            await self.start()
        if self._client is None:
            return PersistResult(False, reason="supabase client is not started")

        run_id: str | None = None
        try:
            # 1. The run, as 'running'. Status is promoted only once the
            #    evidence beneath it is filed.
            created = await self._insert("ml_runs", [{
                "model": model,
                "symbol": symbol,
                "interval": interval,
                "data_hash": data_hash,
                "params": params,
                "seed": int(seed),
                "git_sha": _git_sha(),
                "engine": ENGINE,
                "status": "running",
            }])
            if not created:
                return PersistResult(False, reason="ml_runs insert was refused")
            run_id = str(created[0]["id"])

            # 2. The feature set. One per run by unique constraint — a run that
            #    changed features mid-way is two runs.
            await self._insert("ml_features", [{
                "run_id": run_id,
                "spec": features.spec,
                "spec_hash": features.spec_hash,
                "feature_count": int(features.n_features),
                "label": label,
                "label_horizon_bars": int(label_horizon_bars),
            }])

            # 3. The folds, with their purge and embargo. The schema refuses a
            #    fold that trains on the future, so a leak fails here rather
            #    than being discovered in a review months later.
            if result.folds:
                await self._insert("ml_folds", [{
                    "run_id": run_id,
                    "fold_index": fr.fold.index,
                    "train_start": _stamp(_origin(features, fr.fold.train_start), bar_times),
                    "train_end": _stamp(_origin(features, fr.fold.train_end), bar_times),
                    "test_start": _stamp(_origin(features, fr.fold.test_start), bar_times),
                    "test_end": _stamp(_origin(features, fr.fold.test_end), bar_times),
                    "train_rows": fr.fold.train_rows,
                    "test_rows": fr.fold.test_rows,
                    "purge_bars": fr.fold.purged_bars,
                    "embargo_bars": fr.fold.embargoed_bars,
                    "oos_return": fr.oos_return,
                    "oos_sharpe": fr.oos_sharpe,
                    "oos_max_drawdown": fr.oos_max_drawdown,
                    "trades": fr.trades,
                } for fr in result.folds])

            # 4. The coefficients, inline. Small enough to belong in the row
            #    that describes them; the schema's check keeps exactly one home.
            if result.final_model is not None:
                payload = {
                    "coefficients": [float(c) for c in result.final_model.coefficients],
                    "intercept": float(result.final_model.intercept),
                    "center": [float(c) for c in result.final_model.center],
                    "scale": [float(s) for s in result.final_model.scale],
                    "feature_names": list(features.names),
                }
                await self._insert("ml_artefacts", [{
                    "run_id": run_id,
                    "kind": "coefficients",
                    "payload": payload,
                    "sha256": hashlib.sha256(
                        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
                    ).hexdigest(),
                }])

            # 5. Promote. Everything the verdict rests on is now filed.
            await self._client.patch(f"/rest/v1/ml_runs?id=eq.{run_id}", json={
                "status": "succeeded",
                "finished_at": datetime.now(UTC).isoformat(),
                "oos_sharpe": result.oos_sharpe,
                "deflated_sharpe": result.deflated_sharpe,
            })
            return PersistResult(True, run_id=run_id)

        except Exception as exc:  # noqa: BLE001 — a mirror must not lose a result
            log.warning("ml store: persist failed (%s)", type(exc).__name__)
            if run_id:
                await self._fail(run_id, f"{type(exc).__name__}: {exc}")
            return PersistResult(False, run_id=run_id, reason=f"{type(exc).__name__}: {exc}")


def _origin(features: FeatureSet, row: int) -> int:
    """A fold's row index, translated back to the original bar it came from.

    Folds index the BUILT matrix, whose warm-up rows were dropped. Writing those
    indices as if they were bar numbers would put every fold earlier than it
    really was — by exactly the longest feature lookback, silently.
    """
    if features.row_index.size == 0:
        return row
    clamped = min(max(0, row), features.row_index.size - 1)
    return int(features.row_index[clamped])


def _stamp(bar_index: int, bar_times: list[datetime] | None) -> str:
    """A fold boundary as a timestamp.

    Folds carry BAR INDICES; ml_folds wants timestamptz, because a fold's window
    is a claim about WHEN and an index is only a claim about where in an array.

    When the caller supplies the bar times — which it can, FeatureSet.row_index
    maps every kept row back to its original bar — the real date is written and
    the table means what it says.

    Without them the index is mapped onto the epoch. That is deliberately
    conspicuous rather than plausible: 1970-01-01T00:00:07Z is obviously not a
    trading date to anyone who reads it, it preserves the ordering the schema's
    constraints check, and it cannot be mistaken for evidence. A plausible-
    looking fabricated date could.
    """
    if bar_times:
        index = min(max(0, bar_index), len(bar_times) - 1)
        stamp = bar_times[index]
        return (stamp if stamp.tzinfo else stamp.replace(tzinfo=UTC)).isoformat()
    return datetime.fromtimestamp(float(bar_index), tz=UTC).isoformat()


_store: MLRunStore | None = None


def get_ml_store() -> MLRunStore:
    """The process-wide store.

    Lives here rather than in `main.py`, where it started, because the fit job
    runs on a worker thread and cannot import the app module without a cycle —
    and because every other singleton in this codebase (`get_audit`,
    `get_queue`, `get_engine`, `get_bot`) is accessed from the module that
    defines the thing.
    """
    global _store
    if _store is None:
        _store = MLRunStore()
    return _store
