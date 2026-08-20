"""Parsing / data helpers — banner section of the same name."""

from __future__ import annotations

from typing import Any

from config import settings
from modules.telegram._common import _SYMBOL_RE
from modules.telegram.format import _finite, esc, text_card


class ParsingMixin:
    # ------------------------------------------------------------------ #
    # Parsing / data helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _symbol(args: list[str], index: int = 0) -> str:
        symbol = (args[index] if len(args) > index else settings.symbols[0]).strip().upper()
        if not _SYMBOL_RE.fullmatch(symbol):
            raise ValueError("symbol must contain only letters, numbers, dot or hyphen")
        return symbol

    @staticmethod
    def _symbols(args: list[str], limit: int = 6) -> list[str]:
        """
        Every leading argument that is a symbol, de-duplicated, order kept.

        `_symbol` reads one and `_asset` reads the next positional as the asset
        class, so "/quote BTCUSDT ETHUSDT" used to reject ETHUSDT as an invalid
        asset. Symbol-shaped leading tokens are collected here instead, and
        parsing stops at the first token that is not one — which is where the
        asset keyword lives, so the existing single-symbol form is untouched.
        """
        found: list[str] = []
        for raw in args:
            candidate = raw.strip().upper()
            if candidate.lower() in {"equity", "crypto"}:
                break
            if not _SYMBOL_RE.fullmatch(candidate):
                break
            if candidate not in found:
                found.append(candidate)
            if len(found) >= limit:
                break
        return found or [settings.symbols[0].upper()]

    @staticmethod
    def _asset(symbol: str, args: list[str], index: int = 1) -> str:
        default = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
        asset = (args[index].lower() if len(args) > index else default)
        if asset not in {"equity", "crypto"}:
            raise ValueError("asset must be equity or crypto")
        return asset

    @staticmethod
    def _limit(args: list[str], index: int, default: int, maximum: int = 20) -> int:
        try:
            value = int(args[index]) if len(args) > index else default
        except ValueError as exc:
            raise ValueError("count must be an integer") from exc
        if not 1 <= value <= maximum:
            raise ValueError(f"count must be between 1 and {maximum}")
        return value

    @staticmethod
    def _bar_args(args: list[str]) -> tuple[str, str, int, str]:
        symbol = ParsingMixin._symbol(args)
        interval = args[1].lower() if len(args) > 1 else "1d"
        if interval not in {"15m", "1h", "4h", "1d"}:
            raise ValueError("interval must be 15m, 1h, 4h or 1d")
        count = ParsingMixin._limit(args, 2, 5, 50)
        asset = "crypto" if symbol.endswith(("USDT", "-USD")) else "equity"
        return symbol, interval, count, asset

    @staticmethod
    def _trade_args(args: list[str]) -> tuple[str, float, str]:
        symbol = ParsingMixin._symbol(args)
        notional = _finite(args[1]) if len(args) > 1 else settings.default_probe_notional
        side = args[2].upper() if len(args) > 2 else "BUY"
        if notional is None or notional <= 0 or notional > 1_000_000_000:
            raise ValueError("notional must be a positive finite number up to $1bn")
        if side not in {"BUY", "SELL"}:
            raise ValueError("side must be BUY or SELL")
        return symbol, notional, side

    @staticmethod
    def _openbb_error(capability: str, payload: dict[str, Any]) -> str:
        detail = str(payload.get("error") or payload.get("detail") or "provider returned no data")[:260]
        return text_card(
            f"⚠️ OpenBB · {capability}",
            "UNAVAILABLE",
            [esc(detail)],
            source="OpenBB / yfinance",
            next_commands="/openbb · /status",
        )

    def _portfolio_report(self) -> dict[str, Any]:
        from modules.portfolio import build_portfolio

        return build_portfolio(self.gateway, self.audit)
