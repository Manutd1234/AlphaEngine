#!/usr/bin/env python3
"""
Generates notebooks/research_template.ipynb.

Authored as a script for the same reason Part 1's notebook is: the narrative
stays diff-able as text rather than living inside JSON cell blobs, and
re-running this produces an identical notebook.

    python notebooks/build_research_template.py

The notebook it writes is the researcher's entry point to the engine: it
imports ``modules.backtester`` directly, so it needs no running gateway and no
network, and it replays a recorded run out of the audit log when there is one.
"""

from __future__ import annotations

import pathlib

import nbformat as nbf

nb = nbf.v4.new_notebook()
cells: list = []


def md(text: str) -> None:
    cells.append(nbf.v4.new_markdown_cell(text.strip()))


def code(src: str) -> None:
    cells.append(nbf.v4.new_code_cell(src.strip()))


# ═══════════════════════════════════════════════════════════════════════════
md(r"""
# Research template — AlphaEngine

A starting point for a hypothesis, wired to the same engine that runs in
production. Nothing here is a copy of the backtester: it imports
`modules.backtester` directly, so a result you get in this notebook is the
result the gateway would have produced for the same request.

**No server required.** Observed mode reads Binance or its recorded DuckDB
cache and refuses to invent missing bars. The fresh-notebook example below opts
into a clearly tagged synthetic demo so it remains runnable without a network;
every cell reports which source it used.

### How to use it

1. Run the setup cell.
2. Either replay a run already in the audit log, or edit the request and run it.
3. Read the verdict **before** the equity curve — the curve is the most
   flattering artefact in quantitative research and the last one worth trusting.
""")

# ═══════════════════════════════════════════════════════════════════════════
md("## 1. Setup")

code(r"""
import json
import sys
from pathlib import Path

# The notebook lives in notebooks/; the package it imports is one level up.
ROOT = Path.cwd().parent if Path.cwd().name == "notebooks" else Path.cwd()
sys.path.insert(0, str(ROOT))

import pandas as pd

from modules.backtester import (
    dataset_fingerprint,
    fetch_ohlcv,
    overfitting_probability,
    run_backtest,
)
from modules.schemas import BacktestRequest

pd.set_option("display.float_format", lambda v: f"{v:,.4f}")
print("engine ready ·", ROOT)
""")

# ═══════════════════════════════════════════════════════════════════════════
md(r"""
## 2. Pick a run to reproduce

The gateway records every sweep it has executed, including the exact request.
Replaying one of those is the difference between "a similar backtest" and *the*
backtest — and if the audit log is empty (a fresh checkout), this falls back to
a documented default rather than failing.
""")

code(r"""
from modules.audit import get_audit

history = get_audit().recent_backtests(10)

if history:
    print(f"{len(history)} runs in the audit log:\n")
    for row in history:
        label = row.get("label") or row["strategy"]
        print(f"  {str(row['ts'])[:16]}  {row['symbol']:9} {row['interval']:4} "
              f"{label:16} Sharpe {row['sharpe']:6.2f}  DSR {row.get('dsr') or float('nan'):.3f}")
    # Replay the most recent one. Change the index to pick another.
    request = BacktestRequest(**json.loads(history[0]["request_json"]))
    recorded_hash = history[0].get("data_hash")
else:
    print("No runs recorded yet — starting in explicit synthetic demo mode.")
    request = BacktestRequest(symbol="BTCUSDT", interval="1h", bars=1500,
                              data_mode="synthetic_demo")
    recorded_hash = None

request
""")

# ═══════════════════════════════════════════════════════════════════════════
md(r"""
## 3. Load the bars, and check they are the same bars

A symbol and a date range do not identify a dataset. The same window can be a
live pull, a cached copy, or an explicitly requested synthetic demonstration,
and only a content hash can tell them apart. If you are reproducing a recorded
run, this is the cell that says whether you actually reproduced it.
""")

code(r"""
df, source = fetch_ohlcv(
    request.symbol, request.interval, request.bars, data_mode=request.data_mode,
)
fingerprint = dataset_fingerprint(df)

print(f"{len(df):,} bars from {source}")
print(f"{df.index[0]} → {df.index[-1]}")
print(f"fingerprint: {fingerprint}")

if recorded_hash:
    if recorded_hash == fingerprint:
        print("\n✓ Same bars as the recorded run — results are directly comparable.")
    else:
        print(f"\n! Different bars (recorded {recorded_hash}). The data moved under the "
              "experiment; any metric difference is not evidence about the strategy.")

df.tail()
""")

# ═══════════════════════════════════════════════════════════════════════════
md(r"""
## 4. Run the sweep

`run_backtest` is the exact callable the job queue dispatches. It returns a
JSON-safe dict: the same payload the API serves and the same one the Telegram
companion formats.
""")

code(r"""
result = run_backtest(request.model_dump(), job_id="notebook")

print(f"engine        : {result['engine']}")
print(f"combinations  : {result['combos_tested']}")
print(f"best          : fast={result['best']['fast']} slow={result['best']['slow']}")
print(f"in-sample     : Sharpe {result['best']['sharpe']:.2f}, "
      f"return {result['best']['total_return']:.1%}, "
      f"max DD {result['best']['max_drawdown']:.1%}")
""")

# ═══════════════════════════════════════════════════════════════════════════
md(r"""
## 5. Read the verdict before the curve

The best Sharpe in a grid of 400 is a *maximum of 400 draws*: a grid of pure
noise reliably produces something that looks like an edge. Three numbers say
whether this one is real.

| Number | What it answers |
|---|---|
| **Deflated Sharpe** | Given how many combinations were tried and how they were spread, what is the probability the true Sharpe is above zero? |
| **Out-of-sample Sharpe** | What did the chosen parameters do on data they were never fitted to? |
| **Overfit probability** | How often did the in-sample winner land in the *worse half* of the same grid out-of-sample? Above 50% the search is selecting noise. |
""")

code(r"""
print(f"Deflated Sharpe    : {result['deflated_sharpe_ratio']:.3f}")
print(f"Verdict            : {result['dsr_verdict']}")
print(f"OOS Sharpe         : {result['walk_forward_oos_sharpe']}")

pbo = result.get("overfitting_probability")
print(f"Overfit probability: {'—' if pbo is None else f'{pbo:.0%}'}")

for warning in result["warnings"]:
    print(f"! {warning}")
""")

code(r"""
folds = pd.DataFrame(result["walk_forward"])
if not folds.empty:
    display(folds[[
        "fold", "train_end", "test_start", "chosen_fast", "chosen_slow",
        "is_sharpe", "oos_sharpe", "oos_rank", "combos_ranked",
    ]])
    # The gap between is_sharpe and oos_sharpe IS the overfitting, measured in
    # the units you already read.
else:
    print("Walk-forward produced no folds — usually too few bars for the fold count.")
""")

# ═══════════════════════════════════════════════════════════════════════════
md(r"""
## 6. Charts

Rendered by the same plotting code the API returns to the web workspace, so a
chart here is the chart a colleague sees.
""")

code(r"""
import base64

from IPython.display import Image, display

for key, caption in (("equity_curve_png", "Equity curve"), ("heatmap_png", "Sharpe surface")):
    if result.get(key):
        print(caption)
        display(Image(data=base64.b64decode(result[key])))
""")

# ═══════════════════════════════════════════════════════════════════════════
md(r"""
## 7. Your turn

Change one thing, re-run, and compare. The discipline that makes this a research
log rather than a slot machine:

* **Change one variable at a time.** Two changes and a Sharpe move tells you nothing.
* **Watch the attempt count.** The Deflated Sharpe prices the search *inside* one
  sweep. It does not know about the other sweeps you ran today — twenty
  hypotheses on one instrument is itself a multiple-testing problem.
* **Never set costs to zero** to see "what the signal can do". A frictionless
  result is not an upper bound on a real one; it is a different question.

An idea that survives here is not finished. It still has to clear the promotion
gate in the web workspace and then the fourteen pre-trade gates on the way to an
order — see README §5 and §4.
""")

code(r"""
# Example: does the edge survive a realistic cost assumption?
expensive = request.model_copy(update={"fee_bps": 10.0, "slippage_bps": 8.0})
comparison = run_backtest(expensive.model_dump(), job_id="notebook-costs")

print(f"base      Sharpe {result['best']['sharpe']:6.2f}  DSR {result['deflated_sharpe_ratio']:.3f}")
print(f"expensive Sharpe {comparison['best']['sharpe']:6.2f}  DSR {comparison['deflated_sharpe_ratio']:.3f}")
print(f"\nsame bars: {comparison['data_hash'] == result['data_hash']}")
""")

# ═══════════════════════════════════════════════════════════════════════════
nb["cells"] = cells
nb["metadata"] = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python", "version": "3.12"},
}

OUT = pathlib.Path(__file__).resolve().parent / "research_template.ipynb"
nbf.write(nb, OUT)
print(f"wrote {OUT.relative_to(OUT.parent.parent)} ({len(cells)} cells)")
