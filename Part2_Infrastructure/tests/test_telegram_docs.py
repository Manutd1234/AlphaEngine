"""The docs move with the registry, or CI fails — the house's anti-drift rule.

The command count drifted three times: README §6 said "eighty-one", the live
checklist said "all 81 commands", and `COMMAND_SPECS` had grown past ninety.
`tools/telegram_catalogue.py` generates the §6 tables and the counts from the
one registry that also drives dispatch, and this file is the ratchet: it runs
that tool's own `--check` inside the suite, so a new command that is not
reflected in the docs turns the tests red rather than shipping a stale table.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from modules.telegram import BOT_DESCRIPTION, COMMAND_SPECS, help_text

ROOT = Path(__file__).resolve().parent.parent


def _load_catalogue_tool():
    """Import the generator by path — `tools/` is not an importable package."""
    spec = importlib.util.spec_from_file_location(
        "telegram_catalogue", ROOT / "tools" / "telegram_catalogue.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_readme_and_checklist_are_in_sync_with_the_registry():
    """The generator's own --check, run in the suite: stale docs fail CI."""
    tool = _load_catalogue_tool()
    assert tool.main(["--check"]) == 0, (
        "README.md or docs/telegram-live-checklist.md have drifted from "
        "COMMAND_SPECS — run `tools/telegram_catalogue.py --write`."
    )


def test_readme_contains_the_generated_block_verbatim():
    """The catalogue block in README equals what the tool would generate."""
    tool = _load_catalogue_tool()
    block = tool.render_catalogue()
    readme = (ROOT / "README.md").read_text()
    assert block in readme, "the README catalogue block is not the generated output"
    # And every category the registry has is a heading inside that block.
    for category in {spec.category for spec in COMMAND_SPECS}:
        assert f"#### {category}" in block


def test_checklist_states_the_current_command_count():
    total = len(COMMAND_SPECS)
    checklist = (ROOT / "docs" / "telegram-live-checklist.md").read_text()
    assert f"all {total} commands" in checklist, (
        f"the checklist should say 'all {total} commands'"
    )


def test_help_and_description_name_five_controls_and_never_say_text_only():
    """`text_only` was retired from the health contract; the prose must agree."""
    controls = [spec.name for spec in COMMAND_SPECS if spec.category == "Controls"]
    assert len(controls) == 5, "there must be exactly five gated controls"
    for surface in (help_text(), BOT_DESCRIPTION):
        assert "TEXT ONLY" not in surface.upper(), (
            "the companion sends charts and buttons — it is not text-only"
        )
        for name in controls:
            assert f"/{name}" in surface, f"/{name} must be named in the companion's own description"
