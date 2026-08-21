"""Controls — the only commands that change risk state.

Three gates, and the banner comment below is the argument for each.

The CONFIRMATION is tappable; the command is not. `/halt` still has to be
typed. No keyboard in this package offers a control, `/menu` and the tab
footers do not carry one, and `_handle_callback` still refuses every Controls
callback that is not already a confirmation. What the button replaces is the
second round trip — reading a four-digit code off a card and typing
`/halt 4821` — with a tap whose callback datum IS `v1|halt|4821`.

The property that survives is the one the README argues for: **there is no path
from a fresh chat to a control.** A button that can arm a control is a control
a stray tap can arm, so this button cannot arm one. It can only confirm one the
same user asked for, in text, seconds earlier. Concretely:

  * The datum carries the single-use code, so it is evidence rather than
    authority. Tapped without a live challenge — a replayed datum, a forwarded
    card, a harvested button re-tapped by a test harness — it reaches
    `_consume_challenge` with nothing to consume and is refused. The code
    requirement is not relaxed; the tap only changes how the code is delivered.
  * The challenge is keyed to the user who TYPED the command, so in a shared
    chat nobody but the requester can fire the button they can all see.
  * `_control` re-checks read authorisation and `TELEGRAM_CONTROL_USER_IDS` on
    the confirming call, tapped or typed, so a still-visible button belonging
    to a revoked operator is dead.
  * The tapped path IS the typed path: both land in
    `_control("halt", ["4821"], ...)` with the same composite actor, so the
    audit row `_apply_control` writes is identical and names who did it either
    way.
  * Every card that follows a consumed challenge is sent with an empty
    keyboard, so a confirm button never outlives the confirmation it carried.

`_is_control_confirmation` is the predicate `_handle_callback` asks before it
lets a Controls callback through, kept here so the shape of a confirmation is
defined once, beside the code that issues it.
"""

from __future__ import annotations

import re
import secrets
import time
from typing import Any

from config import settings
from modules.telegram._common import log
from modules.telegram.format import _money, esc, text_card
from modules.telegram.keyboards import cb, kb

#: A confirmation code as `_control` parses it: exactly four digits, which is
#: what tells it apart from a symbol argument.
_CONFIRM_CODE_RE = re.compile(r"^[0-9]{4}$")

#: action -> (registered spec NAME, the tokens its handler needs to rebuild the
#: action). `cb()` takes spec names only, and `reduceonly_off` is an internal
#: action rather than a command, so the direction rides as an argument the way
#: a typed `/reduceonly off 4821` carries it.
_CONFIRM_ROUTE: dict[str, tuple[str, tuple[str, ...]]] = {
    "halt": ("halt", ()),
    "resume": ("resume", ()),
    "flatten": ("flatten", ()),
    "reduceonly": ("reduceonly", ("on",)),
    "reduceonly_off": ("reduceonly", ("off",)),
    "resetbook": ("resetbook", ()),
    "replay": ("replay", ()),
}


class ControlsMixin:
    # ------------------------------------------------------------------ #
    # Execution analytics
    # ------------------------------------------------------------------ #
    # ------------------------------------------------------------------ #
    # Controls — the only commands that change risk state
    # ------------------------------------------------------------------ #
    #
    # Three gates, because a chat message is an unusually easy thing to send by
    # accident and an unusually easy thing to forward:
    #
    #   1. TELEGRAM_CONTROL_USER_IDS — separate from the read allow-list, empty
    #      by default. Being able to see the book does not imply being able to
    #      stop the desk.
    #   2. A per-user, single-use challenge code that expires. `/halt` alone
    #      never acts; it returns a code that `/halt <code>` consumes. A copied
    #      or forwarded command cannot fire, because the code is bound to the
    #      user who asked and dies after one use. The card carries a Confirm
    #      button which delivers that same code — see the module docstring for
    #      why a tap can confirm a control but still cannot reach one.
    #   3. The gateway's own audit log, which records the actor either way.

    _CHALLENGE_TTL_SECONDS = 90.0

    def _issue_challenge(self, user_id: str, action: str, symbol: str | None) -> str:
        code = f"{secrets.randbelow(9000) + 1000}"
        self._challenges[user_id] = {
            "code": code, "action": action, "symbol": symbol,
            "expires": time.monotonic() + self._CHALLENGE_TTL_SECONDS,
        }
        return code

    def _consume_challenge(self, user_id: str, action: str, code: str) -> tuple[bool, str | None, str]:
        """Returns ``(ok, symbol, reason)``. Single use: the entry is dropped either way."""
        pending = self._challenges.pop(user_id, None)
        if not pending:
            return False, None, "No pending confirmation — run the command without a code first."
        if time.monotonic() > float(pending["expires"]):
            return False, None, "That confirmation expired. Start again."
        if pending["action"] != action:
            return False, None, f"That code was issued for /{pending['action']}, not /{action}."
        if pending["code"] != code:
            return False, None, "Wrong code."
        return True, pending["symbol"], ""

    def _is_control_confirmation(self, name: str, args) -> bool:
        """May this Controls callback through? True only for a confirmation.

        `_handle_callback` asks before it dispatches anything in the Controls
        category, and the answer is deliberately narrow: the ONLY tap a control
        accepts is one that already carries a four-digit code, which is to say
        one that confirms a challenge some earlier typed message opened. Every
        other shape — no argument at all, a symbol, a code with anything beside
        it — is refused there with the "typed, never tapped" toast, so no tap
        can reach the branch of `_control` that ISSUES a challenge.

        Strict about the shape rather than about the digits: `["on", "4821"]`
        passes for /reduceonly, whose handler reads a direction first, and
        fails for /halt, whose handler would read "on" as a SYMBOL and arm a
        fresh challenge from a button.
        """
        tokens = [str(token) for token in args]
        if name == "reduceonly" and tokens[:1] and tokens[0].lower() in {"on", "off"}:
            tokens = tokens[1:]
        return len(tokens) == 1 and _CONFIRM_CODE_RE.fullmatch(tokens[0]) is not None

    def _confirm_keyboard(self, action: str, code: str) -> dict[str, Any]:
        """The one button a control ever sends: confirm THIS challenge.

        The datum is the typed confirmation, spelled as a callback: the spec
        name, the direction token where the handler needs one, and the
        single-use code. It is the whole of what the button can say — no chat
        id, no user id, no grant — so tapping it anywhere other than in front
        of the live challenge it was minted for confirms nothing.
        """
        name, prefix = _CONFIRM_ROUTE[action]
        direction = f" {prefix[0]}" if prefix else ""
        return kb([[(f"✅ Confirm /{name}{direction}", cb(name, *prefix, code))]])

    async def _control(self, action: str, args, chat_id, actor) -> None:
        # This line used to read `user_id = str(actor)`, which handed the whole
        # composite "tg:<id>:<username>" to a membership test against a list of
        # bare numeric ids. `"tg:12345:ian" in ["12345"]` is false for every
        # possible configuration, so every control was permanently refused
        # — including on a deployment that had configured an operator and had
        # no way to discover the switch was dead short of trying it.
        #
        # `_user_id_from_actor` rather than a bare regex, on purpose. It also
        # re-checks READ authorisation, and re-checking at this point is the
        # discipline `_watch_tick` already follows before a delivery:
        # `handle_update` authorised this user when the message arrived, and the
        # gap between that and a change of risk state is exactly where a
        # revocation ought to land. The cost of the stricter helper is that it
        # raises, so the refusal is rendered here — an uncaught PermissionError
        # would surface as the generic "Command failed" card, and a refusal that
        # does not say why is not a refusal.
        try:
            user_id = self._user_id_from_actor(actor)
        except PermissionError:
            await self.send_message(chat_id, text_card(
                f"⛔ /{action} not permitted", "READ AUTHORISATION WITHDRAWN",
                [
                    "This account is not currently authorised to read this book, so it may not change it either.",
                    "Ask the operator about <code>TELEGRAM_ALLOWED_USER_IDS</code>, or reconnect from the workspace.",
                ],
                source="Risk gateway", next_commands="/whoami · /status"))
            return

        if not self._may_control(user_id):
            await self.send_message(chat_id, text_card(
                f"⛔ /{action} not permitted", "CONTROL ALLOW-LIST",
                [
                    f"User ID <code>{esc(user_id)}</code> may read this book but not change it.",
                    "Control commands need <code>TELEGRAM_CONTROL_USER_IDS</code>, which is separate from the read allow-list and empty by default.",
                    "Connecting this chat from the workspace grants reading only — it never adds anyone here.",
                ],
                source="Risk gateway", next_commands="/risk · /headroom"))
            return

        code_arg = args[0] if args and args[0].isdigit() and len(args[0]) == 4 else None
        symbol_arg = None
        if args and not code_arg:
            candidate = args[0].upper()
            if re.fullmatch(r"[A-Z0-9.\-]{1,20}", candidate):
                symbol_arg = candidate

        if not code_arg:
            code = self._issue_challenge(user_id, action, symbol_arg)
            scope = f"<code>{esc(symbol_arg)}</code>" if symbol_arg else "the whole book"
            impact = {
                "halt": "Every subsequent pre-trade check rejects until it is released.",
                "resume": "Pre-trade checks start accepting again.",
                "flatten": "A closing MARKET order is submitted for every open position, through the same risk gates as any other order.",
                "reduceonly": "Pre-trade checks accept only orders that reduce an existing position until released.",
                "reduceonly_off": "Reduce-only is released; ordinary orders are accepted again.",
                "resetbook": "Positions and session accounting on the PAPER book are cleared. This is not an order and sends nothing to a venue.",
                "replay": "One capability is re-fetched through the validated path with its cache bypassed. It spends provider quota and writes a contract result to the data-quality ledger, which can escalate.",
            }[action]
            # The button carries this code and nothing else, so it is a shortcut
            # for the reply below rather than a second way in. The typed line
            # stays on the card: an operator who distrusts a button, or whose
            # client will not render one, has lost nothing.
            await self.send_message(chat_id, text_card(
                f"⚠ Confirm /{action}", "ACTION NOT YET TAKEN",
                [
                    f"Scope <b>{scope}</b>",
                    impact,
                    "",
                    f"Tap <b>Confirm</b> below, or reply <code>/{action} {code}</code>, within {int(self._CHALLENGE_TTL_SECONDS)}s.",
                    "<i>The code is single-use and tied to your user ID, so neither a forwarded message nor a forwarded button can fire it.</i>",
                ],
                source="Risk gateway", next_commands="/risk · /positions"),
                reply_markup=self._confirm_keyboard(action, code))
            return

        # Every card past this point is sent with an EMPTY keyboard. When the
        # confirmation was a tap, `send_message` edits the challenge card in
        # place, and an omitted `reply_markup` would leave Telegram showing the
        # spent Confirm button on top of the outcome.
        ok, symbol, reason = self._consume_challenge(user_id, action, code_arg)
        if not ok:
            await self.send_message(chat_id, text_card(f"✕ /{action} not confirmed", "REJECTED", [esc(reason)], source="Risk gateway", next_commands=f"/{action}"), reply_markup=kb([]))
            return

        try:
            # The composite actor, not the bare id: the allow-list wanted an id,
            # the audit log wants a name beside it. `_apply_control` is what
            # reaches `gateway.submit` and the risk-event log, and those rows
            # should still read `tg:12345:ian` a year from now.
            result = await self._apply_control(action, symbol, actor)
        except Exception as exc:  # noqa: BLE001 - surfaced to the operator verbatim
            log.exception("control %s failed", action)
            await self.send_message(chat_id, text_card(f"✕ /{action} failed", "GATEWAY ERROR", [esc(str(exc)[:200])], source="Risk gateway", next_commands="/status"), reply_markup=kb([]))
            return

        await self.send_message(chat_id, text_card(f"✅ /{action} applied", "RISK STATE CHANGED", result, source="Risk gateway · audited", next_commands="/risk · /positions · /orders"), reply_markup=kb([]))

    async def _apply_control(self, action: str, symbol: str | None, actor: str) -> list[str]:
        gateway = self.gateway
        if action in {"reduceonly", "reduceonly_off"}:
            enabled = action == "reduceonly"
            state = await gateway.set_reduce_only(
                enabled=enabled, actor=actor, reason="from Telegram",
            )
            return [
                f"Reduce-only <code>{'ON' if enabled else 'OFF'}</code>",
                f"Kill switch <code>{'ACTIVE' if getattr(state, 'kill_switch_active', False) else 'INACTIVE'}</code>",
                f"Actor <code>{esc(actor)}</code>",
                "<i>A soft halt: risk-reducing orders still pass, so a position can "
                "always be closed while it is on.</i>" if enabled else
                "<i>Ordinary orders are accepted again.</i>",
            ]
        if action == "replay":
            from modules.data_jobs import submit_replay
            from modules.schemas import DataReplayRequest

            # The symbol the challenge was issued for, so the code cannot be
            # reused against a different instrument than the one confirmed.
            target = (symbol or settings.symbols[0]).upper()
            record = submit_replay(DataReplayRequest(symbol=target), actor=actor)
            return [
                f"Replay queued <code>{esc(target)}</code>",
                f"Job <code>{esc(str(getattr(record, 'id', '') or 'unknown'))}</code>"
                f" · kind <code>{esc(str(getattr(record, 'kind', '') or 'replay'))}</code>",
                f"Actor <code>{esc(actor)}</code>",
                "<i>Runs on the shared jobs engine. The contract result lands in "
                "the data-quality ledger; /jobs and /job follow it.</i>",
            ]
        if action == "resetbook":
            gateway.reset_book(actor=actor)
            return [
                "Paper book <code>RESET</code>",
                f"Actor <code>{esc(actor)}</code>",
                "<i>Positions and session accounting cleared. Nothing was sent to a "
                "venue — this book was never at one.</i>",
            ]
        if action == "halt":
            kill = await gateway.trigger_kill(reason="manual halt from Telegram", actor=actor, symbol=symbol)
            return [f"Kill switch <code>{'ACTIVE' if kill.active else 'INACTIVE'}</code>", f"Halted symbols <code>{esc(', '.join(sorted(kill.halted_symbols)) or 'ALL')}</code>", f"Actor <code>{esc(actor)}</code>"]
        if action == "resume":
            kill = await gateway.release_kill(actor=actor, symbol=symbol)
            return [f"Kill switch <code>{'ACTIVE' if kill.active else 'INACTIVE'}</code>", f"Halted symbols <code>{esc(', '.join(sorted(kill.halted_symbols)) or 'none')}</code>", f"Actor <code>{esc(actor)}</code>"]

        # flatten — composed from the gateway's own order path, one position at a
        # time so the submissions cannot race its exposure accounting.
        report = self._portfolio_report()
        positions = [
            p for p in report["exposure"]["positions"]
            if p.get("notional") and str(p.get("side")).upper() in {"LONG", "SHORT"}
            and (not symbol or str(p.get("symbol")) == symbol)
        ]
        if not positions:
            return ["Nothing to close — the book is already flat."]

        from modules.schemas import OrderRequest

        lines: list[str] = []
        for position in positions:
            side = "SELL" if str(position["side"]).upper() == "LONG" else "BUY"
            # The same entry point a manual order uses — `gateway.submit`, which
            # returns the full check vector for accepted and rejected orders
            # alike. Routing around it would make flatten a second, unaudited
            # execution path.
            decision = await gateway.submit(
                OrderRequest(
                    symbol=str(position["symbol"]), side=side,
                    notional=abs(float(position["notional"])),
                    order_type="MARKET", strategy="flatten",
                ),
                source=actor,
            )
            mark = "✓" if decision.accepted else "✕"
            blocked = ", ".join(decision.rejected_by) or (decision.reason or "rejected")
            reason = "" if decision.accepted else f" · {esc(str(blocked)[:60])}"
            lines.append(f"{mark} {side} <code>{esc(position['symbol'])}</code> <code>{_money(abs(float(position['notional'])))}</code>{reason}")
        accepted_n = sum(1 for line in lines if line.startswith("✓"))
        lines.append(f"<i>{accepted_n}/{len(lines)} accepted. A rejection is the pre-trade gates firing, not a transport failure.</i>")
        return lines

    async def _cmd_halt(self, args, chat_id, actor) -> None:
        await self._control("halt", args, chat_id, actor)

    async def _cmd_resume(self, args, chat_id, actor) -> None:
        await self._control("resume", args, chat_id, actor)

    async def _cmd_reduceonly(self, args, chat_id, actor) -> None:
        # `on`/`off` chooses the direction; everything after is the same
        # allow-list, challenge and audit path the other controls take.
        wants_off = bool(args) and args[0].lower() in {"off", "false", "0"}
        rest = args[1:] if args and args[0].lower() in {"on", "off", "true", "false", "0", "1"} else args
        await self._control("reduceonly_off" if wants_off else "reduceonly", rest, chat_id, actor)

    async def _cmd_resetbook(self, args, chat_id, actor) -> None:
        await self._control("resetbook", args, chat_id, actor)

    async def _cmd_flatten(self, args, chat_id, actor) -> None:
        await self._control("flatten", args, chat_id, actor)

    async def _cmd_replay(self, args, chat_id, actor) -> None:
        # A control, not a read. It spends provider quota, writes a row to the
        # data-quality ledger, and can escalate from that ledger — three
        # outward effects, which is the line the CODE flow exists to guard.
        await self._control("replay", args, chat_id, actor)
