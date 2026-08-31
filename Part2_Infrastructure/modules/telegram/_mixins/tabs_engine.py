"""Markets, Proofs and Diffusion engine snapshots for the companion."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from config import settings
from modules.coherence import tunables
from modules.telegram.engine_snapshots import (
    COMMAND_BUDGET_SECONDS,
    MIN_EPISODES_FOR_HALF_LIFE,
    SURVIVAL_MINIMUM,
    DiffusionSnapshot,
    MarketsSnapshot,
    ProofsSnapshot,
    diffusion_snapshot,
    markets_snapshot,
    proof_method_note,
    proofs_snapshot,
)
from modules.telegram.format import esc, text_card
from modules.telegram.keyboards import _tab_footer, add_url_row, cb

SnapshotT = TypeVar("SnapshotT")

# ReadBudget is the primary boundary. This outer guard contains regressions in
# a future adapter (or a blocked dependency before it reaches ReadBudget) and
# leaves a small scheduling margin for the fallback card.
ENGINE_COMMAND_TIMEOUT_SECONDS = COMMAND_BUDGET_SECONDS + 0.5
_FAILED_READ_STATES = frozenset({"timeout", "unavailable", "invalid"})


async def _bounded_snapshot(
    label: str,
    call: Callable[[], Awaitable[SnapshotT]],
    fallback: Callable[..., SnapshotT],
) -> SnapshotT:
    try:
        return await asyncio.wait_for(call(), timeout=ENGINE_COMMAND_TIMEOUT_SECONDS)
    except TimeoutError:
        return fallback(
            state="timeout",
            detail=f"{label} snapshot exceeded the command deadline",
        )
    except Exception as exc:  # noqa: BLE001 - the card exposes only the safe class
        return fallback(
            state="unavailable",
            detail=f"{label} snapshot returned {type(exc).__name__}",
        )


def _status(state: str) -> str:
    normalized = state.lower()
    return "DEGRADED · PARTIAL" if normalized == "partial" else normalized.upper()


def _part_state(state: str | None, overall: str) -> str:
    return (state or overall).lower()


def _part_observed(state: str | None, overall: str) -> bool:
    return _part_state(state, overall) not in _FAILED_READ_STATES


def _shown(value: Any) -> str:
    """Escape a real value while keeping missing distinct from numeric zero."""
    return "—" if value is None else esc(value)


def _money(value: Any) -> str:
    return "—" if value is None else f"${esc(value)}"


def _age(value: float | None) -> str:
    return "live request" if value is None else f"cached {value:.1f} s"


def _reason(value: str | None) -> str | None:
    if not value:
        return None
    return esc(value[:180])


def _workspace_link(fragment: str) -> str | None:
    origin = settings.resolved_web_workspace_url
    if not origin.startswith("https://"):
        return None
    return f"{origin.rstrip('/')}/#{fragment.lstrip('#')}"


def _footer(tab: str, peers: list[tuple[str, str]], *, refresh: str, fragment: str) -> dict:
    markup = _tab_footer(tab, peers, refresh=refresh)
    link = _workspace_link(fragment)
    return add_url_row(markup, "Open web view", link) if link else markup


class EngineTabsMixin:
    """Read-only, bounded commands for the three market-engine products."""

    async def _cmd_tab_markets(self, args, chat_id, actor) -> None:
        del actor
        series = args[0].upper() if args else None
        data = await _bounded_snapshot(
            "markets",
            lambda: markets_snapshot(series),
            MarketsSnapshot,
        )
        lines = [f"Series         <code>{_shown(data.selected_series or series)}</code>"]
        if data.event_title:
            lines.append(f"Question       {_shown(data.event_title)}")
        if _part_observed(None, data.state):
            if data.event_ticker is None:
                lines.append(f"Universe       <code>{esc(data.state)}</code>; no family selected")
            else:
                lines.append(f"Family         <code>{_shown(data.event_ticker)}</code>")
                lines += [
                    f"Basket / $1    <code>{_money(data.basket_cost)}</code>",
                    f"Top YES book   <code>{_money(data.yes_bid)} / {_money(data.yes_ask)}</code>",
                    f"Spread         <code>{_money(data.spread)}</code>",
                    f"Settlement     <code>{_shown(', '.join(data.settlement_sources) or None)}</code>",
                    f"Freshness      <code>{esc(_age(data.observed_age_s))}</code>",
                ]
        else:
            lines += [
                f"Universe       <code>{esc(data.state)}</code>",
                "No market values were substituted for the failed read.",
            ]
        lines += [
            f"Fee kernel     <code>taker coefficient {esc(tunables.TAKER_RATE)}</code>",
            "Web route      <code>#markets/universe</code>",
        ]
        if detail := _reason(data.detail):
            lines += ["", f"Read note      {detail}"]
        await self.send_message(
            chat_id,
            text_card(
                "Markets", _status(data.state), lines,
                source="Kalshi universe read model; read only",
                next_commands="/proofs · /diffusion · /commands",
            ),
            reply_markup=_footer(
                "markets", [("Proofs", cb("proofs")), ("Diffusion", cb("diffusion"))],
                refresh=cb("markets", *([series] if series else [])), fragment="markets/universe",
            ),
        )

    async def _cmd_tab_proofs(self, args, chat_id, actor) -> None:
        del actor
        series = args[0].upper() if args else None
        data = await _bounded_snapshot(
            "proofs",
            lambda: proofs_snapshot(series),
            ProofsSnapshot,
        )
        priced = "yes" if data.priced_out is True else "no" if data.priced_out is False else "—"
        viable = "yes" if data.worth_doing is True else "no" if data.worth_doing is False else "—"
        lines = [f"Series         <code>{_shown(data.selected_series or series)}</code>"]
        if _part_observed(data.universe_state, data.state):
            lines += [
                f"Family         <code>{_shown(data.event_ticker)}</code>",
                f"Basket buy     <code>{_money(data.basket_cost)}</code>",
            ]
        else:
            lines.append(
                f"Universe       <code>{esc(_part_state(data.universe_state, data.state))}</code>"
            )

        lines.append("")
        if _part_observed(data.certificate_state, data.state) and data.verdict is not None:
            lines += [
                "<b>Certificate</b>",
                f"Verdict        <code>{_shown(data.verdict)}</code> via <code>{_shown(data.engine)}</code>",
                f"Priced / trade <code>{priced} / {viable}</code>",
                f"Witness        <code>{data.witness_legs} legs</code>; worst case "
                f"<code>{_money(data.worst_case_payoff)}</code>",
                f"Edge net/gross <code>{_money(data.net_edge)} / {_money(data.gross_edge)}</code>; "
                f"fees <code>{_money(data.total_fees)}</code>",
            ]
        else:
            lines.append(
                "Certificate    "
                f"<code>{esc(_part_state(data.certificate_state, data.state))}</code>; "
                "no witness values substituted"
            )

        if _part_observed(data.index_state, data.state):
            lines += [
                f"Index sample   <code>{_money(data.index_value)}</code>; "
                f"{data.index_measured} measured / {data.index_unmeasurable} unmeasurable",
            ]
        else:
            lines.append(
                f"Index sample   <code>{esc(_part_state(data.index_state, data.state))}</code>"
            )
        if _part_observed(data.universe_state, data.state):
            lines.append(f"Freshness      <code>{esc(_age(data.observed_age_s))}</code>")
        lines += [
            f"Method         <code>{esc(proof_method_note())}</code>",
            "Web route      <code>#coherence/certificate</code>",
        ]
        if data.verdict is not None and data.witness_legs == 0:
            lines.append("No reproducible fee-surviving witness was returned.")
        if detail := _reason(data.detail):
            lines += ["", f"Read note      {detail}"]
        await self.send_message(
            chat_id,
            text_card(
                "Proofs", _status(data.state), lines,
                source="Coherence certificate and recorded index; read only",
                next_commands="/markets · /diffusion · /coherence",
            ),
            reply_markup=_footer(
                "proofs", [("Markets", cb("markets")), ("Diffusion", cb("diffusion"))],
                refresh=cb("proofs", *([series] if series else [])), fragment="coherence/certificate",
            ),
        )

    async def _cmd_tab_diffusion(self, args, chat_id, actor) -> None:
        del args, actor
        data = await _bounded_snapshot(
            "diffusion",
            diffusion_snapshot,
            DiffusionSnapshot,
        )
        survival = "qualified" if data.closed_episodes >= SURVIVAL_MINIMUM else "needs more"
        median = (
            "qualified" if data.closed_episodes >= MIN_EPISODES_FOR_HALF_LIFE else "withheld"
        )
        lines: list[str] = []
        if _part_observed(data.absorption_state, data.state):
            lines += [
                f"Runs           <code>{data.runs}</code>",
                f"Release / call <code>{data.release_measured} / {data.call_measured} measured</code>",
                f"Below floor    <code>{data.release_no_signal} / {data.call_no_signal}</code>",
                f"Half-life      <code>{_shown(data.release_half_life_s)} s / "
                f"{_shown(data.call_half_life_s)} s</code>",
            ]
        else:
            lines.append(
                f"Absorption     <code>{esc(_part_state(data.absorption_state, data.state))}</code>; "
                "no zero substituted"
            )

        if _part_observed(data.episodes_state, data.state):
            lines += [
                f"Survival       <code>{data.closed_episodes}/{SURVIVAL_MINIMUM} closed; {survival}</code>",
                f"Robust median  <code>{data.closed_episodes}/{MIN_EPISODES_FOR_HALF_LIFE} closed; "
                f"{median}</code>",
                f"Episodes       <code>{data.open_episodes} open; median "
                f"{_shown(data.episode_median_s)} s</code>",
            ]
        else:
            lines.append(
                f"Episodes       <code>{esc(_part_state(data.episodes_state, data.state))}</code>; "
                "sample gates unavailable"
            )

        if _part_observed(data.findings_state, data.state):
            lines += [
                f"Finding gate   <code>{_shown(data.gate_state)}</code>; "
                f"{data.gate_samples} samples / floor {_shown(data.gate_floor)}",
                f"Out-of-fold R² <code>{_shown(data.gate_r_squared)}</code>",
                f"Findings       <code>{data.findings_holds} hold / {data.findings_absent} absent</code>",
                f"As of          <code>{_shown(data.observed_at)}</code>",
            ]
        else:
            lines.append(
                f"Findings       <code>{esc(_part_state(data.findings_state, data.state))}</code>; "
                "no verdict count substituted"
            )
        lines.append("Web route      <code>#diffusion/arm</code>")
        detail = data.detail or data.episode_median_reason
        if reason := _reason(detail):
            lines += ["", f"Gate note      {reason}"]
        await self.send_message(
            chat_id,
            text_card(
                "Diffusion", _status(data.state), lines,
                source="Absorption, episode and findings read models; read only",
                next_commands="/markets · /proofs · /commands",
            ),
            reply_markup=_footer(
                "diffusion", [("Markets", cb("markets")), ("Proofs", cb("proofs"))],
                refresh=cb("diffusion"), fragment="diffusion/arm",
            ),
        )


__all__ = ["ENGINE_COMMAND_TIMEOUT_SECONDS", "EngineTabsMixin"]
