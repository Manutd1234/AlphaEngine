"""The absorption ledger: one row per (event, asset, stage), with its evidence.

A half-life on its own is not a measurement. The row carries the bars it was
computed over (`data_hash`), the parameters in force (`params_version`), the
clock it was read on, the control percentile beside it, and the full horizon
path as JSON — so a number can be argued with a year later rather than taken
on trust. That is the `ml_runs` shape and the reason for it is the same.

`signal_state` is on every row including the refusals. A stage whose move never
cleared the noise floor is kept, not dropped: the attrition is a property of
the sample and a reader who cannot see it cannot judge the rest.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from modules.data_ops_backend import DataOpsStore, get_data_ops_store


@dataclass(frozen=True)
class AbsorptionRun:
    """One measured stage, or one refusal, with everything behind it."""

    run_id: str
    source_ref: str
    symbol: str
    stage: str
    interval: str
    signal_state: str
    signal_reason: str | None = None
    terminal_return: float | None = None
    sigma_pre_per_bar: float | None = None
    pre_bars: int = 0
    half_life_s: float | None = None
    half_life_state: str | None = None
    half_life_vol: float | None = None
    control_percentile: float | None = None
    controls_used: int = 0
    measured_horizons: int = 0
    of_horizons: int = 0
    market_adjusted: bool = False
    data_hash: str | None = None
    params_version: str = ""
    t0_ms: float = 0.0
    points: list[dict[str, Any]] = field(default_factory=list)

    def as_row(self, *, desk_id: str, computed_at: float) -> dict[str, Any]:
        return {
            "run_id": self.run_id, "desk_id": desk_id, "source_ref": self.source_ref,
            "symbol": self.symbol, "stage": self.stage, "interval": self.interval,
            "signal_state": self.signal_state, "signal_reason": self.signal_reason,
            "terminal_return": self.terminal_return, "sigma_pre_per_bar": self.sigma_pre_per_bar,
            "pre_bars": self.pre_bars, "half_life_s": self.half_life_s,
            "half_life_state": self.half_life_state, "half_life_vol": self.half_life_vol,
            "control_percentile": self.control_percentile, "controls_used": self.controls_used,
            "measured_horizons": self.measured_horizons, "of_horizons": self.of_horizons,
            "market_adjusted": 1 if self.market_adjusted else 0, "data_hash": self.data_hash,
            "params_version": self.params_version, "t0_ms": self.t0_ms,
            "points_json": json.dumps(self.points), "computed_at": computed_at,
        }


class AbsorptionRunStore:
    """Rows keyed by (event, asset, stage), replaced rather than duplicated."""

    _DDL = [
        """
        CREATE TABLE IF NOT EXISTS diffusion_runs (
            run_id TEXT PRIMARY KEY,
            desk_id TEXT NOT NULL,
            source_ref TEXT NOT NULL,
            symbol TEXT NOT NULL,
            stage TEXT NOT NULL,
            interval TEXT NOT NULL,
            signal_state TEXT NOT NULL,
            signal_reason TEXT,
            terminal_return REAL,
            sigma_pre_per_bar REAL,
            pre_bars INTEGER NOT NULL DEFAULT 0,
            half_life_s REAL,
            half_life_state TEXT,
            half_life_vol REAL,
            control_percentile REAL,
            controls_used INTEGER NOT NULL DEFAULT 0,
            measured_horizons INTEGER NOT NULL DEFAULT 0,
            of_horizons INTEGER NOT NULL DEFAULT 0,
            market_adjusted INTEGER NOT NULL DEFAULT 0,
            data_hash TEXT,
            params_version TEXT NOT NULL,
            t0_ms REAL NOT NULL,
            points_json TEXT NOT NULL,
            computed_at REAL NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS diffusion_runs_by_event ON diffusion_runs (desk_id, source_ref)",
        "CREATE INDEX IF NOT EXISTS diffusion_runs_by_time ON diffusion_runs (desk_id, t0_ms)",
    ]

    def __init__(self, store: DataOpsStore | None = None, *, desk_id: str = "default") -> None:
        self._store = store if store is not None else get_data_ops_store()
        self._desk_id = desk_id
        self._store.migrate(self._DDL)

    @property
    def backend(self) -> str:
        return self._store.backend

    def record(self, run: AbsorptionRun, *, computed_at: float) -> None:
        row = run.as_row(desk_id=self._desk_id, computed_at=computed_at)
        if self._store.fetch_one("diffusion_runs", filters={"run_id": run.run_id}) is None:
            self._store.add("diffusion_runs", row)
            return
        self._store.patch("diffusion_runs", filters={"run_id": run.run_id}, patch=row)

    def list_runs(self, *, limit: int = 400, source_ref: str | None = None,
                  stage: str | None = None) -> tuple[list[dict[str, Any]], bool]:
        filters: dict[str, Any] = {"desk_id": self._desk_id}
        if source_ref is not None:
            filters["source_ref"] = source_ref
        if stage is not None:
            filters["stage"] = stage
        fetched = self._store.fetch("diffusion_runs", filters=filters, order="t0_ms.asc",
                                    limit=max(1, int(limit)) + 1)
        return fetched[:limit], len(fetched) > limit

    def count(self) -> int:
        return self._store.count("diffusion_runs", filters={"desk_id": self._desk_id})

    def close(self) -> None:
        self._store.close()
