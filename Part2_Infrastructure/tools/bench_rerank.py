"""Measure the cross-encoder re-ranker, reproducibly — and seed its weights.

``modules/research_rerank.py`` shipped with a latency figure that called itself
an ESTIMATE ("tens of milliseconds, call it 30-80 ms") derived from the
parameter count, and said "the eval harness is what would turn it into a
measurement". This is that harness, in the shape ``tools/bench_decision.py``
already uses for the pre-trade decision: it runs the REAL model at the width the
pipeline actually widens to, prints what it measured, and writes the numbers out
as JSON, so a figure quoted in a comment is reproducible rather than remembered.

    # once, at image build time — the ONLY mode here that touches the network
    venv/bin/python tools/bench_rerank.py --seed --model-path /models/rerank
    # every time after that, offline, against those weights
    venv/bin/python tools/bench_rerank.py --model-path /models/rerank
    venv/bin/python tools/bench_rerank.py --lengths 40,200,2000 --threads 1,4

The estimate did not survive the harness. What it measured on an 18-core arm64
laptop (fastembed 0.7.4, onnxruntime 1.29.0) is written into ``research_rerank``
and into ``research_stages._RERANK_BULKHEAD``; the point of this file is that
neither of those has to be believed.

Four tables, each because a different comment in the tree rested on a number
nobody had taken. ``--widths`` is pairs per call, defaulted to the module's own
``RERANK_CANDIDATES`` rather than to a width that flatters it. ``--lengths`` is
characters per document up to ``MAX_DOCUMENT_CHARS``, and it earns a table
rather than a footnote because it turned out to be the term that DOMINATES.
``--concurrency`` is what a second simultaneous re-rank buys, which
``research_stages``'s bulkhead width was a guess about; ``--threads`` is what
bounding onnxruntime's own intra-op pool costs instead.

WALL AND CPU, ALWAYS BOTH — the correction this tool exists to make.
``time.process_time`` counts every thread's CPU in this process, so the ratio of
those two columns is the effective core count one re-rank is using. A wall
figure alone is what let "tens of milliseconds" stand beside a bulkhead whose
whole justification is that this process also serves the pre-trade risk checks.

What this cannot do on a laptop: pin a CPU, silence the OS, or tell you the
number for YOUR box. onnxruntime sizes its intra-op pool from the cores it finds,
so every figure is a property of the machine that took it — which is why this is
a tool and not a constant. Run it where you deploy.

Absence is a state here too. No weights, or no fastembed, prints a named reason
and exits 0: a bench with nothing to measure is the normal state of this tree,
not a build failure. ``--seed`` is the one mode that fails loudly, because there
seeding IS the job.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import statistics
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

#: The query every table is measured against. A real desk question rather than
#: a lorem string: the tokeniser's output length is what the model pays for, and
#: a query of unrepresentative length would move every number in the file.
QUERY = "sharpe ratio of the BTCUSDT moving average crossover backtest"

#: One sentence of desk prose, repeated to a target length. Repetition is honest
#: here — the cost is a function of TOKEN COUNT, not of how interesting the
#: tokens are — and it keeps the corpus reproducible without committing a
#: fixture that would dwarf the tool.
_FILLER = "sharpe 1.4 drawdown -12% over 1500 bars of hourly data. "


def _corpus(width: int, chars: int) -> list[dict]:
    """``width`` documents of ``chars`` characters each, in the row shape.

    The keys are the ones ``research_rerank.TEXT_FIELDS`` reads, so this is the
    batch the module builds from a real retrieval — benching a shape the
    pipeline never produces would measure the wrong thing.
    """
    body = (_FILLER * (chars // len(_FILLER) + 1))[:chars]
    return [
        {"id": f"d{i}", "title": f"BTCUSDT crossover backtest fold {i}", "body": body}
        for i in range(width)
    ]


def _load(model_path: str, *, offline: bool):
    """``research_rerank``, configured, or ``(None, reason)``.

    ``RERANK_MODEL_PATH`` goes into the environment BEFORE ``config`` is
    imported — the same trick ``bench_decision`` plays with ``DECISION_CORE``,
    because ``Settings`` is a frozen dataclass reading the environment in its
    field defaults, so before the first import is the only moment it is settable.

    ``HF_HUB_OFFLINE`` is set for every mode except ``--seed``: a bench that
    quietly downloaded would report a COLD number under a warm label, and would
    contradict what this module was chosen for — no network at request time.
    """
    os.environ["RERANK_MODEL_PATH"] = model_path
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    else:
        os.environ.pop("HF_HUB_OFFLINE", None)

    from modules import research_rerank as rr

    encoder_cls, reason = rr._import_cross_encoder()
    if encoder_cls is None:
        return None, reason
    if not model_path:
        return None, (
            "no model path: pass --model-path or set RERANK_MODEL_PATH to the "
            "directory the weights were seeded into"
        )
    if not Path(model_path).is_dir():
        return None, f"the model directory {model_path} does not exist (run --seed)"
    return rr, None


def _seed(model_path: str) -> int:
    """Fetch the ONNX weights into ``model_path``. The one networked mode.

    The step ``requirements-rerank.txt`` has always prescribed ("do it at image
    build time, never on the request path") and that nothing in the tree
    performed — which is how the re-ranker reached production as a code path
    with no weights behind it. In the bench rather than a shell script because
    it already knows how the module resolves a model, and two places that both
    "know where the weights go" is one too many.

    Measured once, cold: 5 files, 21.7 s, 1.05 GiB — of which one blob is
    1,112,459,588 bytes of fp32 ONNX. That size is the argument for caching it
    in CI rather than fetching per job, and for never putting it on a request
    path.
    """
    from modules import research_rerank as rr

    encoder_cls, reason = rr._import_cross_encoder()
    if encoder_cls is None:
        print(f"cannot seed: {reason}")
        return 1
    os.environ.pop("HF_HUB_OFFLINE", None)
    Path(model_path).mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    try:
        encoder_cls(model_name=rr.RERANK_MODEL, cache_dir=model_path)
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        # Same breadth as the module's own load guard, and for the same reason:
        # a refused download, a full disk and an unreadable directory are three
        # different sentences and one outcome — no weights, here is why.
        print(f"cannot seed: {type(exc).__name__} fetching {rr.RERANK_MODEL}: {exc}")
        return 1
    # Symlinks skipped, or every weight is counted twice: the hub cache keeps one
    # blob and points a snapshot name at it, and `stat` follows the link. The
    # first version of this line reported 2.10 GiB for a 1.05 GiB directory.
    total = sum(
        f.stat().st_size
        for f in Path(model_path).rglob("*")
        if f.is_file() and not f.is_symlink()
    )
    print(
        f"seeded {rr.RERANK_MODEL} into {model_path} in "
        f"{time.perf_counter() - started:.1f} s, {total / 1024**3:.2f} GiB on disk"
    )
    return 0


def _once(rr, documents: list[dict]) -> tuple[float, float]:
    """One re-rank through the module's own entry point: (wall ms, CPU ms).

    ``rr.rerank`` rather than the encoder directly, so the figure includes the
    text joining and truncation the module does — the caller pays for those and
    a bench that skipped them would publish a number no request can achieve.
    """
    cpu0, wall0 = time.process_time(), time.perf_counter()
    report = rr.rerank(QUERY, documents, top_k=3)
    wall = 1000.0 * (time.perf_counter() - wall0)
    cpu = 1000.0 * (time.process_time() - cpu0)
    if report["state"] != "reranked":
        raise SystemExit(f"the model did not run: {report['state']} — {report['reason']}")
    return wall, cpu


def _stats(samples: list[tuple[float, float]]) -> dict:
    walls = [w for w, _ in samples]
    cpus = [c for _, c in samples]
    median_wall = statistics.median(walls)
    return {
        "min_ms": min(walls),
        "median_ms": median_wall,
        "max_ms": max(walls),
        "cpu_median_ms": statistics.median(cpus),
        # CPU divided by wall IS the effective core count, and it is the column
        # the old estimate was missing. A re-rank holds one executor thread and
        # this many cores; the bulkhead was counting the first number.
        "cores": statistics.median(cpus) / median_wall if median_wall else 0.0,
        "runs": len(samples),
    }


def _measure(rr, width: int, chars: int, repeat: int) -> dict:
    rr.rerank(QUERY, _corpus(2, chars), top_k=1)  # warm: the load is not the batch
    documents = _corpus(width, chars)
    return _stats([_once(rr, documents) for _ in range(repeat)])


async def _concurrent(rr, level: int, documents: list[dict]) -> tuple[float, list[float]]:
    """``level`` re-ranks at once, through the real seam's own offload.

    ``asyncio.to_thread`` rather than a thread pool of this tool's own, because
    that is what ``research_stages.narrow`` does, and the question being asked
    is about THAT — how much a second simultaneous request costs the first.
    """
    async def one() -> float:
        started = time.perf_counter()
        await asyncio.to_thread(rr.rerank, QUERY, documents, 3)
        return 1000.0 * (time.perf_counter() - started)

    started = time.perf_counter()
    each = await asyncio.gather(*[one() for _ in range(level)])
    return 1000.0 * (time.perf_counter() - started), list(each)


def _threads_row(rr, level: int | None, documents: list[dict], repeat: int) -> dict:
    """One row of the intra-op pool sweep, built at the module's own boundary.

    ``_import_cross_encoder`` rather than importing fastembed here: the module
    owns where the encoder comes from, and a bench that imported it separately
    would be measuring a second construction path nobody ships.
    """
    encoder_cls, _ = rr._import_cross_encoder()
    encoder = encoder_cls(
        model_name=rr.RERANK_MODEL, cache_dir=rr.settings.rerank_model_path, threads=level,
    )
    texts = [rr._text(document) for document in documents]
    list(encoder.rerank(QUERY, texts[:2]))
    samples = []
    for _ in range(repeat):
        cpu0, wall0 = time.process_time(), time.perf_counter()
        list(encoder.rerank(QUERY, texts))
        samples.append((
            1000.0 * (time.perf_counter() - wall0), 1000.0 * (time.process_time() - cpu0),
        ))
    return {"threads": level, **_stats(samples)}


def _print_table(title: str, first: str, rows: list[dict], key: str) -> None:
    print(f"\n{title}")
    print(f"| {first} | min ms | median ms | max ms | CPU ms | cores | n |")
    print("|---|---|---|---|---|---|---|")
    for row in rows:
        label = row[key] if row[key] is not None else "default (all cores)"
        print(
            f"| {label} | {row['min_ms']:.1f} | {row['median_ms']:.1f} | "
            f"{row['max_ms']:.1f} | {row['cpu_median_ms']:.0f} | {row['cores']:.1f} | "
            f"{row['runs']} |"
        )


def _ints(raw: str) -> list[int]:
    return [int(part) for part in raw.split(",") if part.strip()]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--model-path", default=os.getenv("RERANK_MODEL_PATH", ""))
    ap.add_argument("--seed", action="store_true", help="fetch the weights (needs network)")
    ap.add_argument("--widths", default="", help="pairs per call, e.g. 3,20,60")
    ap.add_argument("--lengths", default="", help="characters per document, e.g. 40,200,2000")
    ap.add_argument("--concurrency", default="1,2", help="simultaneous re-ranks, e.g. 1,2,4")
    ap.add_argument("--threads", default="", help="onnxruntime intra-op sizes, e.g. 1,2,4")
    ap.add_argument("--repeat", type=int, default=7)
    ap.add_argument("--json", type=Path, default=None, help="write the results here")
    args = ap.parse_args()

    if args.seed:
        if not args.model_path:
            print("cannot seed: --model-path (or RERANK_MODEL_PATH) names no directory")
            return 1
        return _seed(args.model_path)

    rr, reason = _load(args.model_path, offline=True)
    if rr is None:
        # Named, and exit 0. A bench with no model to measure is the normal
        # state of this tree — the same state `research_rerank` reports rather
        # than raising — and turning it into a red step would make the honest
        # default deployment look broken.
        print(f"nothing measured: {reason}")
        return 0

    # The width the module is sized for and the length its own truncation permits
    # are the defaults, not a flattering pair: a bench whose defaults understate
    # the cost is how the estimate survived this long.
    widths = _ints(args.widths) or [3, rr.RERANK_CANDIDATES]
    lengths = _ints(args.lengths) or [40, 200, 500, rr.MAX_DOCUMENT_CHARS]
    headline_chars = lengths[-1]

    results: dict = {
        "generated_on": datetime.now(UTC).date().isoformat(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "model": rr.RERANK_MODEL,
        "model_path": args.model_path,
        "repeat": args.repeat,
    }

    started = time.perf_counter()
    rr.rerank(QUERY, _corpus(1, 100), top_k=1)
    results["cold_load_s"] = time.perf_counter() - started
    print(
        f"{rr.RERANK_MODEL} loaded from {args.model_path} in "
        f"{results['cold_load_s']:.2f} s, offline · {os.cpu_count()} cores · "
        f"median of {args.repeat} runs"
    )

    results["widths"] = [
        {"width": w, "chars": headline_chars, **_measure(rr, w, headline_chars, args.repeat)}
        for w in widths
    ]
    _print_table(
        f"Pairs per call, at {headline_chars} characters a document", "pairs",
        results["widths"], "width",
    )

    results["lengths"] = [
        {"chars": c, "width": rr.RERANK_CANDIDATES,
         **_measure(rr, rr.RERANK_CANDIDATES, c, args.repeat)}
        for c in lengths
    ]
    _print_table(
        f"Characters per document, at {rr.RERANK_CANDIDATES} pairs "
        f"(RERANK_CANDIDATES)", "chars", results["lengths"], "chars",
    )

    documents = _corpus(rr.RERANK_CANDIDATES, headline_chars)
    concurrency = []
    for level in _ints(args.concurrency):
        runs = [asyncio.run(_concurrent(rr, level, documents)) for _ in range(3)]
        concurrency.append({
            "level": level,
            "wall_median_ms": statistics.median(w for w, _ in runs),
            "slowest_task_median_ms": statistics.median(max(each) for _, each in runs),
        })
    results["concurrency"] = concurrency
    print(
        f"\nSimultaneous re-ranks of {rr.RERANK_CANDIDATES} pairs at "
        f"{headline_chars} characters — what the bulkhead width is about"
    )
    print("| at once | wall ms | slowest task ms | throughput vs 1 |")
    print("|---|---|---|---|")
    base = concurrency[0]["wall_median_ms"] if concurrency else 0.0
    for row in concurrency:
        gain = (base * row["level"]) / row["wall_median_ms"] if row["wall_median_ms"] else 0.0
        print(
            f"| {row['level']} | {row['wall_median_ms']:.1f} | "
            f"{row['slowest_task_median_ms']:.1f} | {gain:.2f}x |"
        )

    if args.threads:
        # `None` first: the default pool is the baseline every other row is a
        # saving against, and leaving it out would publish a sweep with no zero.
        levels: list[int | None] = [None, *_ints(args.threads)]
        results["threads"] = [
            _threads_row(rr, level, documents, args.repeat) for level in levels
        ]
        _print_table(
            "onnxruntime intra-op pool size, scoring the same batch",
            "threads", results["threads"], "threads",
        )

    print("\n" + json.dumps(results, indent=2))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(results, indent=2) + "\n")
        print(f"wrote {args.json}")
    return 0


if __name__ == "__main__":
    code = main()
    # `os._exit` rather than falling off the end, and this is a measured
    # workaround rather than a stylistic choice. onnxruntime's session teardown
    # aborts on macOS/arm64 ("recursive_mutex lock failed: Invalid argument")
    # after a correct run has already printed every number, which turns a green
    # bench into a signalled process and a red CI step. The rejected
    # alternative was catching it: it is raised by libc++ below Python, so
    # there is nothing to catch. Nothing here owns a file or a socket that
    # needs flushing beyond stdout, which is flushed first.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
