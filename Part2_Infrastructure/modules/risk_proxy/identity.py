"""Order identity — sixteen hex characters, drawn a block at a time."""

from __future__ import annotations

import os


class _OrderIdPool:
    """Sixteen lowercase hex characters, drawn a block at a time.

    Exactly the shape ``uuid.uuid4().hex[:16]`` produced, because that string
    reaches the audit log, the working-order dict, the Supabase mirror and the
    Telegram ``/order`` lookup, and none of them may notice this changed.

    What changed is the cost. ``uuid4()`` was ~1.5 µs of every decision — an
    ``os.urandom(16)`` syscall, a ``UUID`` object and a 32-character hex string,
    of which sixteen characters were kept and the rest thrown away. One
    ``os.urandom`` block per 256 orders amortises to ~0.2 µs and is, if
    anything, *more* random than what it replaces: ``uuid4().hex[:16]`` carries
    sixty random bits and a constant version nibble at index 12; these carry
    sixty-four.

    Deliberately not a counter. Order ids reach a durable audit log that
    outlives the process, and ``_restore_positions_from_audit`` refuses to
    replay two accepted fills that share one. A per-process counter would have
    to be seeded from something that survives a restart to keep that promise;
    random draws keep it without being told.
    """

    __slots__ = ("_batch", "_block", "_index")

    def __init__(self, batch: int = 256) -> None:
        self._batch = batch
        self._block: list[str] = []
        self._index = 0

    def next(self) -> str:
        index = self._index
        block = self._block
        if index >= len(block):
            raw = os.urandom(8 * self._batch).hex()
            block = self._block = [raw[i : i + 16] for i in range(0, len(raw), 16)]
            index = 0
        self._index = index + 1
        return block[index]

_order_ids = _OrderIdPool()
