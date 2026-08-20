"""The shared canvas every bot chart is drawn on.

Split out of ``modules/telegram_charts.py``. Holds the Agg backend selection,
the one categorical hue order, the dark axes styling and the buffer flush — so
the four generator modules differ only in what they plot, never in how the
picture looks.

Nothing here is named ``generate_*_png`` and nothing here invents a number.
"""

from __future__ import annotations

import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

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
