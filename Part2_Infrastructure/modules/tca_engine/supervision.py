"""Watching the feeds: health classification, alert transitions and failover.

Mixed into :class:`~modules.tca_engine.engine.TCAEngine`. Kept apart from the
engine's own accessors because this is the *operational* half — it decides when
a venue counts as down, when that is worth telling a human about, and when the
synthetic book has to stand in — and none of it is on the decision path.
"""

from __future__ import annotations

import asyncio
import logging

from modules.tca_engine._runtime import settings
from modules.tca_engine.feed import VenueFeed
from modules.tca_engine.synthetic import SyntheticFeed

log = logging.getLogger("alphaengine.tca")


class FeedSupervision:
    """The feed watchdog, its alert hooks and the TCA snapshot timer."""

    def add_alert_hook(self, hook) -> None:
        """Register a coroutine ``(severity, message)`` for feed transitions.

        The risk gateway has had this for kill-switch and drawdown events since
        the beginning; market data did not, so a venue could go dark and the
        only trace was a log line nobody was reading. Same shape, same
        failure-isolation rule: an alert transport must never break ingestion.
        """
        self._alert_hooks.append(hook)

    async def _alert(self, severity: str, message: str) -> None:
        for hook in self._alert_hooks:
            try:
                await hook(severity, message)
            except Exception as exc:
                log.error("feed alert hook failed: %s", exc)

    def _feed_health(self, feed: VenueFeed) -> tuple[str, str]:
        """Classify one venue as up / stale / down, with a human reason."""
        if not feed.connected:
            return "down", f"{feed.name} disconnected"
        books = [b for b in feed.books.values() if b.has_book]
        if not books:
            return "down", f"{feed.name} connected but publishing no book"
        stale = [b.symbol for b in books if b.stale]
        if len(stale) == len(books):
            return "stale", f"{feed.name} book stale for {', '.join(sorted(stale))}"
        if stale:
            return "degraded", f"{feed.name} stale on {', '.join(sorted(stale))}"
        return "up", f"{feed.name} healthy"

    async def _check_feed_health(self) -> None:
        from modules.audit import get_audit

        for name, feed in list(self.feeds.items()):
            if name == "SIM":
                continue  # the fallback's own transitions are already logged
            status, reason = self._feed_health(feed)
            previous = self._feed_state.get(name)
            if previous == status:
                continue
            self._feed_state[name] = status
            if previous is None:
                continue  # first observation is a baseline, not an incident

            recovered = status == "up"
            severity = "info" if recovered else "warning" if status == "degraded" else "critical"
            event = "feed_recovered" if recovered else "feed_degraded"
            try:
                get_audit().record_risk_event(
                    event, severity=severity, actor="feed-watchdog", detail=reason,
                    payload={"venue": name, "status": status, "previous": previous},
                )
            except Exception as exc:
                log.error("could not audit feed transition: %s", exc)

            await self._alert(
                severity,
                f"{'✅' if recovered else '📡'} {reason}."
                + ("" if recovered else " Prices from this venue are not safe to trade on."),
            )

    async def _watch(self) -> None:
        """Bring up the synthetic feed only if every real venue is dark."""
        while True:
            await asyncio.sleep(5)
            try:
                await self._check_feed_health()
            except Exception as exc:
                # Health reporting is observability; it must never be the reason
                # the synthetic-book failover below stops running.
                log.error("feed health check failed: %s", exc)
            if not settings.allow_synthetic_book:
                continue
            live = any(f.connected and any(b.has_book for b in f.books.values()) for f in self.feeds.values())
            if not live and self._synthetic is None:
                log.warning("no live venue feed after startup — enabling SYNTHETIC book (clearly tagged)")
                self._synthetic = SyntheticFeed(self.symbols)
                self.feeds["SIM"] = self._synthetic
                self._synthetic.start()
            elif live and self._synthetic is not None:
                log.info("live venue feed restored — disabling synthetic book")
                await self._synthetic.stop()
                self.feeds.pop("SIM", None)
                self._synthetic = None

    async def _snapshot_loop(self) -> None:
        from modules.audit import get_audit

        audit = get_audit()
        while True:
            await asyncio.sleep(settings.tca_snapshot_interval_s)
            try:
                for sym in self.symbols:
                    for venue, book in self._live_books(sym).items():
                        probe = settings.default_probe_notional
                        buy = book.walk("BUY", probe)
                        sell = book.walk("SELL", probe)
                        await asyncio.to_thread(
                            audit.record_tca_snapshot,
                            {
                                "symbol": sym,
                                "venue": venue,
                                "best_bid": book.best_bid,
                                "best_ask": book.best_ask,
                                "mid": book.mid,
                                "spread_bps": book.spread_bps,
                                "depth_usd_bid": book.depth_usd("bid"),
                                "depth_usd_ask": book.depth_usd("ask"),
                                "probe_notional": probe,
                                "buy_slip_bps": buy.slippage_bps,
                                "sell_slip_bps": sell.slippage_bps,
                                "synthetic": book.synthetic,
                            },
                        )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("tca snapshot failed: %s", exc)
