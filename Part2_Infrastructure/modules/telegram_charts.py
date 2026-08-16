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
import math

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

__all__ = [
    "generate_bars_chart_png",
    "generate_cone_png",
    "generate_depth_chart_png",
    "generate_drawdown_chart_png",
    "generate_equity_chart_png",
    "generate_gate_ladder_png",
    "generate_heatmap_png",
    "generate_histogram_png",
    "generate_latency_cdf_png",
    "generate_multi_series_png",
    "generate_paired_bars_png",
    "generate_pipeline_png",
    "generate_scatter_png",
    "generate_series_chart_png",
    "generate_status_grid_png",
    "generate_var_breach_png",
]

# One fixed hue order for every categorical/multi-line generator, assigned by
# entity position and never cycled past its length — a 9th series folds into the
# palette's repeat only as a last resort. Drawn from the same dark palette
# `_style_axes` establishes so every bot chart reads as one system.
_CATEGORICAL = (
    "#38bdf8", "#f59e0b", "#00e676", "#ff5252",
    "#a78bfa", "#f472b6", "#22d3ee", "#facc15",
)


def _pair_text(value: float) -> str:
    """A compact number for a ladder's ``observed / limit`` annotation.

    Picks decimals by magnitude so a drawdown fraction (0.0200) and a dollar
    notional (150,000) both read correctly — a single ``{:,.0f}`` would print
    the fraction as ``0``.
    """
    magnitude = abs(value)
    if magnitude >= 1000:
        return f"{value:,.0f}"
    if magnitude >= 1:
        return f"{value:,.2f}"
    return f"{value:.4f}"


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


def generate_paired_bars_png(
    title: str,
    labels: list[str],
    first: list[float],
    second: list[float],
    first_label: str,
    second_label: str,
    ylabel: str,
    *,
    value_fmt: str = "{:.2f}",
) -> bytes | None:
    """Two measured bars per label — in-sample beside out-of-sample, say.

    Keeps only pairs where BOTH values are finite: a fold with one leg missing
    is dropped rather than drawn against a zero it was never measured at. None
    below one drawable pair, because a single pair is a comparison of nothing.
    """
    pairs = [
        (str(label), float(a), float(b))
        for label, a, b in zip(labels, first, second, strict=False)
        if a is not None and b is not None and a == a and b == b
    ]
    if len(pairs) < 1:
        return None

    names = [name for name, _, _ in pairs]
    firsts = [a for _, a, _ in pairs]
    seconds = [b for _, _, b in pairs]

    fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=120)
    _style_axes(fig, ax)
    positions = list(range(len(names)))
    width = 0.38
    ax.bar([p - width / 2 for p in positions], firsts, width=width, color=_CATEGORICAL[0], label=first_label)
    ax.bar([p + width / 2 for p in positions], seconds, width=width, color=_CATEGORICAL[1], label=second_label)
    for index, (value_a, value_b) in enumerate(zip(firsts, seconds, strict=True)):
        ax.text(index - width / 2, value_a, value_fmt.format(value_a), color="#f8fafc",
                fontsize=7, ha="center", va="bottom" if value_a >= 0 else "top")
        ax.text(index + width / 2, value_b, value_fmt.format(value_b), color="#f8fafc",
                fontsize=7, ha="center", va="bottom" if value_b >= 0 else "top")
    ax.axhline(0, color="#64748b", linewidth=1)
    ax.set_xticks(positions)
    ax.set_xticklabels(names, fontsize=8)
    ax.set_ylabel(ylabel, color="#94a3b8", fontsize=8)
    ax.set_title(title, color="#f8fafc", fontsize=10, fontweight="bold")
    ax.legend(facecolor="#1e293b", edgecolor="#334155", labelcolor="#f8fafc", fontsize=8)
    return _finish(fig)


def generate_gate_ladder_png(
    title: str,
    gates: list[tuple[str, float | None, float | None, bool]],
) -> bytes | None:
    """A pre-trade headroom ladder: observed / limit as a % utilisation bar.

    Only gates that carry BOTH a numeric observed value and a limit are drawn;
    the pass/fail booleans without numbers belong in the caption. Colour AND the
    printed ``obs / limit`` both say the same thing, so the bar is never the only
    carrier of state. None when nothing numeric is drawable.
    """
    drawable = [
        (str(name), float(observed), float(limit), bool(passed))
        for name, observed, limit, passed in gates
        if observed is not None and limit is not None
        and observed == observed and limit == limit and limit > 0
    ]
    if not drawable:
        return None

    names = [name for name, *_ in drawable]
    utilisations = [observed / limit * 100 for _, observed, limit, _ in drawable]
    colours = []
    for (_, _, _, passed), used in zip(drawable, utilisations, strict=True):
        if not passed or used >= 100:
            colours.append("#ff5252")
        elif used >= 70:
            colours.append("#f59e0b")
        else:
            colours.append("#00e676")

    fig, ax = plt.subplots(figsize=(6.6, max(2.4, 0.5 * len(drawable) + 1.0)), dpi=120)
    _style_axes(fig, ax)
    positions = list(range(len(names)))
    ax.barh(positions, utilisations, color=colours, height=0.55)
    ax.axvline(100, color="#94a3b8", linewidth=1, linestyle="--")
    ax.set_yticks(positions)
    ax.set_yticklabels(names, fontsize=8)
    ax.invert_yaxis()
    ax.set_xlabel("Utilisation (% of limit)", color="#94a3b8", fontsize=8)
    ax.set_xlim(0, max(110.0, max(utilisations) * 1.15))
    for index, (_, observed, limit, _) in enumerate(drawable):
        ax.text(utilisations[index], index, f"  {_pair_text(observed)} / {_pair_text(limit)}",
                color="#f8fafc", fontsize=7, va="center")
    ax.set_title(title, color="#f8fafc", fontsize=10, fontweight="bold")
    return _finish(fig)


def generate_latency_cdf_png(
    title: str,
    buckets: list[tuple[float, int]],
    markers: list[tuple[str, float]],
) -> bytes | None:
    """A cumulative latency distribution on a log-x axis, p-marks called out.

    ``buckets`` is (upper-edge-µs, count); the final edge is +inf and only adds
    to the running total, never to the x-axis. None below 20 observations — a
    CDF of a handful of samples is a staircase of noise.
    """
    total = sum(int(count) for _, count in buckets)
    if total < 20:
        return None

    xs: list[float] = []
    ys: list[float] = []
    cumulative = 0
    for upper, count in buckets:
        cumulative += int(count)
        if math.isfinite(upper) and upper > 0:
            xs.append(float(upper))
            ys.append(cumulative / total)
    if len(xs) < 2:
        return None

    fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=120)
    _style_axes(fig, ax)
    ax.plot(xs, ys, color=_CATEGORICAL[0], linewidth=2, drawstyle="steps-post")
    ax.set_xscale("log")
    ax.set_ylim(0, 1.02)
    for label, position in markers or []:
        if position is None or position != position or position <= 0:
            continue
        ax.axvline(float(position), color="#f59e0b", linewidth=1.5, linestyle="--")
        ax.annotate(
            label, xy=(float(position), 0), xycoords=("data", "axes fraction"),
            xytext=(3, 6), textcoords="offset points",
            color="#f59e0b", fontsize=8, fontweight="bold",
        )
    ax.set_title(title, color="#f8fafc", fontsize=10, fontweight="bold")
    ax.set_xlabel("Latency (µs, log scale)", color="#94a3b8", fontsize=8)
    ax.set_ylabel("Cumulative fraction", color="#94a3b8", fontsize=8)
    return _finish(fig)


def generate_scatter_png(
    title: str,
    xs: list[float],
    ys: list[float],
    xlabel: str,
    ylabel: str,
    *,
    groups: list[str] | None = None,
    fit_line: bool = False,
) -> bytes | None:
    """A scatter, optionally coloured by group and fitted with a trend line.

    None below five finite points — fewer, and the eye reads a pattern the data
    has not earned. The least-squares line is drawn only with ≥3 points and a
    non-degenerate x, computed here from the points themselves.
    """
    group_seq = groups if groups is not None else [None] * len(xs)
    points = [
        (float(x), float(y), group)
        for x, y, group in zip(xs, ys, group_seq, strict=False)
        if x is not None and y is not None and x == x and y == y
    ]
    if len(points) < 5:
        return None

    fig, ax = plt.subplots(figsize=(6.4, 3.4), dpi=120)
    _style_axes(fig, ax)
    by_group: dict[object, list[tuple[float, float]]] = {}
    for x, y, group in points:
        by_group.setdefault(group, []).append((x, y))
    for index, (group, pts) in enumerate(by_group.items()):
        ax.scatter(
            [p[0] for p in pts], [p[1] for p in pts], s=26,
            color=_CATEGORICAL[index % len(_CATEGORICAL)],
            edgecolor="#0f172a", linewidth=0.5,
            label=str(group) if group is not None else None,
        )

    if fit_line and len(points) >= 3:
        xs_f = [p[0] for p in points]
        ys_f = [p[1] for p in points]
        count = len(xs_f)
        mean_x = sum(xs_f) / count
        mean_y = sum(ys_f) / count
        var_x = sum((x - mean_x) ** 2 for x in xs_f)
        if var_x > 0:
            slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs_f, ys_f, strict=True)) / var_x
            intercept = mean_y - slope * mean_x
            lo, hi = min(xs_f), max(xs_f)
            ax.plot([lo, hi], [slope * lo + intercept, slope * hi + intercept],
                    color="#94a3b8", linewidth=1.5, linestyle="--")

    if any(group is not None for group in by_group):
        ax.legend(facecolor="#1e293b", edgecolor="#334155", labelcolor="#f8fafc", fontsize=7)
    ax.set_title(title, color="#f8fafc", fontsize=10, fontweight="bold")
    ax.set_xlabel(xlabel, color="#94a3b8", fontsize=8)
    ax.set_ylabel(ylabel, color="#94a3b8", fontsize=8)
    return _finish(fig)


def generate_multi_series_png(
    title: str,
    series: dict[str, list[float]],
    ylabel: str,
    *,
    normalise: bool = False,
    xlabel: str = "",
) -> bytes | None:
    """One line per key, in the fixed categorical order. None if no key has ≥2 points.

    ``normalise`` rebases each series to 100 at its own first point, so lines of
    very different scale can share the one axis this skill allows.
    """
    cleaned: dict[str, list[float]] = {}
    for name, values in series.items():
        pts = [float(v) for v in values if v is not None and v == v]
        if len(pts) >= 2:
            cleaned[name] = pts
    if not cleaned:
        return None

    fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=120)
    _style_axes(fig, ax)
    for index, (name, pts) in enumerate(cleaned.items()):
        plotted = pts
        if normalise and pts[0]:
            plotted = [value / pts[0] * 100 for value in pts]
        ax.plot(range(len(plotted)), plotted, color=_CATEGORICAL[index % len(_CATEGORICAL)],
                linewidth=2, label=str(name))
    ax.legend(facecolor="#1e293b", edgecolor="#334155", labelcolor="#f8fafc", fontsize=7)
    ax.set_title(title, color="#f8fafc", fontsize=10, fontweight="bold")
    ax.set_ylabel("Indexed to 100" if normalise else ylabel, color="#94a3b8", fontsize=8)
    if xlabel:
        ax.set_xlabel(xlabel, color="#94a3b8", fontsize=8)
    return _finish(fig)


def generate_var_breach_png(
    title: str,
    pnl: list[float],
    var: list[float],
    breaches: list[bool],
) -> bytes | None:
    """Rolling book P&L against the -VaR line it was scored on, breaches marked.

    None below 20 bars or when the three series disagree in length — the breach
    markers must line up with the P&L they flag, or the picture lies about which
    bar broke the forecast.
    """
    if len(pnl) < 20 or len(pnl) != len(var) or len(pnl) != len(breaches):
        return None

    fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=120)
    _style_axes(fig, ax)
    x = list(range(len(pnl)))
    ax.plot(x, pnl, color=_CATEGORICAL[0], linewidth=1.5, label="Book P&L")
    ax.plot(x, [-abs(v) for v in var], color="#f59e0b", linewidth=1.5, linestyle="--", label="-VaR 95")
    breach_x = [index for index, flag in enumerate(breaches) if flag]
    if breach_x:
        ax.scatter(breach_x, [pnl[index] for index in breach_x], color="#ff5252",
                   s=30, zorder=5, label="Breach")
    ax.axhline(0, color="#64748b", linewidth=1)
    ax.legend(facecolor="#1e293b", edgecolor="#334155", labelcolor="#f8fafc", fontsize=7)
    ax.set_title(title, color="#f8fafc", fontsize=10, fontweight="bold")
    ax.set_ylabel("P&L (USD)", color="#94a3b8", fontsize=8)
    ax.set_xlabel("Rolling bar", color="#94a3b8", fontsize=8)
    return _finish(fig)


def generate_pipeline_png(
    title: str,
    stages: list[tuple[str, str, str]],
) -> bytes | None:
    """A left-to-right signal path, each stage a status box with a mark and detail.

    Status is one of ok / degraded / down / unknown, each carrying its own glyph
    (● ▲ ✕ ○) as well as its colour so the state survives a greyscale print.
    None below two stages — a pipeline of one is not a pipeline.
    """
    if len(stages) < 2:
        return None

    from matplotlib.patches import FancyBboxPatch

    style = {
        "ok": ("#00e676", "●"),
        "degraded": ("#f59e0b", "▲"),
        "down": ("#ff5252", "✕"),
        "unknown": ("#94a3b8", "○"),
    }
    count = len(stages)
    fig, ax = plt.subplots(figsize=(min(12.0, 2.1 * count), 2.8), dpi=120)
    fig.patch.set_facecolor("#0f172a")
    ax.set_xlim(0, count)
    ax.set_ylim(0, 1)
    ax.axis("off")

    for index, (label, status, detail) in enumerate(stages):
        colour, mark = style.get(str(status), style["unknown"])
        box = FancyBboxPatch(
            (index + 0.08, 0.30), 0.84, 0.40,
            boxstyle="round,pad=0.02", linewidth=1.6,
            edgecolor=colour, facecolor="#1e293b",
        )
        ax.add_patch(box)
        ax.text(index + 0.5, 0.58, f"{mark} {label}", ha="center", va="center",
                color=colour, fontsize=8.5, fontweight="bold")
        if detail:
            ax.text(index + 0.5, 0.42, str(detail)[:24], ha="center", va="center",
                    color="#94a3b8", fontsize=6.5)
        if index < count - 1:
            ax.annotate(
                "", xy=(index + 1.06, 0.5), xytext=(index + 0.94, 0.5),
                arrowprops={"arrowstyle": "->", "color": "#64748b", "linewidth": 1.5},
            )
    ax.set_title(title, color="#f8fafc", fontsize=10, fontweight="bold")
    return _finish(fig)


def generate_cone_png(
    title: str,
    p5: list[float],
    p25: list[float],
    p50: list[float],
    p75: list[float],
    p95: list[float],
    *,
    xlabel: str = "Horizon (bars)",
    ylabel: str = "Cumulative P&L (USD)",
) -> bytes | None:
    """A fan chart of a bootstrapped path: the median with two nested bands.

    One hue at two opacities — the wider 5–95% envelope under the 25–75% core —
    so the picture reads as one magnitude widening with the horizon rather than
    a rainbow of unrelated series. Returns None unless all five bands are the
    same length and that length is at least two: a cone needs a horizon to open
    over, and mismatched bands would draw a fill between percentiles measured at
    different steps.
    """
    bands = (p5, p25, p50, p75, p95)
    lengths = {len(band) for band in bands}
    if len(lengths) != 1:
        return None
    n = lengths.pop()
    if n < 2:
        return None
    for band in bands:
        for value in band:
            if value is None or value != value:
                return None

    xs = list(range(1, n + 1))
    fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=120)
    _style_axes(fig, ax)
    hue = _CATEGORICAL[0]
    ax.fill_between(xs, list(p5), list(p95), color=hue, alpha=0.12, label="5–95%")
    ax.fill_between(xs, list(p25), list(p75), color=hue, alpha=0.28, label="25–75%")
    ax.plot(xs, list(p50), color=hue, linewidth=2, label="Median")
    ax.axhline(0, color="#64748b", linewidth=1, linestyle="--")
    ax.legend(facecolor="#1e293b", edgecolor="#334155", labelcolor="#f8fafc", fontsize=7)
    ax.set_title(title, color="#f8fafc", fontsize=10, fontweight="bold")
    ax.set_xlabel(xlabel, color="#94a3b8", fontsize=8)
    ax.set_ylabel(ylabel, color="#94a3b8", fontsize=8)
    return _finish(fig)


def generate_status_grid_png(
    title: str,
    rows: list[tuple[str, str, str, str]],
) -> bytes | None:
    """A status board: one labelled row per plane, one tile per component.

    Each tile carries its state twice — a glyph (● ▲ ✕ ○) and a colour — so the
    board survives a greyscale print and a colour-blind reader, the same rule
    the pipeline chart holds. ``rows`` is ``(plane, component, status, detail)``;
    components are grouped under their plane in first-seen order. None when there
    is nothing to place.
    """
    if not rows:
        return None

    from matplotlib.patches import FancyBboxPatch

    style = {
        "ok": ("#00e676", "●"),
        "degraded": ("#f59e0b", "▲"),
        "down": ("#ff5252", "✕"),
        "unknown": ("#94a3b8", "○"),
    }
    planes: list[str] = []
    grouped: dict[str, list[tuple[str, str, str]]] = {}
    for plane, component, status, detail in rows:
        plane = str(plane)
        if plane not in grouped:
            grouped[plane] = []
            planes.append(plane)
        grouped[plane].append((str(component), str(status), str(detail)))

    cols = max(len(items) for items in grouped.values())
    n_planes = len(planes)
    label_w = 1.7
    fig, ax = plt.subplots(
        figsize=(min(14.0, label_w + 2.4 * cols), max(2.2, 1.05 * n_planes + 0.7)),
        dpi=120,
    )
    fig.patch.set_facecolor("#0f172a")
    ax.set_xlim(0, label_w + cols)
    ax.set_ylim(0, n_planes)
    ax.axis("off")

    for row_index, plane in enumerate(planes):
        centre = n_planes - row_index - 0.5
        ax.text(0.08, centre, str(plane)[:16], ha="left", va="center",
                color="#e2e8f0", fontsize=9, fontweight="bold")
        for col_index, (component, status, detail) in enumerate(grouped[plane]):
            colour, mark = style.get(status, style["unknown"])
            x0 = label_w + col_index
            box = FancyBboxPatch(
                (x0 + 0.05, centre - 0.38), 0.9, 0.76,
                boxstyle="round,pad=0.02", linewidth=1.6,
                edgecolor=colour, facecolor="#1e293b",
            )
            ax.add_patch(box)
            ax.text(x0 + 0.5, centre + 0.12, f"{mark} {component}"[:20], ha="center", va="center",
                    color=colour, fontsize=8, fontweight="bold")
            if detail:
                ax.text(x0 + 0.5, centre - 0.16, str(detail)[:22], ha="center", va="center",
                        color="#94a3b8", fontsize=6.5)
    ax.set_title(title, color="#f8fafc", fontsize=10, fontweight="bold")
    return _finish(fig)
