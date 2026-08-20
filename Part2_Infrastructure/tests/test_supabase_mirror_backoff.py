"""`SupabaseMirror._drain` backs off on the helper's curve, not one beside it.

E1.1 extracted `Backoff` because four hand-rolled versions existed and none was
importable. E1.2 adopted it here — and adopted only half of it. The loop kept
its own `min(backoff.delay_s * 2**attempt, ceiling)` and called `failed()` once
per PAYLOAD rather than per attempt, so:

* the counter `health()` publishes advanced once per message while the loop's
  real sleep advanced per attempt — two backoffs disagreeing about one outage;
* a change to `Backoff`'s curve would not have reached this sleep at all, which
  is precisely what extracting it was supposed to prevent.

Nothing covered the timing, so both were invisible. These assert the SEQUENCE
of sleeps, because that is where the divergence lived.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

from modules.backoff import Backoff
from modules.supabase_mirror import SupabaseMirror


class _Client:
    """Answers with a fixed sequence of statuses, then repeats the last."""

    def __init__(self, statuses: list[int]) -> None:
        self.statuses = statuses
        self.calls = 0

    async def post(self, *_args, **_kwargs):
        status = self.statuses[min(self.calls, len(self.statuses) - 1)]
        self.calls += 1
        if status == 0:
            raise httpx.ConnectError("unreachable")
        return httpx.Response(status, request=httpx.Request("POST", "https://x"))


async def _drain_once(monkeypatch, statuses: list[int], payloads: int = 1) -> list[float]:
    """Run the drain over `payloads` messages, recording every sleep."""
    mirror = SupabaseMirror()
    mirror.enabled = True
    mirror._client = _Client(statuses)  # type: ignore[assignment]
    for i in range(payloads):
        mirror._queue.put_nowait({"gateway_order_id": f"o-{i}"})

    slept: list[float] = []

    async def record(seconds: float) -> None:
        slept.append(round(seconds, 4))
        # The loop is `while True`; ending it from the clock is the only way to
        # observe a bounded run without a timeout in the test.
        if len(slept) >= 12:
            raise asyncio.CancelledError

    monkeypatch.setattr(asyncio, "sleep", record)
    task = asyncio.create_task(mirror._drain())
    try:
        await asyncio.wait_for(task, timeout=5)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        task.cancel()
    return slept


@pytest.mark.asyncio
async def test_the_delay_is_the_helper_s_curve(monkeypatch):
    """base, then 2x, then 4x — `Backoff(1.0, 30.0)` and nothing else."""
    slept = await _drain_once(monkeypatch, [500], payloads=1)
    assert slept[:3] == [2.0, 4.0, 8.0], (
        f"expected the helper's doubling from base 1.0, got {slept[:3]}. A "
        f"hand-rolled curve beside the helper is what this test exists to catch"
    )


@pytest.mark.asyncio
async def test_the_curve_is_the_one_the_helper_would_produce(monkeypatch):
    """Asserted against `Backoff` itself, so the two cannot drift apart."""
    reference = Backoff(base_s=1.0, ceiling_s=30.0)
    expected = [reference.failed() for _ in range(3)]
    slept = await _drain_once(monkeypatch, [500], payloads=1)
    assert slept[:3] == [round(v, 4) for v in expected]


@pytest.mark.asyncio
async def test_it_never_sleeps_past_the_ceiling(monkeypatch):
    """The ceiling is the whole reason the helper exists.

    An uncapped geometric backoff on a long outage stops retrying in any useful
    sense without ever saying so.
    """
    slept = await _drain_once(monkeypatch, [500], payloads=6)
    assert slept, "nothing slept"
    assert max(slept) <= 30.0, f"slept past the 30 s ceiling: {max(slept)}"


@pytest.mark.asyncio
async def test_a_success_resets_the_curve(monkeypatch):
    """A loop that stays slow after recovering is still reporting an outage.

    Two failures, then a success, then a failure: the delay after the success
    must be the base again rather than continuing to double.
    """
    slept = await _drain_once(monkeypatch, [500, 500, 200, 500], payloads=2)
    assert slept[0] == 2.0 and slept[1] == 4.0
    # The third attempt succeeds and breaks; the next payload's first failure
    # starts from base again.
    assert 2.0 in slept[2:], f"the curve did not reset after a success: {slept}"


@pytest.mark.asyncio
async def test_a_transport_error_backs_off_like_a_rejection(monkeypatch):
    """Unreachable and refused are different diagnoses, not different waits."""
    slept = await _drain_once(monkeypatch, [0], payloads=1)
    assert slept[:2] == [2.0, 4.0]
