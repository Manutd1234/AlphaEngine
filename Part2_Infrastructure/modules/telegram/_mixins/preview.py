"""``/preview`` — the web order ticket's verdict panel, delivered over Telegram.

What this is
------------
`web/components/execution/OrderVerdict.tsx` is the panel this mirrors. Its whole
argument is that a ticket which says only "rejected" teaches a trader nothing,
while one that names the gate that fired — with the number that tripped it —
turns a refusal into information. That argument is worth just as much before an
order exists as after one, and a trader on a phone cannot open the ticket.

What this is NOT
----------------
It is not an order path, and there is no way to make it one. The companion's
security guarantee is written down: the bot cannot *open* a position, there is
intentionally no ``/order`` command, and no way to reach one. `/preview`
therefore reads and only reads.

``RiskGateway.submit`` is the reference battery, and it is deliberately NOT
called here — not even against a throwaway gateway. It draws a rate-limit token,
stamps an order id, applies a paper fill, moves ``orders_accepted``, writes an
audit row and records a decision-latency sample into the process-wide histogram.
`tests/test_telegram_analytics.py` pins the standard the read-only previews are
held to: "the preview must not consume a token, count, audit or sample". So every
figure below comes from the gateway's own published read model and its own
read-only accessors — ``mark``, ``projected_symbol_notional``, ``gross_exposure``,
``symbol_notional``, ``daily_drawdown_pct`` (via the state payload) and
``TCAEngine.route_estimate`` — and the gate list and its evaluation order come
from ``modules/risk_proxy/gates.py``, the one registry three other readers
already agree on. No threshold, no drawdown ratio and no ladder walk is
re-derived here; a second copy is what the parity fixtures exist to prevent.

Honesty rules this card keeps
-----------------------------
A gate the battery would not reach for this order shape says so, and why. A gate
whose input a read-only preview cannot produce says *that*, and why — it is not
reported as passing, and it downgrades the overall verdict to undecided rather
than letting the card claim an acceptance it has not earned. Deny-by-default on
ambiguity is the gateway's own first design principle; this card follows it.

The one place that discipline bites hardest is ``symbol_concentration`` and
``gross_exposure`` with no mark. The reference battery still *evaluates* them
there, against a price that has fallen back to zero, and they trivially pass —
after ``price_available`` has already rejected the order. Printing "$0 projected,
passed" would be the exact ``x or 0.0`` lie this codebase refuses, so the card
reports them as unmeasured and explains the reason instead.
"""

from __future__ import annotations

from config import settings
from modules.risk_proxy.gates import GATE_ORDER
from modules.telegram.format import _finite, esc, text_card

#: The four states a gate can be reported in. ``PASS``/``BLOCK`` are the two the
#: web panel draws; the other two exist because a preview is not a submission and
#: must never dress an unrun gate as a cleared one.
from modules.telegram.preview_gates import (  # noqa: F401
    _BLOCK,
    _CLEARS,
    _CLOSING,
    _LEGEND,
    _MARKS,
    _SIDES,
    _SKIP,
    _UNKNOWN,
    _UNREPORTED,
    _VERDICT_BLOCK,
    _VERDICT_CLEARS,
    _VERDICT_UNDECIDED,
    _binding,
    _bps,
    _flagged,
    _gate_drawdown,
    _gate_line,
    _gate_order_notional,
    _gate_rate_limit,
    _gate_reduce_only,
    _gate_slippage,
    _gate_whitelist,
    _GateRow,
    _gates_admission,
    _gates_exposure,
    _gates_price,
    _gates_resting,
    _header_lines,
    _measured,
    _per_second,
    _price_source,
    _skipped,
    _unknown,
    _usage_card,
)


class PreviewMixin:
    # ------------------------------------------------------------------ #
    # Pre-trade preview (read-only)
    # ------------------------------------------------------------------ #
    def _preview_order(self, args) -> tuple[str, str, float]:
        """``/preview [SYMBOL] [BUY|SELL] [NOTIONAL]``, in either order after the symbol.

        A side is a word and a notional is a number, so the two can never be
        confused for one another — and a trader who types them the other way
        round gets an answer rather than a lecture. `_symbol` comes from
        `ParsingMixin` on the same object, and raises for a malformed ticker.
        """
        symbol = self._symbol(args)
        if len(args) > 3:
            raise ValueError("expected at most SYMBOL, SIDE and NOTIONAL")
        side, notional = "BUY", None
        for token in args[1:]:
            upper = str(token).strip().upper()
            if upper in _SIDES:
                side = upper
                continue
            notional = _finite(token)
            if notional is None:
                raise ValueError(f"{token!r} is neither a side (BUY/SELL) nor a notional")
        if notional is None:
            notional = float(settings.default_probe_notional)
        if not 0 < notional <= 1_000_000_000:
            raise ValueError("notional must be a positive number up to $1bn")
        return symbol, side, notional

    def _preview_universe(self):
        """The gateway's own prebuilt whitelist — never a second copy of it."""
        universe = getattr(self.gateway, "_whitelist", None)
        return universe if isinstance(universe, frozenset) else None

    def _preview_rows(self, state, symbol, side, notional, mark, crypto) -> list[_GateRow]:
        """Every gate in ``GATE_ORDER``, in the order ``submit`` evaluates them.

        Keyed by name and emitted against the registry, so the card cannot drift
        out of order and cannot silently drop a gate: one that produced no
        reading is still printed, as undecided.
        """
        limits = state.limits or {}
        built: dict[str, _GateRow] = {}
        for row in (
            *_gates_admission(state, symbol, self._preview_universe(), crypto),
            _gate_rate_limit(state, limits),
            *_gates_price(mark),
            _gate_order_notional(limits, notional),
            *_gates_exposure(self.gateway, limits, symbol, side, notional, mark),
            *_gates_resting(state),
            _gate_drawdown(state, limits),
            _gate_reduce_only(state, symbol),
            _gate_slippage(self.tca, limits, symbol, side, notional, crypto),
        ):
            built[row.name] = row
        return [built.get(name) or _unknown(name, _UNREPORTED) for name in GATE_ORDER]

    async def _cmd_preview(self, args, chat_id, actor) -> None:
        """The web order ticket's verdict panel, for an order that does not exist.

        Runs the pre-trade battery's readings against current state and reports
        the verdict, every gate, the value each was measured against and which
        gate binds first. It submits, queues, reserves and persists nothing.
        """
        del actor  # a read-only preview has no actor-scoped behaviour
        try:
            symbol, side, notional = self._preview_order(args)
        except ValueError as exc:
            await self.send_message(chat_id, _usage_card(str(exc)))
            return

        state = self.gateway.state() if self.gateway else None
        if state is None:
            await self.send_message(chat_id, text_card(
                "🧮 Order preview", "NO GATEWAY",
                ["No risk gateway is attached to this bot, so no gate can be read.",
                 "<i>Nothing was submitted. The battery was not run and no verdict is claimed.</i>"],
                source="AlphaEngine pre-trade battery", next_commands="/status · /limits"))
            return

        crypto = symbol.endswith(("USDT", "-USD"))
        mark = self.gateway.mark(symbol)
        rows = self._preview_rows(state, symbol, side, notional, mark, crypto)
        blocking = [row for row in rows if row.state == _BLOCK]
        unresolved = [row for row in rows if row.state == _UNKNOWN]
        verdict = _VERDICT_BLOCK if blocking else (_VERDICT_UNDECIDED if unresolved else _VERDICT_CLEARS)
        lines = _header_lines(symbol, side, notional, mark,
                              _price_source(self.tca, symbol, mark, crypto), verdict, blocking, rows)
        lines.append("")
        lines.extend(_gate_line(row) for row in rows)
        lines += ["", _LEGEND, _CLOSING]
        await self.send_message(chat_id, text_card(
            f"🧮 Order preview · {esc(symbol)}", f"DRY-RUN · {verdict}", lines,
            source="Gateway read-only state · pre-trade gate registry",
            next_commands=f"/gates {symbol} · /tca {symbol} · /limits · /headroom"))
