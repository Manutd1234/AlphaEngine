"""Dislocation, book, spread, depth, TCA, routing, liquidity, venues, feeds."""

from __future__ import annotations

import math

from config import settings
from modules.telegram.format import _finite, _money, _number, esc, text_card


class MicrostructureMixin:
    async def _cmd_dislocation(self, args, chat_id, actor) -> None:
        from modules.quant_risk import find_dislocation

        symbol = self._symbol(args)
        books = [
            {
                "venue": b.venue, "ok": bool(b.mid), "best_bid": b.best_bid, "best_ask": b.best_ask,
                # `get_books` returns BookLevel models, not (price, size)
                # tuples. Subscripting them raised TypeError for anyone with
                # two live venues — the exact condition the command exists for,
                # which is why no reachable path ever exercised it.
                "bids": [[lvl.price, lvl.size] for lvl in (b.bids or [])[:1]],
                "asks": [[lvl.price, lvl.size] for lvl in (b.asks or [])[:1]],
            }
            for b in self.tca.get_books(symbol, depth=5)
        ]
        found = find_dislocation(books, symbol)
        if not found:
            await self.send_message(chat_id, text_card(f"⚖ {symbol} dislocation", "NEEDS TWO VENUES", ["Two venues with a live book are required to compare."], source="TCA engine", next_commands="/feedstatus · /venues"))
            return
        if found.crossed:
            lines = [
                f"<b>CROSSED</b> buy <code>{esc(found.buy_venue)}</code> · sell <code>{esc(found.sell_venue)}</code>",
                f"Edge        <code>{_number(found.edge_bps)} bps</code> · <code>{_number(found.edge_usd_per_unit)}</code>/unit",
                f"Executable  <code>{_number(found.executable_size, 4)}</code> units · <code>{_money(found.executable_notional)}</code>",
                f"<i>{esc(found.note)}</i>",
            ]
            state = "CROSSED"
        else:
            lines = [f"Best spread <code>{_number(-found.edge_bps)} bps</code> across venues", f"<i>{esc(found.note)}</i>"]
            state = "NORMAL"
        await self.send_message(chat_id, text_card(f"⚖ {symbol} dislocation", state, lines, source="Cross-venue TCA engine", next_commands=f"/book {symbol} · /tca {symbol} 100000 BUY"))

    async def _cmd_book(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        books = [book for book in self.tca.get_books(symbol, depth=5) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(f"📖 {symbol} book", "NO LIVE BOOK", ["No venue currently has a fresh book."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = []
        for book in books:
            tag = "SYNTHETIC" if book.synthetic else "LIVE"
            lines += [f"<b>{esc(book.venue)} · {tag}</b>", f"Bid <code>{_number(book.best_bid)}</code> · Ask <code>{_number(book.best_ask)}</code> · Spread <code>{_number(book.spread_bps)} bps</code>", f"Depth5 <code>{_money(book.depth_usd_bid)}</code> / <code>{_money(book.depth_usd_ask)}</code> · Imb <code>{_number(book.imbalance, signed=True)}</code>"]
        await self.send_message(chat_id, text_card(f"📖 {symbol} top of book", "LIVE" if not any(book.synthetic for book in books) else "SYNTHETIC", lines, source="Cross-venue TCA engine", next_commands=f"/spread {symbol} · /depth {symbol} · /tca {symbol} 100000 BUY"))

    async def _cmd_spread(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        books = [book for book in self.tca.get_books(symbol, depth=5) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(f"↔️ {symbol} spreads", "NO LIVE BOOK", ["No fresh venue book."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"{esc(book.venue):<12} <code>{_number(book.spread_bps)} bps</code>" for book in books]
        best_bid = max(book.best_bid or 0 for book in books)
        best_ask = min(book.best_ask or math.inf for book in books)
        consolidated_mid = (best_bid + best_ask) / 2 if best_ask < math.inf else None
        consolidated = ((best_ask - best_bid) / consolidated_mid * 10_000) if consolidated_mid else None
        lines += ["", f"Best cross-venue bid <code>{_number(best_bid)}</code>", f"Best cross-venue ask <code>{_number(best_ask)}</code>", f"Consolidated spread <code>{_number(consolidated)} bps</code>"]
        await self.send_message(chat_id, text_card(f"↔️ {symbol} spreads", "LIVE", lines, source="Cross-venue TCA engine", next_commands=f"/book {symbol} · /route {symbol} 100000 BUY"))

    async def _cmd_depth(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        books = [book for book in self.tca.get_books(symbol, depth=20) if book.mid]
        if not books:
            await self.send_message(chat_id, text_card(f"🌊 {symbol} depth", "NO LIVE BOOK", ["No fresh venue book."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"<b>{esc(book.venue)}</b> · bids <code>{_money(book.depth_usd_bid)}</code> · asks <code>{_money(book.depth_usd_ask)}</code> · imbalance <code>{_number(book.imbalance, signed=True)}</code>" for book in books]
        await self.send_message(chat_id, text_card(f"🌊 {symbol} displayed depth", "LIVE" if not any(book.synthetic for book in books) else "SYNTHETIC", lines, source="Cross-venue TCA engine", next_commands=f"/liquidity {symbol} 100000 · /tca {symbol} 100000 BUY"))

    async def _cmd_tca(self, args, chat_id, actor) -> None:
        symbol, notional, side = self._trade_args(args)
        report = self.tca.tca_report(symbol, side, notional)
        if not report.per_venue:
            await self.send_message(chat_id, text_card(f"📊 {symbol} TCA", "NO LIVE BOOK", ["No execution estimate is available."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"Side / size <code>{side} · {_money(notional)}</code>", f"Mid         <code>{_number(report.consolidated_mid)}</code>", "", "<b>Single venue</b>"]
        for estimate in report.per_venue:
            lines.append(f"{esc(estimate.venue)} · <code>{_number(estimate.slippage_bps, signed=True)} bps</code> · VWAP <code>{_number(estimate.vwap)}</code> · <code>{'fillable' if estimate.fillable else 'partial'}</code>")
        if report.smart_route:
            lines += ["", f"<b>Smart route · {_number(report.smart_route_slippage_bps, signed=True)} bps</b>"]
            for leg in report.smart_route:
                lines.append(f"{esc(leg.venue)} <code>{leg.share_pct:.1f}%</code> · <code>{_money(leg.notional)}</code>")
        await self.send_message(chat_id, text_card(f"📊 {symbol} TCA", "SYNTHETIC" if report.synthetic else "LIVE", lines, source="Cross-venue TCA engine", next_commands=f"/route {symbol} {notional:g} {side} · /liquidity {symbol} {notional:g}"))

    async def _cmd_route(self, args, chat_id, actor) -> None:
        symbol, notional, side = self._trade_args(args)
        report = self.tca.tca_report(symbol, side, notional)
        if not report.smart_route:
            await self.send_message(chat_id, text_card(f"🧭 {symbol} route", "NOT FILLABLE", [f"No complete route for <code>{side} {_money(notional)}</code>."], source="TCA engine", next_commands=f"/liquidity {symbol} {notional:g}"))
            return
        lines = [f"Order <code>{side} · {_money(notional)}</code>", f"Blended VWAP <code>{_number(report.smart_route_vwap)}</code>", f"Slippage <code>{_number(report.smart_route_slippage_bps, signed=True)} bps</code>"]
        for leg in report.smart_route:
            lines.append(f"{esc(leg.venue):<12} <code>{leg.share_pct:5.1f}%</code> · <code>{_money(leg.notional)}</code> @ <code>{_number(leg.vwap)}</code>")
        await self.send_message(chat_id, text_card(f"🧭 {symbol} smart route", "SYNTHETIC" if report.synthetic else "LIVE", lines, source="Cross-venue TCA engine", next_commands=f"/tca {symbol} {notional:g} {side} · /watch {symbol} {notional:g} 25"))

    async def _cmd_liquidity(self, args, chat_id, actor) -> None:
        symbol = self._symbol(args)
        notional = _finite(args[1]) if len(args) > 1 else settings.default_probe_notional
        if notional is None or notional <= 0:
            raise ValueError("notional must be a positive finite number")
        estimate = self.tca.route_estimate(symbol, "BUY", notional)
        if not estimate:
            await self.send_message(chat_id, text_card(f"🌊 {symbol} liquidity", "NO LIVE BOOK", ["No route estimate is available."], source="TCA engine", next_commands="/feedstatus"))
            return
        lines = [f"Probe size <code>{_money(notional)}</code>", f"Fillable   <code>{'YES' if estimate.fillable else 'NO'}</code>", f"Routable   <code>{_money(estimate.filled_notional)}</code>", f"Slippage   <code>{_number(estimate.slippage_bps, signed=True)} bps</code>", f"Route      <code>{esc(estimate.venue)}</code>"]
        await self.send_message(chat_id, text_card(f"🌊 {symbol} liquidity", "LIVE" if estimate.fillable else "THIN", lines, source="Cross-venue TCA engine", next_commands=f"/route {symbol} {notional:g} BUY · /watch {symbol} {notional:g} 25"))

    async def _cmd_venues(self, args, chat_id, actor) -> None:
        health = self.tca.health()
        lines = []
        for feed in health.get("feeds", []):
            symbols = feed.get("symbols") or {}
            rate = sum(_finite(value.get("rate_hz")) or 0 for value in symbols.values())
            lines.append(f"{'🟢' if feed.get('connected') else '🔴'} <b>{esc(feed.get('venue'))}</b> · <code>{rate:.0f} upd/s</code> · <code>{feed.get('reconnects', 0)} reconnects</code>")
        await self.send_message(chat_id, text_card("🏛 Execution venues", "SYNTHETIC ACTIVE" if health.get("synthetic_active") else "LIVE FEEDS", lines or ["No feeds configured."], source="TCA engine", next_commands="/feedstatus · /book BTCUSDT"))

    async def _cmd_feedstatus(self, args, chat_id, actor) -> None:
        health = self.tca.health()
        lines = [f"Engine uptime <code>{_number(health.get('uptime_s'), 0)} s</code>", f"Symbols <code>{', '.join(health.get('symbols') or [])}</code>"]
        for feed in health.get("feeds", []):
            lines.append(f"\n<b>{esc(feed.get('venue'))}</b> · <code>{'connected' if feed.get('connected') else 'offline'}</code> · uptime <code>{_number(feed.get('uptime_s'), 0)} s</code>")
            if feed.get("last_error"):
                lines.append(f"Error <code>{esc(str(feed['last_error'])[:180])}</code>")
        await self.send_message(chat_id, text_card("📡 Market-feed health", "SYNTHETIC" if health.get("synthetic_active") else "OBSERVED", lines, source="TCA engine", next_commands="/venues · /status"))
