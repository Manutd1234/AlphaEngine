"""The bench that measures the image arm, tested WITHOUT downloading a model.

``tools/bench_image_retrieval.py`` answers the question
``modules/research_image.py`` left open — whether CLIP over chart pixels beats
the sentence ``research_chartdoc`` renders from the numbers the desk computed.
The answer is only worth having if the harness is trustworthy, so this suite
pins the two things that could make it lie:

THE ANSWER KEY MUST BE TRUE. Every "the one with the deep drawdown" is a claim
about a generated series, and a claim is testable. So the ground truth is
ASSERTED here rather than assumed by the tool: the monotonic riser really has no
losing bar, the deep-drawdown case really loses half its value, the plateau
really is exactly flat, and the deep drawdown is really deeper than the volatile
case by a margin that stops the two answering each other's questions.

THE ANSWER KEY MUST NOT BE INSIDE THE DOCUMENTS. The first version of the corpus
used each case's own slug as the ``job_id``, and ``render_backtest_card`` prints
``Job:`` and ``Data hash:`` into the body it embeds — so two run cards carried
the literal strings "broad_plateau" and "isolated_peak", which are the words of
the two queries only a picture should be able to answer. The description arm
scored top on both by reading the label. That regression has a test now, because
it produced a plausible table and a wrong conclusion, which is the failure this
whole codebase is organised against.

AND THE METRICS MUST MATCH THE OTHER HARNESS. ``web/lib/retrieval-eval.ts``
holds the same four functions for the TypeScript side. Two implementations that
disagree about what nDCG@k means are worse than one, because the disagreement is
invisible until somebody quotes both in a sentence. The values below are
computed by hand from the TS definitions, not from this Python.

NOTHING HERE LOADS A MODEL. ``fastembed`` is an optional extra, the CLIP pair is
~0.6 GB and CI is network-free by construction. ``tests/conftest.py`` now blanks
``RESEARCH_IMAGE_MODEL_PATH`` by assignment beside ``RERANK_MODEL_PATH``, so a
developer whose shell exports a seeded directory can no longer make ANY suite
read 0.6 GB off disk — the fixture below used to be the only thing standing
between this file and that, and is kept for a second, narrower job it is still
the only thing doing. See its docstring. Seeding weights is ``--seed``'s job and
it is a build step, never a test.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from modules import research_image
from modules.research_bm25 import RRF_K
from modules.research_image_ingest import CHART_PNG_FIELDS
from tools import bench_image_retrieval as bench
from tools import bench_image_retrieval_series as series
from tools.bench_image_retrieval_corpus import QUERIES, SWEEPS, build_corpus
from tools.bench_image_retrieval_metrics import (
    cosine_ranking,
    ndcg_at,
    recall_at,
    reciprocal_rank,
    reciprocal_rank_fusion,
    score_configurations,
)


@pytest.fixture(autouse=True)
def _no_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """No suite in this tree may reach a real CLIP directory. See the docstring.

    KEPT after ``tests/conftest.py`` took over the blanking, because the two do
    different jobs and only one of them is now redundant. The conftest assigns
    ``""`` ONCE, at import, which is the right moment for a variable that is only
    ever read at import — and is therefore no defence against a test that writes
    the variable DURING the run. The code under test does exactly that:
    ``tools/bench_image_retrieval_models.load_image_arm`` assigns
    ``os.environ["RESEARCH_IMAGE_MODEL_PATH"] = model_path`` before its first
    import, deliberately, and ``TestDegradesWithAReason`` drives it through
    ``bench.main()`` with a ``--model-path`` that does not exist. Without
    ``monkeypatch.setenv`` here, that path would outlive the test and be read by
    whatever ran next — this file's own later tests first, and then, since
    ``os.environ`` is process-wide, anything in the session that re-reads it. So
    this is a per-test RESTORE, which is the one thing a module-level assignment
    structurally cannot be; ``tests/test_research_image_env_policy.py`` pins the
    conftest half. Measured rather than assumed: calling ``bench.main()`` with
    ``--model-path /tmp/never-seeded-clip`` outside pytest returns 0, prints
    "nothing measured", and leaves ``RESEARCH_IMAGE_MODEL_PATH`` set to that
    path in the interpreter's environment.

    ``setattr`` on the constant stays for the same reason at the other end of
    the chain: ``load_image_arm`` assigns ``ri.IMAGE_MODEL_PATH`` too, so
    blanking the environment alone would leave the module configured.
    """
    monkeypatch.setenv("RESEARCH_IMAGE_MODEL_PATH", "")
    monkeypatch.setattr(research_image, "IMAGE_MODEL_PATH", "")


@pytest.fixture(scope="module")
def corpus():
    cases, reason = build_corpus()
    assert reason is None, reason
    return cases


def _draw(builder):
    """One builder's series, from a fresh generator.

    Fresh rather than shared, because ``build_corpus`` draws all seven sweeps
    from one stream and a test that depended on the ORDER of those draws would
    fail the day a sweep is added — which is exactly the kind of test that
    teaches people to delete tests.
    """
    returns, position = builder(np.random.default_rng(series.SEED))
    return returns, position, np.cumprod(1.0 + returns)


def _max_drawdown(equity: np.ndarray) -> float:
    return float(np.min(equity / np.maximum.accumulate(equity) - 1.0))


# --------------------------------------------------------------------------- #
# The answer key is true
# --------------------------------------------------------------------------- #
class TestGroundTruth:
    """Every designed property, asserted against the series actually drawn."""

    def test_the_riser_never_falls(self) -> None:
        # MONOTONE, not "mostly up". This is the property that makes query 2 an
        # instruction rather than an impression, and it is the reason that
        # curve's Sharpe is a number no desk has ever seen.
        returns, _position, equity = _draw(series.riser)
        assert returns.min() >= 0.0
        assert _max_drawdown(equity) == 0.0
        assert equity[-1] > 2.0

    def test_the_plateau_is_exactly_flat(self) -> None:
        # ``research_image.py`` argues the arm's whole reason for existing with
        # this pair: the same terminal multiple as the riser, reached by a spike
        # and a long flat plateau. Both halves are checked, because the pair is
        # only evidence if the descriptions really do nearly coincide.
        _returns, _position, riser = _draw(series.riser)
        returns, position, equity = _draw(series.spike_plateau)
        assert np.all(returns[100:] == 0.0)
        assert np.all(position[100:] == 0.0)
        assert equity[-1] > 2.0
        assert abs(equity[-1] - riser[-1]) < 0.2

    def test_the_deep_drawdown_loses_half(self) -> None:
        _returns, _position, equity = _draw(series.deep_drawdown)
        assert _max_drawdown(equity) < -0.45

    def test_the_volatile_case_cannot_answer_the_drawdown_question(self) -> None:
        # The confound this assertion exists for was real. The first volatile
        # series swung hard enough to draw down 62%, against the drawdown case's
        # 64% — two documents with the same headline number answering each
        # other's queries, in the picture as well as in the sentence. The margin
        # is asserted rather than eyeballed.
        _r, _p, volatile = _draw(series.volatile)
        _r2, _p2, drawdown = _draw(series.deep_drawdown)
        assert -0.45 < _max_drawdown(volatile) < -0.15
        assert _max_drawdown(drawdown) < _max_drawdown(volatile) - 0.15

    def test_the_flat_line_goes_nowhere(self) -> None:
        _returns, _position, equity = _draw(series.flat_line)
        assert abs(equity[-1] - 1.0) < 0.02
        assert _max_drawdown(equity) > -0.02

    def test_the_surfaces_are_the_two_shapes_the_heatmap_argues_about(self) -> None:
        # "A smooth plateau is a robust parameter region; an isolated peak is an
        # overfit" is the heatmap's own title. Plateau: many cells near the top.
        # Peak: exactly one, and its neighbours are nowhere near it.
        plateau = series.surface("plateau", 4.0)
        peak = series.surface("peak", 4.0)
        assert (plateau > 0.8 * plateau.max()).sum() > 8
        assert (peak > 0.8 * peak.max()).sum() == 1
        assert float(np.max(plateau)) == pytest.approx(4.0)
        assert float(np.max(peak)) == pytest.approx(4.0)


# --------------------------------------------------------------------------- #
# The answer key is not inside the documents
# --------------------------------------------------------------------------- #
class TestCorpus:
    def test_every_answer_exists_and_carries_a_picture(self, corpus) -> None:
        ids = [case.id for case in corpus]
        assert len(ids) == len(set(ids)) == len(SWEEPS)
        for _query, relevant in QUERIES:
            for key in relevant:
                assert key in ids, f"{key} is in the answer key and not in the corpus"
        for case in corpus:
            # An image on EVERY document is the corpus's defining property: a
            # text-only document would measure the arm's coverage rather than
            # its quality. See the corpus module's docstring.
            assert case.png_b64
            assert case.body.strip()

    def test_no_document_contains_its_own_answer_key_slug(self, corpus) -> None:
        # The regression described in the module docstring. Any slug appearing
        # in any body is a leak, not only its own: "broad_plateau" inside the
        # ISOLATED PEAK's card would be just as fatal to query 6.
        slugs = [sweep.slug for sweep in SWEEPS]
        for case in corpus:
            body = case.body.lower()
            for slug in slugs:
                assert slug not in body, f"{slug!r} leaked into {case.id}"

    def test_the_documents_are_the_shipped_renderers_output(self, corpus) -> None:
        # Not a style check. If these titles stop matching, the corpus has
        # stopped being what `render_backtest_documents` inserts, and every
        # number the bench prints is about a corpus this desk does not have.
        by_id = {case.id: case for case in corpus}
        for sweep in SWEEPS:
            if sweep.figure != "equity":
                continue
            case = by_id[f"{sweep.slug}:equity_curve"]
            assert case.kind == "chart"
            assert case.title == f"Equity curve: {sweep.symbol} {sweep.interval} {sweep.strategy}"
            assert "The equity curve ends at" in case.body
        for sweep in SWEEPS:
            if sweep.figure == "heatmap":
                assert by_id[sweep.slug].kind == "backtest_run"

    def test_only_documents_the_ingest_mapping_names_get_a_picture(self, corpus) -> None:
        # The mapping lives in `research_image_ingest` and the corpus imports it
        # rather than restating it. This asserts the import is load-bearing: a
        # chart document of a kind that mapping does not name must not appear.
        for case in corpus:
            if case.kind == "chart":
                assert case.id.split(":")[1] in CHART_PNG_FIELDS

    def test_a_different_seed_moves_the_noise_and_not_the_shapes(self) -> None:
        # What makes `--corpus-seed` a robustness check rather than a knob.
        other, reason = build_corpus(seed=7)
        assert reason is None
        assert {case.id for case in other} == {
            f"{s.slug}:equity_curve" if s.figure == "equity" else s.slug for s in SWEEPS
        }


# --------------------------------------------------------------------------- #
# The metrics are the TypeScript's metrics
# --------------------------------------------------------------------------- #
class TestMetricsMatchTypescript:
    """Values computed by hand from ``web/lib/retrieval-eval.ts``, not from here.

    Recomputing an implementation with itself proves it is deterministic and
    nothing else. Each expected number below is the TS formula evaluated on
    paper, so the two harnesses agree by assertion rather than by intention.
    """

    def test_ndcg_discounts_by_position(self) -> None:
        # One answer at position 2: DCG = 1/log2(3), ideal DCG = 1.
        assert ndcg_at(["a", "b", "c", "d"], {"b"}, 3) == pytest.approx(1 / math.log2(3))
        # Two answers at positions 1 and 3 against an ideal of positions 1 and 2.
        assert ndcg_at(["a", "b", "c"], {"a", "c"}, 3) == pytest.approx(
            (1 + 0.5) / (1 + 1 / math.log2(3))
        )

    def test_ndcg_is_zero_rather_than_nan_with_no_answer_key(self) -> None:
        # The TS returns 0 when the ideal DCG is 0. A NaN here would poison
        # every mean in the table and be reported as a metric.
        assert ndcg_at(["a"], set(), 3) == 0.0
        assert recall_at(["a"], set(), 3) == 0.0

    def test_ndcg_ignores_answers_below_the_cutoff(self) -> None:
        assert ndcg_at(["a", "b", "c", "d"], {"d"}, 3) == 0.0
        assert reciprocal_rank(["a", "b", "c", "d"], {"d"}) == pytest.approx(0.25)
        assert reciprocal_rank(["a"], {"z"}) == 0.0

    def test_recall_divides_by_the_answer_key(self) -> None:
        assert recall_at(["a", "b", "c"], {"a", "d"}, 2) == pytest.approx(0.5)

    def test_the_fusion_joins_on_the_desk_s_own_constant(self) -> None:
        # Not 60 written again. `research_image_arm` fuses its fourth arm on
        # THIS constant, and a bench measuring a fusion on a private one would
        # be measuring something the desk does not serve.
        assert reciprocal_rank_fusion(["a"], ["a"])[0]["score"] == pytest.approx(2 / (RRF_K + 1))

    def test_an_arm_that_did_not_rank_a_document_contributes_nothing(self) -> None:
        # Nothing, not a penalty. Penalising absence turns the fusion into an
        # AND across two retrievers with very different recall — which for this
        # arm would mean deleting documents the description arm found, the one
        # thing an optional arm may never do.
        fused = reciprocal_rank_fusion(["a", "b"], ["b", "c"])
        assert [d["id"] for d in fused] == ["b", "a", "c"]
        assert fused[1]["score"] == pytest.approx(1 / (RRF_K + 1))
        assert fused[2]["secondary_rank"] == 2
        assert fused[2]["primary_rank"] is None

    def test_a_tie_breaks_towards_the_description_arm(self) -> None:
        # The same precedence `research_image_arm._order` gives the text arms,
        # and for its stated reason: an optional arm whose retrieval quality is
        # the open question may ADD candidates, but may not walk ahead of a
        # description document that scored identically.
        fused = reciprocal_rank_fusion(["description"], ["image"])
        assert fused[0]["score"] == pytest.approx(fused[1]["score"])
        assert fused[0]["id"] == "description"

    def test_the_fusion_never_drops_a_document(self) -> None:
        fused = reciprocal_rank_fusion(["a", "b"], ["c", "b"])
        assert {d["id"] for d in fused} == {"a", "b", "c"}

    def test_ranking_is_by_angle_and_not_by_dot_product(self) -> None:
        # The guard the cosine is computed in full for. fastembed normalises the
        # output of some models and not others, and the two encoders compared
        # here are from different families — so a dot product would rank a long
        # vector above a well-aligned short one and report the difference as
        # retrieval quality.
        ranking = cosine_ranking([1.0, 0.0], {
            "long_but_wrong": [3.0, 4.0],   # dot 3.0, cosine 0.60
            "short_and_right": [1.0, 0.2],  # dot 1.0, cosine 0.98
        })
        assert ranking == ["short_and_right", "long_but_wrong"]

    def test_a_zero_vector_sorts_last_rather_than_raising(self) -> None:
        # It cannot occur on the shipped path — `research_image._vector` refuses
        # an all-zero vector precisely because it is equidistant from
        # everything. A bench that crashed on one would hide which document
        # produced it, and scoring it 0.0 would place it above every genuinely
        # opposed document.
        assert cosine_ranking([1.0, 0.0], {
            "real": [-1.0, 0.0], "zero": [0.0, 0.0],
        }) == ["real", "zero"]

    def test_every_configuration_is_reported_including_the_baselines(self) -> None:
        # "Fused scores 0.81" is not a result. The two single-arm baselines are
        # the sentence the whole tool exists to be able to say.
        rows = [{"relevant": ["a"], "description": ["a", "b"], "image": ["b", "a"]}]
        scores = score_configurations(rows, k=2)
        assert [s["configuration"] for s in scores] == [
            "description only", "image only (CLIP)", "fused (RRF)", "fused (RRF, k=10)",
        ]
        assert scores[0]["mrr"] == pytest.approx(1.0)
        assert scores[1]["mrr"] == pytest.approx(0.5)

    def test_no_cases_scores_zero_rather_than_nan(self) -> None:
        for score in score_configurations([], k=3):
            assert score["ndcg"] == 0.0 and score["mrr"] == 0.0 and score["recall"] == 0.0


# --------------------------------------------------------------------------- #
# Absence is a named state, and it is the normal one
# --------------------------------------------------------------------------- #
class TestDegradesWithAReason:
    """No weights is not a build failure. It is this tree's default deployment.

    Every assertion here also guards the property that makes this suite safe to
    run anywhere: these paths refuse BEFORE any encoder is constructed, so no
    test in this file can be made to download 0.6 GB by an exported variable.
    """

    def test_an_unset_model_path_is_named_and_exits_zero(
        self, monkeypatch: pytest.MonkeyPatch, capsys
    ) -> None:
        monkeypatch.setattr("sys.argv", ["bench_image_retrieval.py"])
        assert bench.main() == 0
        printed = capsys.readouterr().out
        assert "nothing measured" in printed
        assert "RESEARCH_IMAGE_MODEL_PATH" in printed

    def test_a_missing_model_directory_is_named_and_exits_zero(
        self, monkeypatch: pytest.MonkeyPatch, capsys, tmp_path
    ) -> None:
        absent = tmp_path / "never-seeded"
        monkeypatch.setattr(
            "sys.argv", ["bench_image_retrieval.py", "--model-path", str(absent)]
        )
        assert bench.main() == 0
        printed = capsys.readouterr().out
        assert "nothing measured" in printed
        assert "--seed" in printed

    def test_seeding_without_a_directory_is_the_one_loud_failure(
        self, monkeypatch: pytest.MonkeyPatch, capsys
    ) -> None:
        # `--seed` is the only mode that returns non-zero, because there seeding
        # IS the job. It gets no further than the argument check here, so this
        # test cannot reach the network.
        monkeypatch.setattr("sys.argv", ["bench_image_retrieval.py", "--seed"])
        assert bench.main() == 1
        assert "cannot seed" in capsys.readouterr().out
