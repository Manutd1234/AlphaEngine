"""The Coherence tab, in the companion.

Its own mixin rather than another method on ``tabs_ops``: that file is close to
its length ceiling, and this command reaches for a different subsystem than
anything in it.

What it sends is the one number the tab exists to produce — what a guaranteed
dollar costs in each watched family — plus whether the recorder is running,
because a coherence claim about a market nobody is reading is not a claim.
"""

from __future__ import annotations

from decimal import Decimal

from modules.coherence import tunables
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.fs.store import TapeUnavailable, get_store
from modules.coherence.recorder import recorder_state
from modules.coherence.syscalls.observe import observe_series
from modules.coherence.views import basket_totals
from modules.telegram.format import esc, text_card
from modules.telegram.keyboards import _tab_footer, cb

# Kept small on purpose: this is a phone, and a family's basket total is one
# line. Reading the whole watchlist would spend a poll's budget to fill a screen
# nobody scrolls.
MAX_FAMILIES = 4


class CoherenceTabMixin:
    """``/coherence`` — what a guaranteed dollar costs right now."""

    async def _cmd_tab_coherence(self, args, chat_id, actor) -> None:
        lines: list[str] = []

        if not tunables.watchlist_configured():
            lines.append("No series is being watched.")
            lines.append("Set <code>COHERENCE_SERIES</code> on the gateway to name the families to price.")
            await self.send_message(chat_id, text_card(
                "Coherence", "NOT CONFIGURED", lines,
                source="Kalshi public endpoints", next_commands="/status · /commands",
            ))
            return

        state = recorder_state().to_dict()
        lines.append(
            f"Recorder       <code>{'running' if state['running'] else 'idle'}</code> · "
            f"<code>{state['books_written']}</code> books over <code>{state['polls']}</code> polls"
        )
        try:
            tape = get_store().health()
            lines.append(
                f"Tape           <code>{esc(str(tape.get('state', '—')))}</code> · "
                f"<code>{tape.get('violation_episodes', 0)}</code> episodes closed"
            )
        except TapeUnavailable as exc:
            lines.append(f"Tape           <code>unavailable</code> · {esc(str(exc)[:60])}")

        lines.append("")
        lines.append("<b>What a guaranteed $1 costs</b>")

        client = KalshiClient()
        priced = 0
        for series_ticker in tunables.SERIES_WATCHLIST:
            if priced >= MAX_FAMILIES:
                break
            try:
                observations = await observe_series(client, series_ticker, max_events=MAX_FAMILIES - priced)
            except KalshiUnavailable as exc:
                lines.append(f"<code>{esc(series_ticker)}</code> — {esc(exc.reason[:60])}")
                continue
            for observation in observations:
                ask_total, bid_total, _ = basket_totals(observation)
                mark = "—"
                if ask_total is not None:
                    mark = "▲" if Decimal(ask_total) < Decimal(1) else "●"
                lines.append(
                    f"{mark} <code>{esc(observation.event.event_ticker[:26])}</code> "
                    f"buy <code>{esc(ask_total or '—')}</code> · sell <code>{esc(bid_total or '—')}</code>"
                )
                priced += 1

        if not priced:
            lines.append("No family could be priced on this poll.")

        lines.append("")
        lines.append(
            "<i>A mutually exclusive family pays exactly $1. Under a dollar to buy, or over a dollar "
            "to sell, is a Dutch book before fees — and the fees are the reason most are not.</i>"
        )
        lines.append("<i>Read only: this engine records and certifies, and sends no orders.</i>")

        await self.send_message(chat_id, text_card(
            "Coherence", f"{priced} FAMILIES", lines,
            source="Kalshi public endpoints, live",
            next_commands="/developer · /status · /commands",
        ), reply_markup=_tab_footer(
            "coherence",
            [
                ("Developer", cb("developer")),
                ("Status", cb("status")),
            ],
            refresh=cb("coherence"),
        ))


__all__ = ["CoherenceTabMixin"]
