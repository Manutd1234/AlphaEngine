"""The feature matrix, its canonical spec, and the label.

Every column here is computed from bars the desk already has, using windows
that only ever look BACKWARD. That is not a style preference: a feature that
peeks forward leaks exactly like an unpurged fold, and it leaks in a way no
split can protect against, because the leak is inside the column rather than
between the windows.

The spec is canonical and hashed. Two runs can then be compared for feature
identity with an equality test rather than by a human reading two JSON blobs
side by side, which is the comparison that actually gets skipped.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

import numpy as np

from modules.ml.splits import PurgedWalkForward

#: Every feature the builder knows how to compute, and the lookback it needs.
#: Adding one here is the only way to add one — a builder that accepted
#: arbitrary callables could not hash its own spec, and an unhashable spec is an
#: experiment that cannot be compared to another.
FEATURE_KINDS: dict[str, str] = {
    "return": "close-to-close log return over `window` bars",
    "volatility": "standard deviation of 1-bar log returns over `window` bars",
    "momentum": "close / close[-window] - 1",
    "range": "(high - low) / close, averaged over `window` bars",
    "volume_z": "volume standardised against its own trailing `window` mean and sd",
    "gap": "open / close[-1] - 1, averaged over `window` bars",
}


@dataclass(frozen=True, slots=True)
class FeatureSpec:
    """One column: what it is and how far back it reaches."""

    kind: str
    window: int

    def __post_init__(self) -> None:
        if self.kind not in FEATURE_KINDS:
            raise ValueError(f"unknown feature kind {self.kind!r}; add it to FEATURE_KINDS")
        if self.window < 1:
            raise ValueError("window must be at least 1 bar")

    @property
    def name(self) -> str:
        return f"{self.kind}_{self.window}"


@dataclass(frozen=True, slots=True)
class LabelSpec:
    """What the model is asked to predict.

    ``horizon`` is the number of bars the label looks forward, and it is the
    number the splitter purges by. They are the same quantity and are passed
    from here rather than configured twice.
    """

    horizon: int = 1
    #: "return" is the forward log return; "direction" is its sign as 0/1.
    kind: str = "direction"

    def __post_init__(self) -> None:
        if self.horizon < 1:
            raise ValueError("label horizon must be at least 1 bar")
        if self.kind not in {"return", "direction"}:
            raise ValueError("label kind must be 'return' or 'direction'")

    @property
    def name(self) -> str:
        return f"{self.kind}_{self.horizon}"


@dataclass(frozen=True, slots=True)
class FeatureSet:
    """A built matrix and everything needed to rebuild or describe it."""

    x: np.ndarray
    y: np.ndarray
    #: Index into the ORIGINAL bar series for each row kept, so a fold's
    #: indices can be traced back to dates without re-deriving the offset.
    row_index: np.ndarray
    names: tuple[str, ...]
    spec_hash: str
    spec: dict = field(default_factory=dict)

    @property
    def n_features(self) -> int:
        return self.x.shape[1]


def _log_returns(close: np.ndarray) -> np.ndarray:
    out = np.zeros_like(close)
    out[1:] = np.log(close[1:] / close[:-1])
    return out


def _trailing_mean(values: np.ndarray, window: int) -> np.ndarray:
    """Mean of the previous `window` values, EXCLUDING the current bar.

    Excluding the current bar is the whole point. A trailing window that
    includes bar t uses information from bar t to describe bar t, which is
    fine for a chart and a leak for a model.
    """
    out = np.full(values.shape, np.nan)
    cumulative = np.concatenate([[0.0], np.cumsum(values)])
    for i in range(window, values.shape[0]):
        out[i] = (cumulative[i] - cumulative[i - window]) / window
    return out


def _trailing_std(values: np.ndarray, window: int) -> np.ndarray:
    out = np.full(values.shape, np.nan)
    for i in range(window, values.shape[0]):
        out[i] = float(np.std(values[i - window:i]))
    return out


class FeatureBuilder:
    """Builds the matrix, the label, and the spec that identifies both."""

    def __init__(self, features: list[FeatureSpec], label: LabelSpec) -> None:
        if not features:
            raise ValueError("a model needs at least one feature")
        names = [f.name for f in features]
        if len(set(names)) != len(names):
            raise ValueError(f"duplicate feature columns: {sorted(names)}")
        self.features = list(features)
        self.label = label

    # -- the spec ---------------------------------------------------------- #
    def spec(self) -> dict:
        """Canonical, ordered, and the thing that gets hashed.

        Order is part of the identity: a linear model's coefficients are
        meaningless against a permuted feature vector, so two runs with the
        same columns in a different order are not the same experiment.
        """
        return {
            "features": [{"kind": f.kind, "window": f.window} for f in self.features],
            "label": {"kind": self.label.kind, "horizon": self.label.horizon},
        }

    def spec_hash(self) -> str:
        payload = json.dumps(self.spec(), sort_keys=False, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    #: The splitter that matches this label. Built here so the purge and the
    #: label horizon cannot be configured to different numbers.
    def splitter(self, n_splits: int = 5, embargo: int = 0) -> PurgedWalkForward:
        return PurgedWalkForward(
            n_splits=n_splits, label_horizon=self.label.horizon, embargo=embargo,
        )

    # -- the matrix -------------------------------------------------------- #
    def build(
        self,
        *,
        open_: np.ndarray,
        high: np.ndarray,
        low: np.ndarray,
        close: np.ndarray,
        volume: np.ndarray,
    ) -> FeatureSet:
        close = np.asarray(close, dtype=np.float64)
        n = close.shape[0]
        for name, series in (("open", open_), ("high", high), ("low", low), ("volume", volume)):
            if np.asarray(series).shape[0] != n:
                raise ValueError(f"{name} has {np.asarray(series).shape[0]} bars, close has {n}")
        if n == 0:
            raise ValueError("cannot build features from an empty series")

        open_ = np.asarray(open_, dtype=np.float64)
        high = np.asarray(high, dtype=np.float64)
        low = np.asarray(low, dtype=np.float64)
        volume = np.asarray(volume, dtype=np.float64)
        bar_returns = _log_returns(close)

        columns: list[np.ndarray] = []
        for spec in self.features:
            w = spec.window
            if spec.kind == "return":
                col = np.full(n, np.nan)
                col[w:] = np.log(close[w:] / close[:-w])
            elif spec.kind == "volatility":
                col = _trailing_std(bar_returns, w)
            elif spec.kind == "momentum":
                col = np.full(n, np.nan)
                col[w:] = close[w:] / close[:-w] - 1.0
            elif spec.kind == "range":
                col = _trailing_mean((high - low) / close, w)
            elif spec.kind == "volume_z":
                mean = _trailing_mean(volume, w)
                sd = _trailing_std(volume, w)
                with np.errstate(invalid="ignore", divide="ignore"):
                    col = np.where(sd > 0, (volume - mean) / sd, 0.0)
                col[:w] = np.nan
            else:  # gap
                gap = np.full(n, np.nan)
                gap[1:] = open_[1:] / close[:-1] - 1.0
                col = _trailing_mean(np.nan_to_num(gap), w)
            columns.append(col)

        x = np.column_stack(columns)

        # The label looks FORWARD by exactly the horizon the splitter purges by.
        h = self.label.horizon
        forward = np.full(n, np.nan)
        forward[:-h] = np.log(close[h:] / close[:-h])
        y = forward if self.label.kind == "return" else (forward > 0).astype(np.float64)
        if self.label.kind == "direction":
            y[np.isnan(forward)] = np.nan

        # Rows are kept only where every feature and the label are finite. A
        # model fitted on nan-filled warm-up rows is fitted on zeros that mean
        # "no data", which it will happily treat as a signal.
        keep = np.isfinite(x).all(axis=1) & np.isfinite(y)
        row_index = np.flatnonzero(keep)
        return FeatureSet(
            x=x[keep],
            y=y[keep],
            row_index=row_index,
            names=tuple(f.name for f in self.features),
            spec_hash=self.spec_hash(),
            spec=self.spec(),
        )
