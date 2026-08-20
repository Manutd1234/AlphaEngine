"""``format_for_telegram`` — the portfolio summary sized for a phone screen.

Split out of ``modules/portfolio.py``. The ``modules.telegram`` import inside
the function STAYS function-scope: ``modules/telegram/*`` imports this package
back, and hoisting it recreates the cycle at module scope. Verify with
``venv/bin/python -c "import main"``.
"""

from __future__ import annotations

from typing import Any


def format_for_telegram(p: dict[str, Any]) -> str:
    """Portfolio summary sized for a phone screen."""
    from modules.telegram import esc

    eq = p["equity"]
    ex = p["exposure"]
    conc = p["concentration"]
    rb = p["risk_budget"]
    constraint, utilisation = rb["binding_constraint"]

    lines = [
        f"<b>{'🛑 HALTED — ' if p['trading_halted'] else ''}📁 Portfolio</b>",
        f"<i>{p['session_date']}</i>",
        "",
        f"Equity        <code>${eq['current']:,.0f}</code>",
        f"Day P&amp;L      <code>{eq['daily_pnl']:+,.0f}</code> ({eq['daily_return']:+.2%})",
        f"  realised    <code>{eq['realized_pnl']:+,.0f}</code>",
        f"  unrealised  <code>{eq['unrealized_pnl']:+,.0f}</code>",
        "",
        f"Gross expo    <code>${ex['gross']:,.0f}</code>  (net <code>{ex['net']:+,.0f}</code>)",
        f"Leverage      <code>{ex['leverage']:.2f}x</code>",
    ]

    if ex["positions"]:
        lines += ["", "<b>Positions</b>"]
        for pos in ex["positions"][:6]:
            lines.append(
                f"  {esc(pos['symbol'])} {pos['side']}  <code>${pos['notional']:,.0f}</code> "
                f"({pos['share_of_gross']:.0%})  P&amp;L <code>{pos['total_pnl']:+,.0f}</code>"
            )
        lines.append(
            f"\n  Concentration: largest <code>{conc['largest_share']:.0%}</code>, "
            f"effective positions <code>{conc['effective_positions']:.1f}</code>"
        )
    else:
        lines += ["", "<i>Book is flat.</i>"]

    dd = rb["daily_drawdown"]
    bar_len = int(min(1.0, utilisation) * 12)
    lines += [
        "",
        "<b>Risk budget</b>",
        f"  Drawdown   <code>{dd['used_pct']:.2%}</code> of <code>{dd['limit_pct']:.2%}</code> "
        f"(cushion <code>${dd['cushion_usd']:,.0f}</code>)",
        f"  Gross      <code>{rb['gross_exposure']['utilisation']:.0%}</code> used, "
        f"<code>${rb['gross_exposure']['remaining']:,.0f}</code> left",
        "",
        f"  Binding limit: <b>{esc(constraint)}</b> at <code>{utilisation:.0%}</code>",
        f"  <code>{'█' * bar_len}{'░' * (12 - bar_len)}</code>",
    ]

    strat = [s for s in p["attribution"]["by_strategy"] if s.get("filled")]
    if strat:
        lines += ["", "<b>Flow by strategy</b>"]
        for s in strat[:4]:
            lines.append(
                f"  {esc(s['strategy'])}: <code>{s['filled']}</code> fills, "
                f"<code>${(s['notional'] or 0):,.0f}</code>, "
                f"slip <code>{(s['avg_slippage_bps'] or 0):+.1f}bps</code>"
            )
    return "\n".join(lines)
