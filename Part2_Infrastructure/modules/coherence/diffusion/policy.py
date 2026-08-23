"""The policy rate, read out of the statement that set it.

The covariate every macro desk actually uses, and the one this study was
missing. A rate decision's price impact is driven first by how far the target
range moved and only then by anything about the wording, so a study that
regresses text features on a response without controlling for the move is
attributing to prose what belongs to arithmetic.

It is also the study's POSITIVE CONTROL. An absorption pipeline that cannot
detect "a bigger policy move produces a bigger standardised response" is
measuring noise, and every null result it reports is unfalsifiable. Measured
here on 62 statements, that relationship is t = +3.6 — so when the same
pipeline reports a null for a text feature, the null means something.

PARSING. The Committee has written the same sentence four ways since 2019 and
all four are handled, because the ones that do not parse are not random: the
zero-lower-bound years say "0 to 1/4 percent", with no whole number on the
lower bound, and dropping them would drop the entire pandemic period — the most
violent repricing in the sample. The forms:

    2.25 to 2.5 percent            decimal
    2-1/4 to 2-1/2 percent         whole and fraction, ASCII or non-breaking hyphen
    0 to 1/4 percent               bare fraction on the upper bound
    1 to 1-1/4 percent             mixed

A statement that matches none of them yields `None` rather than a guess. There
is no default rate.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Eighths are enough: the Committee has never set a range on a finer grid.
_FRACTIONS = {"1/8": 0.125, "1/4": 0.25, "3/8": 0.375, "1/2": 0.5,
              "5/8": 0.625, "3/4": 0.75, "7/8": 0.875}

#: Both hyphens. The Fed's own HTML uses U+2011 (non-breaking) as often as
#: the ASCII one, and a parser that knows only ASCII silently loses half the
#: whole-and-fraction years.
_HYPHEN = r"[-‐‑‒–]"

#: One bound: `2.25`, `2-1/4`, `1/4`, or `0`.
_BOUND = rf"(?:(\d+(?:\.\d+)?)\s*{_HYPHEN}?\s*(\d/\d)?|(\d/\d))"

_RANGE = re.compile(
    rf"target range for the federal funds rate\s+(?:[^.]*?\s)?"
    rf"(?:at|to)\s+{_BOUND}\s+to\s+{_BOUND}\s*percent",
    re.I | re.S,
)


@dataclass(frozen=True)
class PolicyRate:
    """The target range a statement set, and its midpoint."""

    lower: float
    upper: float

    @property
    def midpoint(self) -> float:
        return (self.lower + self.upper) / 2.0


def _bound(whole: str | None, fraction: str | None, bare: str | None) -> float | None:
    if bare:
        return _FRACTIONS.get(bare)
    if whole is None:
        return None
    value = float(whole)
    if fraction:
        part = _FRACTIONS.get(fraction)
        if part is None:
            return None
        value += part
    return value


def parse_target_range(text: str) -> PolicyRate | None:
    """The target range this statement set, or None if it did not state one."""
    found = _RANGE.search(text or "")
    if not found:
        return None
    lower = _bound(found.group(1), found.group(2), found.group(3))
    upper = _bound(found.group(4), found.group(5), found.group(6))
    if lower is None or upper is None or upper < lower:
        return None
    return PolicyRate(lower, upper)


def move_basis_points(previous: PolicyRate | None, current: PolicyRate | None) -> float | None:
    """How far the midpoint moved, in basis points. None if either is unknown.

    Signed, because the direction matters to a reader even where the size is
    what predicts the response, and because a study that only ever takes the
    absolute value cannot later ask whether cuts and hikes behave differently.
    """
    if previous is None or current is None:
        return None
    return (current.midpoint - previous.midpoint) * 100.0


def rate_path(statements: list[tuple[str, str]]) -> dict[str, dict[str, float | None]]:
    """Every statement's rate and the move it made, keyed by reference.

    `statements` is `(source_ref, text)` in chronological order. The first
    statement has no predecessor, so its move is `None` rather than zero — an
    unknown move and a hold are different facts.
    """
    out: dict[str, dict[str, float | None]] = {}
    previous: PolicyRate | None = None
    for source_ref, text in statements:
        current = parse_target_range(text)
        out[source_ref] = {
            "lower": None if current is None else current.lower,
            "upper": None if current is None else current.upper,
            "midpoint": None if current is None else current.midpoint,
            "move_bp": move_basis_points(previous, current),
        }
        if current is not None:
            previous = current
    return out
