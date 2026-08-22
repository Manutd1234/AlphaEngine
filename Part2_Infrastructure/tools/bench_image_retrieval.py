"""Answer the empirical question ``modules/research_image.py`` left open.

That module ships a FOURTH retrieval arm — ``Qdrant/clip-ViT-B-32-vision`` over
chart PNGs, queried with the matching ``-text`` half, fused at RRF k = 60 — and
says in its own docstring that how much retrieval quality it delivers ON THIS
CORPUS "is an EMPIRICAL question, and no line in this file settles it". This
harness settles it, in the shape ``tools/bench_rerank.py`` and
``tools/bench_decision.py`` already use: build a corpus whose relevance is
GROUND TRUTH rather than judgement, run the shipped code paths over it, print
what was measured, and write the numbers out as JSON.

    # once, at image build time — the ONLY mode here that touches the network
    venv/bin/python tools/bench_image_retrieval.py --seed --model-path ~/.alphaengine/clip
    # every time after that, offline, against those weights
    venv/bin/python tools/bench_image_retrieval.py --model-path ~/.alphaengine/clip
    venv/bin/python tools/bench_image_retrieval.py --model-path ~/.alphaengine/clip --k 3 --show-corpus

THE QUESTION, STATED SO THE ANSWER CAN BE NEGATIVE
--------------------------------------------------

Not "does CLIP retrieve charts". "Does CLIP retrieve charts BETTER THAN THE
SENTENCE THE DESK ALREADY RENDERS FROM THE NUMBERS IT COMPUTED TO DRAW THEM."
``modules/research_chartdoc.py`` argues that a description built from
``total_return_x``, ``max_drawdown``, ``sharpe`` and ``trades`` is exact where a
vision model is approximate, costs nothing and needs no dependency. The image
arm is only worth its ~0.6 GB if it ADDS something over that. So three
configurations are scored on identical cases:

* ``description only`` — the text arm, over exactly the bodies
  ``research_cards.render_backtest_documents`` would have inserted;
* ``image only`` — the CLIP arm, over exactly the PNGs
  ``modules/backtester/plots.py`` drew for those same runs;
* ``fused (RRF)`` — the two, through the same reciprocal-rank fusion the
  shipped arm uses, plus a ``k = 10`` ablation so a reader can see that the
  constant is not doing the work.

WHY THE CORPUS IS SYNTHETIC, AND WHY THAT IS THE HONEST CHOICE
---------------------------------------------------------------

``web/lib/retrieval-eval.ts`` says a fabricated answer key "produces a figure
that looks like evidence and is not", and refuses to commit one for the live
corpus. That refusal is about LABELS INVENTED OVER DOCUMENTS SOMEBODY ELSE
WROTE. Here the relationship runs the other way: this tool CONSTRUCTS the
series, so "this chart is the one with a deep drawdown" is not a judgement
about a picture, it is the instruction the picture was drawn from. A monotonic
riser is monotone because every bar return is positive by construction. The
answer key is upstream of the corpus rather than downstream of it, which is the
one arrangement in which a synthetic evaluation is evidence.

WHAT THIS BENCH SUBSTITUTES, NAMED RATHER THAN HIDDEN
------------------------------------------------------

The deployed description arm embeds with ``gte-small`` inside the
``embed-research`` edge function; fastembed does not serve gte-small, so the
baseline here is ``BAAI/bge-small-en-v1.5`` — same width, same size class, no
network. That is the single largest caveat on every number below and
``tools/bench_image_retrieval_models.py`` argues it in full.

ABSENCE IS A STATE, AND IT IS THE NORMAL ONE
---------------------------------------------

No weights, no fastembed, no Pillow, no matplotlib: each prints a NAMED reason
and exits 0. A bench with nothing to measure is the ordinary condition of this
tree — ``RESEARCH_IMAGE_MODEL_PATH`` is unset in every deployment that did not
ask for image search — and turning that into a red step would make the honest
default look broken. ``--seed`` is the one mode that fails loudly, because
there seeding IS the job.

WHAT WAS MEASURED, AND THE ANSWER
----------------------------------

macOS arm64, fastembed 0.7.4, 2026-08-22, six corpus draws:

    for s in 20260822 1 2 3 4 5; do
      venv/bin/python tools/bench_image_retrieval.py \
        --model-path ~/.alphaengine/clip --k 3 --corpus-seed $s
    done

Means over the six draws, and the per-draw range beside them, because with nine
queries over seven documents one rank position moves a mean by 0.03 and a single
draw is not a result:

| configuration      | nDCG@3 | range       | MRR   | recall@3 |
|--------------------|--------|-------------|-------|----------|
| description only   | 0.687  | 0.599-0.766 | 0.656 | 0.871    |
| image only (CLIP)  | 0.671  | 0.640-0.710 | 0.649 | 0.843    |
| fused (RRF k=60)   | 0.747  | 0.640-0.807 | 0.722 | 0.889    |

THE IMAGE ARM DOES NOT BEAT THE DESCRIPTION ARM. The 0.016 between them is a
quarter of the spread between two draws of the same corpus, so "CLIP is worse"
would be as unsupported as "CLIP is better". Fused, it buys +0.06 nDCG@3 over
descriptions alone — ahead of both arms on five draws of six, behind both on the
sixth.

AND NOT BY READING CHART SHAPE, WHICH IS THE CLAIM THIS BENCH WAS BUILT TO TEST.
Queries 6 and 7 ask for a broad plateau and an isolated peak on a Sharpe surface
— the arm's best case by construction, because no ``ChartDoc`` describes a
surface. CLIP ranks the SAME heatmap first for both, on every seed tried. Where
it does earn its keep is magnitude on a line: it puts the monotone riser first
for "rises steadily" and the flat line first for "goes nowhere" where the
description arm ranks them 4th and 3rd, because a sentence encoder does not
compare -64.0% with -27.4%. It is also confidently wrong — the deep-drawdown
chart comes LAST of five equity curves for a query about a deep drawdown.

``modules/research_image.py`` carries the conclusion and the recommendation that
follows from it. The per-query table this tool prints is the part that says
WHERE, and it is the part to read before switching the arm on anywhere.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.bench_image_retrieval_corpus import QUERIES, build_corpus  # noqa: E402
from tools.bench_image_retrieval_metrics import (  # noqa: E402
    cosine_ranking,
    reciprocal_rank_fusion,
    score_configurations,
)
from tools.bench_image_retrieval_models import (  # noqa: E402
    TEXT_MODEL,
    load_image_arm,
    load_text_encoder,
    seed,
)
from tools.bench_image_retrieval_series import SEED as CORPUS_SEED  # noqa: E402


def _embed_corpus(cases, ingest, encoder):
    """``(text_vectors, image_vectors, reason)`` for the whole corpus.

    ALL OR NOTHING, and this is the one design decision in the file that could
    have flattered a result. A chart the vision encoder refuses could be
    dropped from the image arm's index — and then the image arm would be scored
    on a corpus it was allowed to choose, which is not a comparison. It could
    equally be scored as a miss, which punishes the arm for the bench's own
    plumbing. So a corpus that cannot be embedded in full is not measured at
    all, and the reason is printed.

    ``ingest.embed_image`` rather than the encoder directly, because that is the
    function the write path calls: the base64 decode, the RGB conversion, the
    dimension check and the zero-vector refusal are all costs and refusals a
    real document goes through, and a bench that skipped them would measure a
    path nothing ships.
    """
    bodies = [case.body for case in cases]
    text_vectors = {
        case.id: [float(v) for v in vector]
        for case, vector in zip(cases, encoder.embed(bodies), strict=True)
    }
    image_vectors: dict[str, list[float]] = {}
    for case in cases:
        vector, state, reason = ingest.embed_image(case.png_b64)
        if state != "ready":
            return None, None, f"the chart {case.id} was not embedded ({state}): {reason}"
        image_vectors[case.id] = vector
    return text_vectors, image_vectors, None


def _rankings(cases, ri, encoder, text_vectors, image_vectors):
    """One row per query: the two arms' orderings over the whole corpus.

    Both arms rank EVERY document rather than a top-k, because the corpus is
    seven documents and a truncation would decide the recall numbers by fiat.
    On the live path the RPC's ``match_count`` does the truncating; that is a
    property of the deployment, not of the encoders, and it is not what is
    under test here.
    """
    rows = []
    for query, relevant in QUERIES:
        query_text = [float(v) for v in next(iter(encoder.embed([query])))]
        clip_vector, report = ri.embed_query(query)
        if clip_vector is None:
            return None, f"the CLIP text half refused the query {query!r}: {report['reason']}"
        rows.append({
            "query": query,
            "relevant": list(relevant),
            "description": cosine_ranking(query_text, text_vectors),
            "image": cosine_ranking(clip_vector, image_vectors),
        })
    return rows, None


def _first_relevant(ranking: list[str], relevant: list[str]) -> int | None:
    """1-based position of the first relevant document, or None if never.

    None rather than 0, and the caller dashes it. A 0 in a 1-based ranking
    column reads as "better than first", which is the null-coerced-to-zero
    failure this tree keeps a scar about.
    """
    for position, key in enumerate(ranking, start=1):
        if key in relevant:
            return position
    return None


def _print_per_query(rows: list[dict]) -> None:
    """Where each arm found the answer. The table the recommendation rests on.

    A mean over nine queries can hide an arm that is excellent on two of them
    and useless on seven, and "narrow it to the queries where it wins" is only
    an available recommendation if somebody can see which those are.
    """
    print("\nRank of the first relevant document, per query (1 is best, — is never)")
    print("| query | answers | description | image | fused |")
    print("|---|---|---|---|---|")
    for row in rows:
        fused = [d["id"] for d in reciprocal_rank_fusion(row["description"], row["image"])]
        cells = [
            _first_relevant(row[arm], row["relevant"]) for arm in ("description", "image")
        ] + [_first_relevant(fused, row["relevant"])]
        rendered = " | ".join("—" if c is None else str(c) for c in cells)
        print(f"| {row['query']} | {len(row['relevant'])} | {rendered} |")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--model-path", default=os.getenv("RESEARCH_IMAGE_MODEL_PATH", ""))
    ap.add_argument("--text-model", default=TEXT_MODEL, help="the description arm's encoder")
    ap.add_argument("--seed", action="store_true", help="fetch the three models (needs network)")
    ap.add_argument("--k", type=int, default=3, help="cutoff for nDCG@k and recall@k")
    ap.add_argument("--corpus-seed", type=int, default=None,
                    help="redraw the series noise; the designed shapes do not move")
    ap.add_argument("--show-corpus", action="store_true", help="print every description body")
    ap.add_argument("--json", type=Path, default=None, help="write the results here")
    args = ap.parse_args()

    if args.seed:
        if not args.model_path:
            print("cannot seed: --model-path (or RESEARCH_IMAGE_MODEL_PATH) names no directory")
            return 1
        return seed(args.model_path, args.text_model)

    ri, ingest, reason = load_image_arm(args.model_path, offline=True)
    if ri is None:
        # Named, and exit 0 — see the module docstring on why this is the
        # normal state of this tree rather than a build failure.
        print(f"nothing measured: {reason}")
        return 0
    encoder, reason = load_text_encoder(args.text_model, args.model_path)
    if encoder is None:
        print(f"nothing measured: {reason}")
        return 0
    cases, reason = build_corpus(args.corpus_seed or CORPUS_SEED)
    if cases is None:
        print(f"nothing measured: {reason}")
        return 0

    started = time.perf_counter()
    text_vectors, image_vectors, reason = _embed_corpus(cases, ingest, encoder)
    if text_vectors is None:
        print(f"nothing measured: {reason}")
        return 0
    rows, reason = _rankings(cases, ri, encoder, text_vectors, image_vectors)
    if rows is None:
        print(f"nothing measured: {reason}")
        return 0
    elapsed = time.perf_counter() - started

    scores = score_configurations(rows, k=args.k)
    results = {
        "generated_on": datetime.now(UTC).date().isoformat(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "image_model": ri.IMAGE_MODEL_VISION,
        "query_model": ri.IMAGE_MODEL_TEXT,
        # Recorded on every row of output, because the description column is
        # the one a reader will quote and it is NOT the model the desk deploys.
        "description_model": args.text_model,
        "description_model_deployed": "gte-small (Supabase edge, not runnable here)",
        "corpus_seed": args.corpus_seed or CORPUS_SEED,
        "documents": len(cases),
        "queries": len(rows),
        "k": args.k,
        "elapsed_s": elapsed,
        "scores": scores,
        "per_query": [
            {
                "query": row["query"],
                "relevant": row["relevant"],
                "description": row["description"],
                "image": row["image"],
            }
            for row in rows
        ],
    }

    print(
        f"{len(cases)} documents, {len(rows)} queries, embedded and ranked in "
        # No middle dot in a summary line: the house rule banning it applies to
        # every surface this desk writes, and a terminal table is one.
        f"{elapsed:.1f} s, images {ri.IMAGE_MODEL_VISION}, "
        f"descriptions {args.text_model} (standing in for gte-small)"
    )
    if args.show_corpus:
        for case in cases:
            print(f"\n--- {case.id} ---\n{case.body}")

    print(f"\nRetrieval quality over {len(rows)} queries, {len(cases)} documents")
    print(f"| configuration | nDCG@{args.k} | MRR | recall@{args.k} |")
    print("|---|---|---|---|")
    for score in scores:
        print(
            f"| {score['configuration']} | {score['ndcg']:.3f} | "
            f"{score['mrr']:.3f} | {score['recall']:.3f} |"
        )
    _print_per_query(rows)

    print("\n" + json.dumps(results, indent=2))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(results, indent=2) + "\n")
        print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    code = main()
    # `os._exit` for the reason `tools/bench_rerank.py` records and measured:
    # onnxruntime's session teardown aborts on macOS/arm64 ("recursive_mutex
    # lock failed") after a correct run has already printed every number, which
    # turns a green bench into a signalled process. It is raised by libc++
    # below Python, so there is nothing to catch. stdout is flushed first and
    # nothing here owns anything else that needs closing.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
