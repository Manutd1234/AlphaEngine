"""The three refusals in ``tests/conftest.py``, pinned to ASSIGNMENT.

``tests/conftest.py`` blanks environment variables by two different mechanisms
and the difference is a policy, not a style:

* ``os.environ.setdefault("SUPABASE_URL", "")`` is CONSENT. It beats a
  developer's ``.env`` and loses to an exported variable, which is exactly what
  keeps ``tests/test_data_ops_postgrest.py``'s live Postgres pass opt-in-able.
* ``os.environ["GEMINI_API_KEY"] = ""`` is REFUSAL. It beats both, because the
  thing being refused — spending live model quota, loading ~110M re-ranker
  parameters, loading a ~0.6 GB CLIP pair — is something no run should be able
  to opt into by accident.

Nothing in the suite noticed the difference until it was gone. That is the
whole reason this file exists: a future edit that "tidies" the three refusals
into the ``setdefault`` block above them changes no test's assertions, passes
2,000-odd tests on any machine where the variables happen to be unset, and
silently reopens all three holes on the machines where they are not. The hole
this file was written to close was of exactly that shape and it stayed open for
a release: ``RESEARCH_IMAGE_MODEL_PATH`` was documented as owed in
``modules/research_image.py``, in ``docs/testing/TESTING.md`` and in
``README.md``, and worked around by an autouse fixture in each of the image
suites — which protected those four files and nothing else.

SOURCE-PARSED, NOT GREPPED, and following ``tests/test_supabase_schema.py``'s
shape: an AST walk sees the statement however it is formatted, and — the part a
grep for ``RESEARCH_IMAGE_MODEL_PATH`` cannot do — tells an assignment from a
``setdefault`` from a mention inside a comment. This file's comments name all
three variables themselves, so a text search would find them here and be
satisfied.

RUNTIME-CHECKED AS WELL. Reading the source proves the line is written; reading
``os.environ`` proves it RAN, which is the property the suite actually depends
on and the one that would break if the block were moved below an import that
reads it, or into a fixture. Both halves are here because each catches a
failure the other cannot.
"""

from __future__ import annotations

import ast
import os
from pathlib import Path

import pytest

from modules import research_image

CONFTEST = Path(__file__).resolve().parent / "conftest.py"
CONFTEST_SOURCE = CONFTEST.read_text()
CONFTEST_TREE = ast.parse(CONFTEST_SOURCE)

IMAGE_MODULE = Path(research_image.__file__)

#: The refusal group. Every one of these turns a developer's exported variable
#: into something the suite would otherwise DO: spend money, or read hundreds of
#: megabytes of weights off disk inside a suite that claims to need neither.
REFUSALS = ("GEMINI_API_KEY", "RERANK_MODEL_PATH", "RESEARCH_IMAGE_MODEL_PATH")

#: The consent group, asserted here for a reason that is not symmetry: a scan
#: that had gone blind — matching every module-level statement as an assignment,
#: say — would pass every assertion about REFUSALS while proving nothing. These
#: names are the control that makes the scan's answer worth reading, because a
#: broken scan cannot put the two groups in different buckets.
CONSENTS = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEO4J_URI", "NEO4J_PASSWORD")


def _is_os_environ(node: ast.expr) -> bool:
    """``os.environ``, as written. Not ``environ`` imported bare, which nothing
    in this conftest does and which would be a different statement to review."""
    return (
        isinstance(node, ast.Attribute)
        and node.attr == "environ"
        and isinstance(node.value, ast.Name)
        and node.value.id == "os"
    )


def assigned_blanks() -> dict[str, str]:
    """``{name: value}`` for every module-level ``os.environ["NAME"] = "..."``.

    ``CONFTEST_TREE.body`` and not ``ast.walk``, deliberately. The property
    being pinned is not "the string appears somewhere in the file" but "this
    runs at import, before any test module imports ``config`` or
    ``modules.research_image``". An identical assignment moved inside a fixture
    would still be found by a walk and would be too late for
    ``research_image.IMAGE_MODEL_PATH``, which is read off ``os.environ`` in a
    module-level assignment — so the walk would report the hole as closed on the
    exact edit that reopens it.
    """
    found: dict[str, str] = {}
    for node in CONFTEST_TREE.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if (
            isinstance(target, ast.Subscript)
            and _is_os_environ(target.value)
            and isinstance(target.slice, ast.Constant)
            and isinstance(target.slice.value, str)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            found[target.slice.value] = node.value.value
    return found


def setdefaulted() -> set[str]:
    """Every name handed to ``os.environ.setdefault`` ANYWHERE in the conftest.

    ``ast.walk`` here, unlike above, and for the mirror-image reason: this set is
    used to prove a name is NOT in it, so the widest possible reading is the
    honest one. A ``setdefault`` hidden inside a fixture would still be a
    demotion, and this is the only lens that sees it.
    """
    found: set[str] = set()
    for node in ast.walk(CONFTEST_TREE):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "setdefault"
            and _is_os_environ(node.func.value)
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            found.add(node.args[0].value)
    return found


class TestTheScanReadsSomethingWorthScanning:
    """The failure mode this codebase has hit nine times: a source scan whose
    subject moved does not fail, it passes having read an empty string."""

    def test_both_mechanisms_are_actually_found(self) -> None:
        assert len(CONFTEST_SOURCE) > 1000, f"{CONFTEST} is not the file this test means"
        assert len(assigned_blanks()) >= 3, (
            f"the assignment scan harvested {sorted(assigned_blanks())} — if the "
            "conftest still blanks by assignment, this scan has gone blind"
        )
        assert len(setdefaulted()) >= 4, (
            f"the setdefault scan harvested {sorted(setdefaulted())}, which is too few "
            "for the four explicitly opt-in Supabase/Neo4j variables"
        )

    def test_the_two_scans_disagree_about_every_name(self) -> None:
        # Not decoration. If a bug made one harvest a superset of the other,
        # every assertion below could pass while measuring one mechanism twice.
        assert set(assigned_blanks()) & setdefaulted() == set(), (
            "a name is both assigned and setdefault-ed — whichever runs second wins, "
            "and reading which one that is off the file is exactly what this suite "
            "exists to stop anyone having to do"
        )


class TestTheThreeRefusalsAreAssignments:
    """The one-way ratchet. These may be added to; none may be demoted."""

    @pytest.mark.parametrize("name", REFUSALS)
    def test_it_is_blanked_by_assignment_at_import(self, name: str) -> None:
        blanks = assigned_blanks()
        assert name in blanks, (
            f"tests/conftest.py must blank {name} with `os.environ[{name!r}] = \"\"` at "
            "module level. `setdefault` beats only a .env and LOSES to an exported "
            "variable, which is the case that spends live quota or loads weights: "
            "GEMINI_API_KEY a real model call per test in test_research_answer.py, "
            "RERANK_MODEL_PATH ~110M parameters, RESEARCH_IMAGE_MODEL_PATH a ~0.6 GB "
            "CLIP pair through every suite that drives /api/research/rag/search"
        )
        assert blanks[name] == "", (
            f"{name} is assigned {blanks[name]!r} rather than the empty string; every "
            "reader of these treats empty as 'not configured' and anything else as a "
            "path or a key it should try to use"
        )

    @pytest.mark.parametrize("name", REFUSALS)
    def test_it_is_not_demoted_to_setdefault(self, name: str) -> None:
        assert name not in setdefaulted(), (
            f"{name} moved into the setdefault group. That group is consent — it is "
            "how test_data_ops_postgrest.py stays opt-in — and this variable is "
            "refusal: nothing in this suite wants the real thing, so there is no "
            "opt-in to preserve and no reason to lose to an exported value"
        )

    @pytest.mark.parametrize("name", CONSENTS)
    def test_the_consent_group_is_still_consent(self, name: str) -> None:
        # The control described at the top of the file. It also guards the other
        # direction of the same tidy: promoting these to assignment would take
        # away the deliberate live-Postgres opt-in without anyone saying so.
        assert name in setdefaulted(), f"{name} is no longer a setdefault"
        assert name not in assigned_blanks()


class TestTheAssignmentsActuallyRan:
    """Source is a claim; ``os.environ`` is the measurement."""

    @pytest.mark.parametrize("name", REFUSALS)
    def test_the_variable_is_empty_in_this_process(self, name: str) -> None:
        assert os.environ.get(name) == "", (
            f"{name} is {os.environ.get(name)!r} in a running test — the conftest line "
            "either did not run or ran after something restored it"
        )

    def test_the_image_arm_reads_that_blank_and_reports_itself_off(self) -> None:
        """The end of the chain, which is the only part a user would notice.

        ``research_image.IMAGE_MODEL_PATH`` is the constant every caller gates
        on, and this file installs no fixture — no ``monkeypatch``, no autouse —
        so the value asserted here is the one the conftest produced, reached
        through a real import of the module rather than through a patch of it.
        That is what makes this an assertion about the RUN rather than about
        this file: before the conftest line existed, a shell exporting a seeded
        directory made this assertion false here and everywhere else.
        """
        assert research_image.IMAGE_MODEL_PATH == ""
        assert research_image.configured() is False


class TestTheHoleWasReal:
    """Why the mechanism matters, demonstrated rather than asserted about.

    The two statements are one character apart in intent and behave in opposite
    ways against the case that matters. Exercised on a throwaway variable so the
    demonstration cannot itself change the suite's environment, and restored by
    ``monkeypatch`` either way.
    """

    NAME = "RESEARCH_IMAGE_MODEL_PATH_DEMO_NOT_READ_BY_ANY_MODULE"
    SEEDED = "/Users/somebody/models/clip-ViT-B-32"

    def test_setdefault_leaves_an_exported_path_in_place(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # An EXPORTED variable is already in os.environ by the time the conftest
        # runs, so setdefault finds a value and returns it untouched. This is
        # the state the image arm was in: every image suite's autouse fixture
        # cleared the constant for its own file, and any other suite reaching
        # research_image through search saw this path.
        monkeypatch.setenv(self.NAME, self.SEEDED)
        os.environ.setdefault(self.NAME, "")
        assert os.environ[self.NAME] == self.SEEDED

    def test_assignment_overwrites_it(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(self.NAME, self.SEEDED)
        os.environ[self.NAME] = ""
        assert os.environ[self.NAME] == ""


class TestWhyAPerFileFixtureCouldNotHaveDoneThis:
    """The timing argument the conftest comment makes, pinned to the source.

    ``research_image`` reads the variable in a module-level assignment, so the
    value is fixed at IMPORT — the first time any test module imports the
    package, which for a full run is whichever file pytest collected first. A
    fixture in the image suites therefore cannot protect any other file: by the
    time it runs, the constant it would have blanked has already been read. If
    this ever became a lazy read inside a function, the conftest line would stop
    being the load-bearing one and this test should be rewritten rather than
    deleted.
    """

    def test_the_constant_is_read_at_module_level(self) -> None:
        source = IMAGE_MODULE.read_text()
        reads: list[str] = []
        for node in ast.parse(source).body:
            if isinstance(node, ast.Assign) and "RESEARCH_IMAGE_MODEL_PATH" in ast.unparse(node):
                reads.append(ast.unparse(node))
        assert len(reads) == 1, (
            f"expected exactly one module-level read of the variable in {IMAGE_MODULE.name}, "
            f"found {reads}"
        )
        assert reads[0].startswith("IMAGE_MODEL_PATH = "), reads[0]
        assert "os.environ" in reads[0]
