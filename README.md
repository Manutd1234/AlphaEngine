# NUSSIF Developer Analyst Case Study — Ian Wangsa

Two parts, in two directories. Start with whichever question you came for.

| | What it answers | Where |
|---|---|---|
| **Part 1** | What is wrong with 298 rows of LLM usage data, and what does the spend actually tell you? | [`Part1_Data_Handling/`](Part1_Data_Handling/) |
| **Part 2** | **AlphaEngine** — infrastructure a quant desk runs on, built end to end | [`Part2_Infrastructure/`](Part2_Infrastructure/) |

---

## Part 1 — Data handling

A Jupyter notebook that finds seven planted defects in 2.7% of the rows,
repairs each with a stated reason, and then answers the three questions: the
usage trend, the real cost driver, and what had to be assumed to say either.

The headline finding is that cost grew faster than tokens (+33% against +27%),
which is model-mix drift rather than volume — and that one service accounts for
52% of spend on 6.5% of requests. The lever is model choice and context size,
not call count.

**Open [`Part1_Data_Handling/Part1_Data_Handling.html`](Part1_Data_Handling/Part1_Data_Handling.html)**
in any browser — every output is executed and embedded, no server needed. The
notebook is generated from `build_notebook.py`, so the narrative is diff-able as
text rather than buried in cell JSON.

---

## Part 2 — AlphaEngine

> *One engine, two implementations, one test that proves it.*

An always-on FastAPI gateway, a Next.js desk workspace, a stateless research
microservice, and a Telegram companion — sharing one append-only audit log.

* **Module A** — cross-venue L2 order books from Binance and Bybit, with
  sequence-gap detection, staleness clocks, and transaction-cost analysis on the
  routed execution rather than the mid.
* **Module B** — a pre-trade risk gateway: 14 gates in ~0.2 ms on the single
  order path, an automatic drawdown breaker, reduce-only mode before the halt,
  and a kill switch reachable from four surfaces.
* **Module C** — asynchronous parameter sweeps that report the Deflated Sharpe
  Ratio, walk-forward out-of-sample results, and the probability the search
  itself is overfitting — and that will tell you a good-looking equity curve
  fails.

**Built for all seven quant-desk roles.** The README's *Who this is for* section
opens with a coverage matrix: each role's question, where it is answered, and
what is honestly still missing. Researchers, traders, portfolio managers, risk
managers, data engineers, SREs and developers each have surfaces, and all of
them reconcile to the same rows.

The maths that matters exists twice — Python for the gateway and the companion,
TypeScript for the browser — because neither runtime can call the other. That is
two chances to be wrong, so the Python side is the reference, `tools/` emits its
answers as fixtures, and the TypeScript suites assert it reproduces them. A VaR
quoted on a phone cannot disagree with the one on the screen without a test
failing.

**→ [`Part2_Infrastructure/README.md`](Part2_Infrastructure/README.md)** for the
architecture, the design arguments, and what is implemented versus mocked.

### Verify it end to end

Everything runs offline: market data falls back to clearly-tagged synthetic books, the backtester uses its own NumPy engine, and every fixture is committed.

```bash
cd Part2_Infrastructure
python -m venv venv && venv/bin/pip install -r requirements-core.txt
venv/bin/python -m pytest                            # 342 gateway tests
venv/bin/python tools/synthetic_probe.py             # book → cost → risk gate → audit
(cd web && npm install && npm test)                  # 680 web tests, incl. cross-engine parity
(cd OpenBB_Service && ../venv/bin/python -m pytest)  # 13 service tests
```

To run the complete platform concurrently:
```bash
cd Part2_Infrastructure/web && npm run dev:all
```
This launches both the **FastAPI Gateway (`http://127.0.0.1:8000`)** and **Next.js Desk Workspace (`http://localhost:3000`)** concurrently.

`.github/workflows/ci.yml` runs the same three suites plus lint, the API
contract snapshot, the committed-tree guard and the journey probe on every push.

---

## Submission contents

| Item | File |
|---|---|
| CV | `CV_Ian_Wangsa.pdf` — belongs at the root of this folder before zipping |
| Part 1 notebook (HTML export) | `Part1_Data_Handling/Part1_Data_Handling.html` |
| Part 1 notebook (source) | `Part1_Data_Handling/Part1_Data_Handling.ipynb` |
| Part 2 code, docs and outputs | `Part2_Infrastructure/` |
