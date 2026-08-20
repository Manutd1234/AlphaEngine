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

The module became a package. Nothing moved between generators — the shared
canvas (Agg backend, hue order, axes styling, buffer flush) is in
``_canvas.py`` and the generators are grouped by what they plot:
``market.py``, ``performance.py``, ``diagnostics.py``. Every name the old
module exported is re-exported below.

One thing a reader porting a patch needs to know: the AST scan in
``tests/test_telegram.py`` no longer reads ``__file__``. For a package that is
only ``__init__.py``, which defines no generator at all — the scan would have
walked an empty document and passed. It now rglobs this package's directory,
so a generator that grows a ``sin`` in any file here is still caught.
"""

from __future__ import annotations

from modules.telegram_charts.diagnostics import generate_cone_png as generate_cone_png  # noqa: F401
from modules.telegram_charts.diagnostics import generate_multi_series_png as generate_multi_series_png  # noqa: F401
from modules.telegram_charts.diagnostics import generate_pipeline_png as generate_pipeline_png  # noqa: F401
from modules.telegram_charts.diagnostics import generate_status_grid_png as generate_status_grid_png  # noqa: F401
from modules.telegram_charts.diagnostics import generate_var_breach_png as generate_var_breach_png  # noqa: F401
from modules.telegram_charts.market import generate_bars_chart_png as generate_bars_chart_png  # noqa: F401
from modules.telegram_charts.market import generate_depth_chart_png as generate_depth_chart_png  # noqa: F401
from modules.telegram_charts.market import generate_drawdown_chart_png as generate_drawdown_chart_png  # noqa: F401
from modules.telegram_charts.market import generate_heatmap_png as generate_heatmap_png  # noqa: F401
from modules.telegram_charts.market import generate_histogram_png as generate_histogram_png  # noqa: F401
from modules.telegram_charts.market import generate_series_chart_png as generate_series_chart_png  # noqa: F401
from modules.telegram_charts.performance import generate_equity_chart_png as generate_equity_chart_png  # noqa: F401
from modules.telegram_charts.performance import generate_gate_ladder_png as generate_gate_ladder_png  # noqa: F401
from modules.telegram_charts.performance import generate_latency_cdf_png as generate_latency_cdf_png  # noqa: F401
from modules.telegram_charts.performance import generate_paired_bars_png as generate_paired_bars_png  # noqa: F401
from modules.telegram_charts.performance import generate_scatter_png as generate_scatter_png  # noqa: F401

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
