"""Every picture the Telegram companion sends.

Extracted from `telegram.py` so the rule that governs them is enforceable in
one place: **a generator plots what it was handed, or it returns None.** The
module once carried a `generate_chart_png` that drew a sine wave under the
caption "Real-Time Market Quote" — a decorative curve a reader could not tell
apart from a measurement. `tests/test_telegram.py` now AST-scans both modules
for `random`/`sin`/`cos` inside any `generate_*_png`.

Returning None is the honest failure: the caption then says what is missing,
which is more useful than a chart of nothing. Matplotlib only — the Agg
backend, no display, and no dependency the gateway does not already ship.
"""

from __future__ import annotations

import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

__all__ = [
    "generate_bars_chart_png",
    "generate_depth_chart_png",
    "generate_drawdown_chart_png",
    "generate_equity_chart_png",
    "generate_heatmap_png",
    "generate_histogram_png",
    "generate_series_chart_png",
]


def _style_axes(fig, ax) -> None:
    """The shared dark canvas every bot chart is drawn on."""
    fig.patch.set_facecolor('#0f172a')
    ax.set_facecolor('#1e293b')
    ax.tick_params(colors='#94a3b8', labelsize=8)
    for spine in ax.spines.values():
        spine.set_color('#334155')


def _finish(fig) -> bytes:
    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format='png', facecolor=fig.get_facecolor(), edgecolor='none')
    plt.close(fig)
    return buf.getvalue()


def generate_series_chart_png(symbol: str, closes: list[float], interval: str, source: str) -> bytes:
    """
    One symbol's close series, drawn from the bars the caller actually fetched.

    This replaced a generator that titled itself "Real-Time Market Quote" and
    plotted `64200 + sin(i * 0.3) * 450` — a decorative curve under a factual
    caption, which on a desk tool is worse than no chart because a reader
    cannot tell it apart from a real one. That generator has since been
    deleted. Everything below is plotted from `closes` or not plotted at all.
    """
    fig, ax = plt.subplots(figsize=(6, 3.2), dpi=120)
    _style_axes(fig, ax)

    xs = list(range(len(closes)))
    first, last = closes[0], closes[-1]
    rising = last >= first
    colour = '#00e676' if rising else '#ff5252'
    ax.plot(xs, closes, color=colour, linewidth=2)
    ax.fill_between(xs, closes, min(closes), color=colour, alpha=0.15)
    ax.axhline(first, color='#64748b', linewidth=1, linestyle='--', alpha=0.7)

    move = ((last / first) - 1) * 100 if first else 0.0
    ax.set_title(
        f"{symbol} · {interval} · {move:+.2f}% over {len(closes)} bars",
        color='#f8fafc', fontsize=10, fontweight='bold',
    )
    ax.set_ylabel("Close", color='#94a3b8', fontsize=8)
    ax.set_xlabel(f"{source} · dashed line is the first close", color='#94a3b8', fontsize=8)
    return _finish(fig)


def generate_bars_chart_png(
    title: str,
    labels: list[str],
    values: list[float],
    ylabel: str,
    colours: list[str] | None = None,
    horizontal: bool = False,
    value_fmt: str = "{:.0f}",
) -> bytes | None:
    """A bar chart of whatever the caller measured. None when nothing was."""
    pairs = [(label, value) for label, value in zip(labels, values, strict=False) if value is not None]
    if not pairs:
        return None
    labels = [label for label, _ in pairs]
    values = [float(value) for _, value in pairs]

    fig, ax = plt.subplots(figsize=(6, 3.2), dpi=120)
    _style_axes(fig, ax)
    palette = colours or ['#38bdf8'] * len(values)
    if horizontal:
        ax.barh(labels, values, color=palette, height=0.5)
        ax.set_xlabel(ylabel, color='#94a3b8', fontsize=8)
        ax.invert_yaxis()
        for index, value in enumerate(values):
            ax.text(value, index, " " + value_fmt.format(value), color='#f8fafc', fontsize=8, va='center')
    else:
        ax.bar(labels, values, color=palette, width=0.5)
        ax.set_ylabel(ylabel, color='#94a3b8', fontsize=8)
        for index, value in enumerate(values):
            ax.text(index, value, value_fmt.format(value), color='#f8fafc', fontsize=8, ha='center', va='bottom')
    ax.set_title(title, color='#f8fafc', fontsize=10, fontweight='bold')
    return _finish(fig)


def generate_depth_chart_png(symbol: str, bids: list[tuple[float, float]], asks: list[tuple[float, float]]) -> bytes | None:
    """
    The real consolidated ladder as cumulative depth either side of the mid.

    The generator this replaced drew a fixed shape that never touched a venue.
    This one draws the rungs it was handed and returns None when there are
    none, because "no live book" is a fact the caption should carry rather than
    something a picture papers over.
    """
    if len(bids) < 2 or len(asks) < 2:
        return None

    fig, ax = plt.subplots(figsize=(6, 3.2), dpi=120)
    _style_axes(fig, ax)

    bid_prices, bid_cum = [], []
    running = 0.0
    for price, size in sorted(bids, key=lambda r: -r[0]):
        running += price * size
        bid_prices.append(price)
        bid_cum.append(running)

    ask_prices, ask_cum = [], []
    running = 0.0
    for price, size in sorted(asks, key=lambda r: r[0]):
        running += price * size
        ask_prices.append(price)
        ask_cum.append(running)

    ax.step(bid_prices, bid_cum, where='post', color='#00e676', linewidth=2, label='Bids')
    ax.fill_between(bid_prices, bid_cum, step='post', color='#00e676', alpha=0.15)
    ax.step(ask_prices, ask_cum, where='post', color='#ff5252', linewidth=2, label='Asks')
    ax.fill_between(ask_prices, ask_cum, step='post', color='#ff5252', alpha=0.15)

    mid = (bid_prices[0] + ask_prices[0]) / 2
    ax.axvline(mid, color='#64748b', linewidth=1, linestyle='--', alpha=0.8)
    ax.set_title(f"{symbol} consolidated depth · mid {mid:,.2f}", color='#f8fafc', fontsize=10, fontweight='bold')
    ax.set_ylabel("Cumulative notional (USD)", color='#94a3b8', fontsize=8)
    ax.set_xlabel("Price", color='#94a3b8', fontsize=8)
    ax.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='#f8fafc', fontsize=8)
    return _finish(fig)


def generate_drawdown_chart_png(symbol: str, closes: list[float]) -> bytes | None:
    """Peak-to-trough drawdown of the same closes the price chart drew."""
    if len(closes) < 2:
        return None
    peak = closes[0]
    drawdown = []
    for close in closes:
        peak = max(peak, close)
        drawdown.append((close / peak - 1) * 100 if peak else 0.0)

    fig, ax = plt.subplots(figsize=(6, 2.6), dpi=120)
    _style_axes(fig, ax)
    xs = list(range(len(drawdown)))
    ax.plot(xs, drawdown, color='#ff5252', linewidth=1.6)
    ax.fill_between(xs, drawdown, 0, color='#ff5252', alpha=0.18)
    ax.axhline(0, color='#64748b', linewidth=1)
    ax.set_title(f"{symbol} drawdown from running peak · worst {min(drawdown):.2f}%", color='#f8fafc', fontsize=10, fontweight='bold')
    ax.set_ylabel("Drawdown (%)", color='#94a3b8', fontsize=8)
    return _finish(fig)


def generate_histogram_png(
    title: str,
    values: list[float],
    xlabel: str,
    markers: list[tuple[str, float, str]] | None = None,
) -> bytes | None:
    """A distribution, with the quantiles that matter marked on it.

    Returns None below 20 observations — the same floor `historical_var` uses
    before it will report an empirical quantile. A twelve-bar histogram
    captioned "loss distribution" would give shape to noise.
    """
    finite = [float(value) for value in values if value is not None and value == value]
    if len(finite) < 20:
        return None

    fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=120)
    _style_axes(fig, ax)
    ax.hist(finite, bins=min(30, max(10, len(finite) // 8)), color="#38bdf8", edgecolor="#0f172a")
    for label, position, colour in markers or []:
        if position is None or position != position:
            continue
        ax.axvline(position, color=colour, linewidth=2, linestyle="--")
        ax.annotate(
            label, xy=(position, 0), xycoords=("data", "axes fraction"),
            xytext=(4, 6), textcoords="offset points",
            color=colour, fontsize=8, fontweight="bold",
        )
    ax.set_title(title, color="#e2e8f0", fontsize=10, fontweight="bold")
    ax.set_xlabel(xlabel, color="#94a3b8", fontsize=8)
    ax.set_ylabel("Observations", color="#94a3b8", fontsize=8)
    return _finish(fig)


def generate_heatmap_png(title: str, labels: list[str], matrix: list[list[float]]) -> bytes | None:
    """A correlation grid. Diverging scale, because -1 and +1 are opposites.

    Returns None below 2x2: a one-asset "matrix" is a number, and drawing it
    as a grid implies a structure that is not there.
    """
    if len(labels) < 2 or len(matrix) < 2:
        return None

    fig, ax = plt.subplots(figsize=(5.6, 4.8), dpi=120)
    _style_axes(fig, ax)
    image = ax.imshow(matrix, cmap="RdBu_r", vmin=-1.0, vmax=1.0)
    ax.set_xticks(range(len(labels)))
    ax.set_yticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=7)
    ax.set_yticklabels(labels, fontsize=7)
    # The printed number is the answer; the colour is the glance. Colour alone
    # would make a 0.62 and a 0.71 indistinguishable.
    for row in range(len(labels)):
        for column in range(len(labels)):
            ax.text(
                column, row, f"{matrix[row][column]:.2f}",
                ha="center", va="center", fontsize=7,
                color="#0f172a" if abs(matrix[row][column]) > 0.5 else "#e2e8f0",
            )
    bar = fig.colorbar(image, ax=ax, shrink=0.8)
    bar.ax.tick_params(colors="#94a3b8", labelsize=7)
    ax.set_title(title, color="#e2e8f0", fontsize=10, fontweight="bold")
    return _finish(fig)


def generate_equity_chart_png(
    points: list[dict],
    start_of_day: float | None = None,
) -> bytes | None:
    """The persisted equity curve, with the session's opening level marked.

    Points come from the gateway's own snapshots, so gaps in the line are gaps
    in the record rather than something to interpolate over. Halted samples are
    marked: a flat stretch means something different when trading was stopped.
    """
    equities = [
        float(point.get("equity"))
        for point in points
        if point.get("equity") is not None
    ]
    if len(equities) < 2:
        return None

    fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=120)
    _style_axes(fig, ax)
    rising = equities[-1] >= equities[0]
    colour = "#22c55e" if rising else "#ef4444"
    ax.plot(range(len(equities)), equities, color=colour, linewidth=2)
    ax.fill_between(range(len(equities)), equities, min(equities), color=colour, alpha=0.15)

    if start_of_day:
        ax.axhline(start_of_day, color="#94a3b8", linewidth=1, linestyle="--")
        ax.annotate(
            "start of day", xy=(0, start_of_day), xytext=(4, 4),
            textcoords="offset points", color="#94a3b8", fontsize=7,
        )

    halted = [
        index for index, point in enumerate(points)
        if point.get("kill_switch") or point.get("trading_halted")
    ]
    if halted:
        ax.scatter(
            halted, [equities[min(index, len(equities) - 1)] for index in halted],
            color="#f97316", s=18, zorder=5, label="halted",
        )
        ax.legend(loc="lower left", fontsize=7, facecolor="#1e293b", edgecolor="#334155",
                  labelcolor="#e2e8f0")

    change = (equities[-1] / equities[0] - 1) * 100 if equities[0] else 0.0
    ax.set_title(
        f"Equity · {len(equities)} snapshots · {change:+.2f}%",
        color="#e2e8f0", fontsize=10, fontweight="bold",
    )
    ax.set_ylabel("Equity (USD)", color="#94a3b8", fontsize=8)
    return _finish(fig)
