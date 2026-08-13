"""The desk stream's four properties, rehoused on the side that owns them.

These were asserted from the web repo, by a test that read `main.py` as text
because it was really testing the browser hook in front of it. That hook and its
proxy have been deleted — `EventSource` exposes neither the status code nor the
body, so the proxy's deliberate 503 on a gateway-less deployment was invisible
to the client and the panel read "connecting" forever, on precisely the
deployment where having no gateway is the normal condition.

The endpoint itself is correct and stays. But its invariants were only ever
checked from the consumer's side, so deleting the consumer would have deleted
the coverage silently — which is the expensive half of removing dead code.

Each property below is one a stream gets wrong in a way that looks fine in
development and fails in production, where a proxy sits in the path.
"""

from __future__ import annotations

import inspect
import re

import main


def _stream_source() -> str:
    return inspect.getsource(main.stream_desk)


def test_emits_only_when_the_payload_changes() -> None:
    """
    A tick is not an event.

    The monitor runs on a timer, so an unconditional yield would push an
    identical frame every interval — turning a status feed into a metronome and
    making "something changed" indistinguishable from "the clock moved".
    """
    source = _stream_source()
    assert "last_body" in source
    assert re.search(r"if\s+body\s*!=\s*last_body", source), (
        "the stream stopped comparing against the previous payload"
    )


def test_heartbeat_is_an_sse_comment() -> None:
    """
    `: ping` and not a data frame.

    A comment keeps the connection and any intermediary alive without reaching
    the consumer's message handler. A data-shaped heartbeat would have to be
    filtered by every reader, and the one that forgets renders a keepalive as a
    desk update.
    """
    assert ": ping" in _stream_source(), "the heartbeat stopped being an SSE comment"


def test_buffering_is_disabled_for_the_proxy_in_front() -> None:
    """
    `X-Accel-Buffering: no`.

    nginx — and the Caddy sidecar's upstream behaviour — will buffer a response
    body by default, which holds frames until the buffer fills. The stream then
    works perfectly against the gateway directly and appears frozen through the
    proxy, which is the hardest version of this bug to find.
    """
    source = _stream_source()
    assert "X-Accel-Buffering" in source
    assert re.search(r"X-Accel-Buffering[\"']\s*:\s*[\"']no", source)


def test_cadence_follows_the_monitor_rather_than_a_literal() -> None:
    """
    The stream must not out-run or lag the thing it reports.

    Reading `risk_monitor_interval_s` means one setting moves both; a hardcoded
    interval here would drift from the monitor the first time that value is
    tuned, and the drift would show up as staleness nobody could account for.
    """
    source = _stream_source()
    assert "risk_monitor_interval_s" in source, "the stream hardcoded its own cadence"
    assert re.search(r"max\(\s*0\.1\s*,", source), (
        "a zero or negative interval would spin the loop"
    )


def test_content_type_is_the_sse_media_type() -> None:
    """`text/event-stream`, or no browser treats it as a stream at all."""
    assert 'media_type="text/event-stream"' in _stream_source()
