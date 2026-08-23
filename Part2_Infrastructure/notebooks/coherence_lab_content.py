"""The coherence lab's cell content, in one mapping.

``build_coherence_lab.py`` is mechanical: it reads the lessons out of
``web/lib/coherence/lessons.ts`` — the same catalogue the web tab renders — and
turns each one into a notebook. Everything that is specific to a lesson lives
here instead, so the generator never has to know what a lesson is about.

The per-lesson sections are split across seven sibling modules because of the
400-line ceiling ``tests/test_file_size.py`` enforces. This module is where they
come back together, and where a lesson with no content becomes an error rather
than an empty notebook.

``SETUP`` is the one cell every notebook shares. It walks upward from the
working directory to find the package root, so the notebook runs whether it is
opened from ``notebooks/coherence_lab/`` or executed from
``Part2_Infrastructure``, and it fails with a sentence rather than an
``ImportError`` when it is run from somewhere else entirely.
"""

from __future__ import annotations

from notebooks.coherence_lab_lessons_book import BOOK_SIDE
from notebooks.coherence_lab_lessons_cost import COST_SIDE
from notebooks.coherence_lab_lessons_family import FAMILY_SIDE
from notebooks.coherence_lab_lessons_measure import MEASURE_SIDE
from notebooks.coherence_lab_lessons_record import RECORD_SIDE
from notebooks.coherence_lab_lessons_score import SCORE_SIDE
from notebooks.coherence_lab_lessons_solver import SOLVER_SIDE

#: One entry per lesson id in ``COHERENCE_LESSONS``, each a tuple of
#: ``(markdown heading, code)`` sections rendered in order after the setup cell.
SECTIONS: dict[str, tuple[tuple[str, str], ...]] = {
    **BOOK_SIDE,
    **FAMILY_SIDE,
    **COST_SIDE,
    **SOLVER_SIDE,
    **RECORD_SIDE,
    **MEASURE_SIDE,
    **SCORE_SIDE,
}

SETUP = """
import json
import sys
from decimal import Decimal
from pathlib import Path

# This notebook lives in notebooks/coherence_lab/ and imports the kernel two
# levels up. Found by walking upward rather than by counting parents, so the
# notebook runs from its own directory or from Part2_Infrastructure.
HERE = Path.cwd().resolve()
ROOT = next((path for path in (HERE, *HERE.parents) if (path / "modules" / "coherence" / "kernel").is_dir()), None)
if ROOT is None:
    raise SystemExit(f"no coherence kernel above {HERE}: open this notebook from inside Part2_Infrastructure")
sys.path.insert(0, str(ROOT))

FIXTURES = ROOT / "tests" / "fixtures" / "coherence"


def fixture(name: str) -> dict:
    \"\"\"One recorded Kalshi response, envelope and all, exactly as it was sent.

    These are captures, not mocks. Where a number below looks odd it is because
    the exchange quoted it, and `tools/capture_kalshi_fixtures.py` re-records
    them.
    \"\"\"
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


print(f"kernel root       {ROOT}")
print(f"recorded fixtures {FIXTURES.is_dir()}")
"""


def sections_for(lesson_id: str) -> tuple[tuple[str, str], ...]:
    """The sections of one lesson, or a loud failure.

    A lesson in the catalogue with no content here would otherwise generate a
    notebook that is all prose and no code — which is the one thing this lab is
    not allowed to be.
    """
    try:
        return SECTIONS[lesson_id]
    except KeyError:
        raise SystemExit(
            f"lesson {lesson_id!r} is in web/lib/coherence/lessons.ts but has no cells here; "
            "add them to one of the notebooks/coherence_lab_lessons_*.py modules"
        ) from None
