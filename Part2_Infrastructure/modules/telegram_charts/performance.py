"""Performance and gate generators: equity, paired bars, ladders, CDF, scatter.

Split out of ``modules/telegram_charts.py``. Same rule as every file here: a
generator plots what it was handed, or it returns None.
"""

from __future__ import annotations

import math

from modules.telegram_charts._canvas import _CATEGORICAL, _finish, _pair_text, _style_axes, plt


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
