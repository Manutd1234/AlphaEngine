"""
Portfolio view — the desk seen from above.
==========================================

Who this is for
---------------
The gateway already answers the **trader's** question ("can I send this order,
and what will it cost?") and the **researcher's** question ("does this strategy
work?"). This module answers the **portfolio manager's** question, which is a
different one:

    Where am I exposed, how much of my risk budget is spent, what is making
    or losing money, and how close am I to a limit?

A trader looks at one order; a PM looks at the book. The same numbers do not
serve both — a list of positions is not a portfolio view. What a PM needs is
*concentration* (how much of the book is one bet), *headroom* (how much of each
limit is left before trading stops), and *attribution* (which symbol and which
strategy produced the P&L).

Where the numbers come from
---------------------------
Live state — positions, marks, drawdown — comes from the risk gateway, which is
the process that would actually block an order. Realised history — fills, fees,
slippage, per-strategy P&L — comes from the DuckDB audit log, which is
append-only. So the exposure figures are current and the attribution figures are
reconstructible: a PM can ask "why does this say that?" and the answer is a SQL
query, not a cache.

The module became a package. Nothing moved between concerns: ``view.py`` builds
the instantaneous picture, ``attribution.py`` answers "which sleeve, which
session", ``equity.py`` derives the curve and its period returns, and
``telegram_view.py`` renders the phone-sized summary. ``_common.py`` holds the
three shared arithmetic helpers so four files cannot grow four rounding
conventions.

One thing a reader porting a patch needs to know: the ``from modules.telegram
import esc`` inside ``format_for_telegram`` is function-scope because
``modules/telegram/*`` imports this package back. Hoisting it recreates
``telegram -> portfolio -> telegram`` at module scope and the gateway fails to
boot. No lint catches it; the check is ``venv/bin/python -c "import main"``.
"""

from __future__ import annotations

from modules.portfolio._common import _headroom as _headroom  # noqa: F401
from modules.portfolio._common import _pct as _pct  # noqa: F401
from modules.portfolio._common import _utcnow as _utcnow  # noqa: F401
from modules.portfolio._common import log as log  # noqa: F401
from modules.portfolio.attribution import realized_pnl_by_strategy as realized_pnl_by_strategy  # noqa: F401
from modules.portfolio.attribution import session_attribution as session_attribution  # noqa: F401
from modules.portfolio.equity import _period as _period  # noqa: F401
from modules.portfolio.equity import build_equity_history as build_equity_history  # noqa: F401
from modules.portfolio.telegram_view import format_for_telegram as format_for_telegram  # noqa: F401
from modules.portfolio.view import build_portfolio as build_portfolio  # noqa: F401

__all__ = [
    "build_equity_history",
    "build_portfolio",
    "format_for_telegram",
    "realized_pnl_by_strategy",
    "session_attribution",
]
