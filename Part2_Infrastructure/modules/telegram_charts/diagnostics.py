"""Diagnostic generators: multi-series, VaR breaches, pipelines, cones, grids.

Split out of ``modules/telegram_charts.py``. Same rule as every file here: a
generator plots what it was handed, or it returns None.
"""

from __future__ import annotations

from modules.telegram_charts._canvas import _CATEGORICAL, _finish, _style_axes, plt


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
