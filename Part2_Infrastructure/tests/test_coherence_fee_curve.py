"""The fee at every price, from the kernel the worked example already uses.

`/api/coherence/fees` works ONE case through and it is the right case — Kalshi's
own documented example, where the rounding component is nineteen times the
trading one. What it cannot answer is the question that example raises: whether
that ratio is a property of THAT PRICE or of the schedule. Only a curve can, and
the desk had been drawing one from a formula written in TypeScript — a third
implementation of arithmetic this repository keeps in Python precisely so the two
it already has can be held to parity by fixture.

Four properties, each a way this route could quietly stop being the same
arithmetic as its neighbour:

**IT IS THE SAME KERNEL, NOT A REIMPLEMENTATION.** The point at a price must
equal what `net_fee` returns for that price at the same size and fill count.
That is the whole reason the route exists, so it is asserted directly rather
than trusted.

**FILLS MOVE THE CURVE.** One fill and twenty fills of the same total size cost
materially different amounts, because each fill pays its own rounding and the
accumulator only partly gives it back. A curve that ignored `fills` would be
smooth, plausible and wrong.

**BOTH ENDS ARE EXCLUDED ON PURPOSE.** A contract at zero or at a dollar is
settled, not quoted. Including them would put two points on the curve where the
fee describes a trade nobody can make — and at zero the fraction of notional is
undefined, which would need a null in the middle of a series that has none.

**EVERY FIGURE IS A STRING.** These are exact fixed-point quantities whose last
places are the finding; a float here would be the one thing this engine refuses
everywhere else.

Written before the implementation, per the slice's RED step.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.api import coherence_lab as lab
from modules.coherence import tunables
from modules.coherence.kernel.costs import FeeSchedule, net_fee
from modules.coherence.kernel.money import parse_fp


def schedule() -> FeeSchedule:
    return FeeSchedule(
        taker_rate=tunables.TAKER_RATE,
        maker_ratio=tunables.MAKER_RATIO,
        balance_precision=tunables.BALANCE_PRECISION,
    )


class TestTheCurve:
    @pytest.mark.asyncio
    async def test_it_covers_every_quoted_price_and_neither_settled_end(self) -> None:
        answer = await lab.coherence_fees_curve(contracts_fp="0.09", fills=3, series=None, _actor="test")

        assert answer.state == "ok"
        assert len(answer.points) == 99
        assert answer.points[0].price == "0.0100"
        assert answer.points[-1].price == "0.9900"
        prices = {point.price for point in answer.points}
        assert "0.0000" not in prices, "a contract at zero is settled, not quoted"
        assert "1.0000" not in prices, "a contract at a dollar is settled, not quoted"

    @pytest.mark.asyncio
    async def test_every_point_is_what_the_kernel_returns(self) -> None:
        # THE WHOLE REASON THIS ROUTE EXISTS. If it drifts from `net_fee` it is
        # a third implementation of the fee, which is what it was built to
        # remove from the browser.
        size = parse_fp("0.09")
        answer = await lab.coherence_fees_curve(contracts_fp="0.09", fills=3, series=None, _actor="test")

        for point in answer.points:
            expected = net_fee(Decimal(point.price), size, schedule(), fills=3)
            assert Decimal(point.trade_fee) == expected.trade_fee, point.price
            assert Decimal(point.rounding_fee) == expected.rounding_fee, point.price
            assert Decimal(point.rebate) == expected.rebate, point.price
            assert Decimal(point.net) == expected.net, point.price

    @pytest.mark.asyncio
    async def test_the_fill_count_changes_the_answer(self) -> None:
        # `fills` is the parameter nobody models, and it is the one this whole
        # section exists to make visible. A curve that ignored it would be
        # smooth, plausible and wrong.
        one = await lab.coherence_fees_curve(contracts_fp="0.09", fills=1, series=None, _actor="test")
        many = await lab.coherence_fees_curve(contracts_fp="0.09", fills=20, series=None, _actor="test")

        nets_one = [point.net for point in one.points]
        nets_many = [point.net for point in many.points]
        assert nets_one != nets_many, "the fill count did not reach the arithmetic"

    @pytest.mark.asyncio
    async def test_the_fraction_of_notional_is_carried_and_never_a_bare_zero(self) -> None:
        answer = await lab.coherence_fees_curve(contracts_fp="0.09", fills=3, series=None, _actor="test")

        # Every quoted price has a notional, so every point has a fraction —
        # the null branch exists for a price of zero, which is excluded.
        assert all(point.as_fraction_of_notional is not None for point in answer.points)
        # And it is a string, like every other figure on this engine.
        assert all(isinstance(point.as_fraction_of_notional, str) for point in answer.points)

    @pytest.mark.asyncio
    async def test_an_unreadable_size_is_reported_rather_than_guessed(self) -> None:
        answer = await lab.coherence_fees_curve(contracts_fp="not-a-size", fills=3, series=None, _actor="test")

        assert answer.state == "unreadable"
        assert answer.points == []
        assert answer.notes, "a refusal that says nothing is indistinguishable from an empty curve"
