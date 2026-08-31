#!/usr/bin/env python3
"""
Regenerate the Telegram command catalogue in the docs from `COMMAND_SPECS`.

The command count drifted three times before this tool existed: the README §6
prose said "eighty-one commands", the live checklist said "all 81 commands", and
the registry had ninety-four. A number nobody updates is worse than no number,
because it keeps looking authoritative. So the tables and the counts are no
longer hand-maintained — they are generated here, from the one registry that
also drives dispatch, help and the pushed menu.

    python tools/telegram_catalogue.py            # print the generated block
    python tools/telegram_catalogue.py --write    # rewrite README + checklist
    python tools/telegram_catalogue.py --check     # exit 1 if either is stale

`--write` rewrites three things, and `--check` fails when any of them drift:

* the command tables between the markers
  `<!-- telegram-catalogue:start -->` / `<!-- telegram-catalogue:end -->` in
  README §6, one table per registry category, in registry order;
* the three counts in the §6 intro sentence — total commands, gated controls,
  and the pushed-menu subset;
* the "all N commands" line in `docs/telegram-live-checklist.md`.

`tests/test_telegram_docs.py` runs `--check`, so a new command that is not
reflected in the docs turns the suite red rather than shipping a stale table.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Import the registry without booting market data or a bot token, the same way
# every other offline tool here does.
os.environ.setdefault("ENABLE_MARKET_DATA", "0")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "")

README = ROOT / "README.md"
CHECKLIST = ROOT / "docs" / "telegram-live-checklist.md"
START = "<!-- telegram-catalogue:start -->"
END = "<!-- telegram-catalogue:end -->"


def _counts() -> tuple[int, int, int]:
    from modules.telegram import COMMAND_SPECS

    total = len(COMMAND_SPECS)
    menu = sum(1 for spec in COMMAND_SPECS if spec.in_menu)
    controls = sum(1 for spec in COMMAND_SPECS if spec.category == "Controls")
    return total, menu, controls


def _escape_cell(text: str) -> str:
    # A pipe inside a usage string (``[ew|iv|erc|mv]``) would start a new table
    # column, so it is escaped exactly as the hand-written tables did.
    return text.replace("|", r"\|")


def render_catalogue() -> str:
    """One markdown table per category, in first-seen registry order."""
    from collections import OrderedDict

    from modules.telegram import COMMAND_SPECS

    categories = list(OrderedDict.fromkeys(spec.category for spec in COMMAND_SPECS))
    lines = [START, ""]
    for category in categories:
        specs = [spec for spec in COMMAND_SPECS if spec.category == category]
        lines += [f"#### {category}", "", "| Command | Purpose |", "|---|---|"]
        for spec in specs:
            # The description is "<label> · <purpose>"; the table wants the
            # purpose, which is what a reader is choosing between.
            purpose = spec.description.split("·", 1)[-1].strip()
            lines.append(f"| `{_escape_cell(spec.usage)}` | {_escape_cell(purpose)} |")
        lines.append("")
    lines.append(END)
    return "\n".join(lines)


def _apply_readme(text: str) -> str:
    total, menu, controls = _counts()

    block = render_catalogue()
    marker = re.compile(re.escape(START) + r".*?" + re.escape(END), re.DOTALL)
    if not marker.search(text):
        raise SystemExit(
            "README.md is missing the telegram-catalogue markers "
            f"({START} / {END}) — add them around the §6 command tables."
        )
    text = marker.sub(lambda _match: block, text)

    # The three intro counts, each anchored to unambiguous surrounding words.
    text = re.sub(r"registers \*\*\d+ commands\*\*", f"registers **{total} commands**", text)
    text = re.sub(r"(; )\*\*\d+\*\*( of them change)", rf"\g<1>**{controls}**\g<2>", text)
    text = re.sub(r"(and )\*\*\d+\*\*( are pushed)", rf"\g<1>**{menu}**\g<2>", text)
    engine_link_claim = (
        "It does not render or scrape a web page, and it cannot open a\n"
        "position. When `WEB_WORKSPACE_URL` is configured, the three engine cards may\n"
        "carry an HTTPS link to the equivalent read-only view; the values still come\n"
        "from gateway domain read models."
    )
    text = text.replace(
        "It does not render a web page or send web links, and it cannot\nopen a position.",
        engine_link_claim,
    )
    text = text.replace(
        "It does not render or scrape a web page, and it cannot open a position. When\n"
        "`WEB_WORKSPACE_URL` is configured, the three engine cards may carry an HTTPS link to\n"
        "the equivalent read-only view; the values still come from gateway domain read models.",
        engine_link_claim,
    )
    return text


def _apply_checklist(text: str) -> str:
    total, _menu, _controls = _counts()
    return re.sub(r"dispatches all \d+ commands", f"dispatches all {total} commands", text)


def main(argv: list[str]) -> int:
    check = "--check" in argv
    write = "--write" in argv
    if not (check or write):
        print(render_catalogue())
        return 0

    readme = README.read_text()
    checklist = CHECKLIST.read_text()
    new_readme = _apply_readme(readme)
    new_checklist = _apply_checklist(checklist)

    if check:
        drift = []
        if new_readme != readme:
            drift.append("README.md")
        if new_checklist != checklist:
            drift.append("docs/telegram-live-checklist.md")
        if drift:
            print(
                "out of date: " + ", ".join(drift) + " — run tools/telegram_catalogue.py --write",
                file=sys.stderr,
            )
            return 1
        print("telegram catalogue is in sync with COMMAND_SPECS")
        return 0

    README.write_text(new_readme)
    CHECKLIST.write_text(new_checklist)
    total, menu, controls = _counts()
    print(f"wrote README.md and docs/telegram-live-checklist.md ({total} commands, {menu} in menu, {controls} controls)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
