"""Paper equities use trusted quotes without pretending a quote is an L2 book."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from config import settings
from modules.risk_proxy import RiskGateway, TokenBucket
from modules.schemas import OrderRequest, PaperExecutionReference
from modules.tca_engine import TCAEngine


def reference(*, age: timedelta = timedelta(seconds=5)) -> PaperExecutionReference:
    return PaperExecutionReference(
        price=200.0,
        as_of=datetime.now(timezone.utc) - age,
        source="Financial Modeling Prep",
        currency="USD",
        delayed=False,
    )


def order(**changes) -> OrderRequest:
    values = {
        "symbol": "AAPL",
        "side": "BUY",
        "notional": 10_000.0,
        "order_type": "MARKET",
        "paper_execution": reference(),
    }
    values.update(changes)
    return OrderRequest(**values)


@pytest.fixture
def gateway() -> RiskGateway:
    engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
    result = RiskGateway(tca_engine=engine, audit=None)
    result.bucket = TokenBucket(1e6, 1_000_000)
    return result


@pytest.mark.asyncio
async def test_trusted_equity_quote_fills_with_an_explicit_paper_model(gateway: RiskGateway):
    decision = await gateway.submit(order())

    assert decision.accepted, decision.reason
    assert decision.fill is not None
    assert decision.fill.simulated
    assert decision.fill.venue == "PAPER_EQUITY/Financial Modeling Prep"
    assert decision.fill.slippage_bps == pytest.approx(settings.paper_equity_slippage_bps)
    assert decision.fill.price == pytest.approx(200 * (1 + settings.paper_equity_slippage_bps / 1e4))
    assert next(check for check in decision.checks if check.name == "est_slippage").detail.endswith(
        "no exchange depth asserted"
    )

    position = gateway.state().positions[0]
    assert position.symbol == "AAPL"
    assert position.mark_price == pytest.approx(200.0)
    assert position.notional > 0


@pytest.mark.asyncio
async def test_unknown_symbol_without_trusted_quote_stays_closed(gateway: RiskGateway):
    decision = await gateway.submit(order(paper_execution=None))
    assert not decision.accepted
    assert {"symbol_whitelist", "price_available"} <= set(decision.rejected_by)


@pytest.mark.asyncio
async def test_stale_or_future_equity_quote_is_rejected(gateway: RiskGateway):
    stale = await gateway.submit(order(paper_execution=reference(age=timedelta(days=8))))
    future = await gateway.submit(
        order(
            client_order_id="future-quote",
            paper_execution=reference(age=timedelta(minutes=-5)),
        )
    )

    assert "reference_freshness" in stale.rejected_by
    assert "reference_freshness" in future.rejected_by


@pytest.mark.asyncio
async def test_equity_limit_order_is_rejected_without_fake_marketability(gateway: RiskGateway):
    decision = await gateway.submit(order(order_type="LIMIT", limit_price=199.0))
    assert not decision.accepted
    assert "paper_execution_model" in decision.rejected_by
    assert decision.fill is None


def test_paper_equity_contract_rejects_ambiguous_tickers_and_timestamps():
    with pytest.raises(ValueError, match="US-style ticker"):
        order(symbol="NOT-A-STOCK")
    with pytest.raises(ValueError, match="timezone"):
        reference_value = reference().model_copy(update={"as_of": datetime(2026, 1, 1)})
        OrderRequest(
            symbol="AAPL",
            side="BUY",
            notional=1_000,
            paper_execution=reference_value.model_dump(),
        )
