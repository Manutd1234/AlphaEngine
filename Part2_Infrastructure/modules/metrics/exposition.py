"""The 0.0.4 text exposition primitives: escaping, coercion, the line writer.

Split out of ``modules/metrics.py`` so the formatting rules live apart from the
state accessors that feed them. Nothing here reaches into the gateway; every
function is total on its arguments, which is what makes the honesty rule below
testable in isolation.

The rule that matters: ``_num`` returns ``None`` for an absent reading and
``_Writer.metric`` skips the line entirely rather than emitting a zero. A
fabricated zero is indistinguishable from a measured one and poisons every
average downstream.
"""

from __future__ import annotations

from typing import Any, Iterable

PREFIX = "alphaengine"

#: Job states that always get a series, so ``alphaengine_jobs{status="failed"}``
#: exists (at 0) before the first failure rather than appearing with it.
_JOB_STATES = ("queued", "running", "succeeded", "failed")


def _escape_label(value: Any) -> str:
    """Escape a label *value* per the exposition format (backslash, quote, newline)."""
    text = str(value)
    return text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(pairs: Iterable[tuple[str, Any]]) -> str:
    rendered = ",".join(f'{k}="{_escape_label(v)}"' for k, v in pairs if v is not None)
    return f"{{{rendered}}}" if rendered else ""


def _num(value: Any) -> float | None:
    """Coerce to a finite float, or ``None`` when the sample does not exist.

    An absent reading (a book that has never updated, a latency with no
    samples) is skipped rather than exported as 0 — a fabricated zero would be
    indistinguishable from a real one and would quietly poison an average.
    """
    if isinstance(value, bool):
        return float(value)
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out or out in (float("inf"), float("-inf")):  # NaN / ±Inf
        return None
    return out


class _Writer:
    """Accumulates exposition lines, emitting each HELP/TYPE header once."""

    def __init__(self) -> None:
        self._lines: list[str] = []
        self._declared: set[str] = set()

    def metric(
        self,
        name: str,
        value: Any,
        *,
        help: str = "",
        type: str = "gauge",
        labels: Iterable[tuple[str, Any]] = (),
    ) -> None:
        number = _num(value)
        if number is None:
            return
        full = f"{PREFIX}_{name}"
        if full not in self._declared:
            self._declared.add(full)
            if help:
                self._lines.append(f"# HELP {full} {help}")
            self._lines.append(f"# TYPE {full} {type}")
        rendered = f"{number:.6f}".rstrip("0").rstrip(".") if number % 1 else f"{number:.0f}"
        self._lines.append(f"{full}{_labels(labels)} {rendered}")

    def render(self) -> str:
        return "\n".join(self._lines) + "\n"
