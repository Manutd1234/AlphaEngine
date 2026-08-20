"""Equity curve and heatmap as base64 PNGs."""

from __future__ import annotations

import base64
import io
import logging

import numpy as np
import pandas as pd

from modules.backtester.statistics import dsr_verdict
from modules.schemas import (
    BacktestRequest,
    ParamResult,
)

log = logging.getLogger("alphaengine.backtest")

# --------------------------------------------------------------------------- #
# Plots (thread-safe: object API, never pyplot)
# --------------------------------------------------------------------------- #
def _fig_to_b64(fig) -> str:
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    FigureCanvasAgg(fig)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=fig.get_facecolor())
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


_BG, _FG, _GRID = "#0e1117", "#e6edf3", "#2a3038"
_ACCENT, _MUTED, _WARN = "#2ea8ff", "#7d8590", "#ff6b6b"

# Diverging scale for the Sharpe surface: blue ↔ neutral gray ↔ red. Two hues
# that read as opposite, a midpoint that reads as "nothing". Steps are the
# dark-surface values from the shared palette, so the notebook charts, the Mini
# App and the Vercel portal all render the same scale.
_SHARPE_COLOURS = ["#e66767", "#a75450", "#383835", "#2b628f", "#3987e5"]


def _build_sharpe_cmap():
    try:
        from matplotlib.colors import LinearSegmentedColormap

        return LinearSegmentedColormap.from_list("alphaengine_diverging", _SHARPE_COLOURS)
    except Exception:  # pragma: no cover - matplotlib absent
        return "coolwarm"


_SHARPE_CMAP = _build_sharpe_cmap()


def plot_equity_curve(df: pd.DataFrame, equity: np.ndarray, best: ParamResult, req: BacktestRequest,
                      oos_sharpe: float | None, dsr: float) -> str | None:
    try:
        from matplotlib.figure import Figure
    except Exception as exc:
        log.warning("matplotlib unavailable: %s", exc)
        return None

    idx = df.index
    bh = (df["close"] / df["close"].iloc[0]).to_numpy()
    dd = equity / np.maximum.accumulate(equity) - 1.0

    fig = Figure(figsize=(11, 7), facecolor=_BG)
    gs = fig.add_gridspec(3, 1, height_ratios=[2.4, 1, 0.9], hspace=0.28)

    ax = fig.add_subplot(gs[0], facecolor=_BG)
    ax.plot(idx, equity, color=_ACCENT, lw=1.9, label=f"Strategy ({req.strategy} {best.fast}/{best.slow})")
    ax.plot(idx, bh, color=_MUTED, lw=1.2, ls="--", label="Buy & hold")
    ax.set_title(
        f"{req.symbol} · {req.interval} · {req.strategy}   |   "
        f"Sharpe {best.sharpe:.2f}  ·  Return {best.total_return:+.1%}  ·  MaxDD {best.max_drawdown:.1%}",
        color=_FG, fontsize=12, pad=12, loc="left",
    )
    ax.legend(facecolor=_BG, edgecolor=_GRID, labelcolor=_FG, fontsize=9, loc="upper left")
    ax.set_ylabel("Growth of $1", color=_FG, fontsize=9)

    ax2 = fig.add_subplot(gs[1], facecolor=_BG, sharex=ax)
    ax2.fill_between(idx, dd * 100, 0, color=_WARN, alpha=0.35)
    ax2.plot(idx, dd * 100, color=_WARN, lw=1.0)
    ax2.set_ylabel("Drawdown %", color=_FG, fontsize=9)

    ax3 = fig.add_subplot(gs[2], facecolor=_BG)
    ax3.axis("off")
    verdict_colour = "#3fb950" if dsr >= 0.95 else ("#d29922" if dsr >= 0.8 else _WARN)
    lines = [
        f"CAGR {best.cagr:+.2%}    Sortino {best.sortino:.2f}    Calmar {best.calmar:.2f}    "
        f"Win rate {best.win_rate:.1%}    Trades {best.trades}    Exposure {best.exposure:.0%}",
        f"Deflated Sharpe Ratio: {dsr:.3f}" + (f"    Walk-forward OOS Sharpe: {oos_sharpe:.2f}" if oos_sharpe is not None else ""),
        dsr_verdict(dsr),
    ]
    for i, line in enumerate(lines):
        ax3.text(0, 0.85 - i * 0.33, line, color=_FG if i < 2 else verdict_colour,
                 fontsize=9.5 if i < 2 else 10, family="monospace", transform=ax3.transAxes)

    for a in (ax, ax2):
        a.grid(True, color=_GRID, lw=0.6, alpha=0.7)
        a.tick_params(colors=_MUTED, labelsize=8)
        for spine in a.spines.values():
            spine.set_color(_GRID)
    return _fig_to_b64(fig)


def plot_heatmap(results: list[ParamResult], req: BacktestRequest) -> str | None:
    try:
        from matplotlib.figure import Figure
    except Exception:
        return None
    if len(results) < 4:
        return None

    frame = pd.DataFrame([r.model_dump() for r in results])
    pivot = frame.pivot_table(index="fast", columns="slow", values="sharpe")

    fig = Figure(figsize=(9, 5.6), facecolor=_BG)
    ax = fig.add_subplot(111, facecolor=_BG)
    vmax = float(np.nanmax(np.abs(pivot.to_numpy()))) or 1.0
    # Sharpe is signed around a meaningful zero => diverging scale: two hues that
    # read as opposite, with a NEUTRAL midpoint. (A red-yellow-green map puts a
    # hue at the midpoint, so "zero Sharpe" reads as a value rather than as
    # nothing — and yellow/green is the pair colour-blind readers lose first.)
    im = ax.imshow(pivot.to_numpy(), cmap=_SHARPE_CMAP, aspect="auto", origin="lower",
                   vmin=-vmax, vmax=vmax)
    ax.set_xticks(range(len(pivot.columns)), [str(c) for c in pivot.columns], color=_MUTED, fontsize=8, rotation=45)
    ax.set_yticks(range(len(pivot.index)), [str(i) for i in pivot.index], color=_MUTED, fontsize=8)
    ax.set_xlabel("slow period", color=_FG, fontsize=9)
    ax.set_ylabel("fast period", color=_FG, fontsize=9)
    ax.set_title(
        f"Annualised Sharpe surface — {req.symbol} {req.interval} · {len(results)} combinations\n"
        "A smooth plateau is a robust parameter region; an isolated peak is an overfit.",
        color=_FG, fontsize=10.5, loc="left", pad=12,
    )
    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label("Annualised Sharpe  (grey = 0)", color=_MUTED, fontsize=8.5)
    cbar.ax.tick_params(colors=_MUTED, labelsize=8)
    cbar.outline.set_edgecolor(_GRID)
    for spine in ax.spines.values():
        spine.set_color(_GRID)
    return _fig_to_b64(fig)
