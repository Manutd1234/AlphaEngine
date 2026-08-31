---
name: tour
description: Walk the AlphaEngine architecture — the three deployment units, the two-implementation parity argument that pins Python against TypeScript, the honesty doctrine (null never coerced to zero, withheld values dashed, sample floors), the eleven tabs, and which of the seven quant-desk roles each surface serves. Use whenever the user says explain, walk me through, tour, overview, "how does this work", "what is this", "give me the architecture", "where is X", "why is it built this way", "onboard me", "I am reviewing this repo", or asks about parity, fixtures, the audit log, the gateway proxy, or where a role's questions get answered.
---

# Tour AlphaEngine

**Last verified: 2026-08-29.** Read `docs/CURRENT_STATE.md` before quoting any
volatile topology, dependency, contract or test figure.

Give the argument, not a file listing. Every claim below is anchored to a file —
open it and quote it rather than paraphrasing, and check the line before you
cite it.

Ask what the user came for. A reviewer, a new contributor and someone hunting
one specific number want different tours. If they do not say, lead with §1 and
§2 — those are the two ideas the rest hangs off.

---

## 1. Three deployment units, and why three

`Part2_Infrastructure/README.md`, under *Three deployment units in this
directory*, puts it plainly: they are separate because they have genuinely
different runtime needs — **one holds sockets open, one is serverless, one must
scale without touching risk state.**

| Unit | Where | Runtime need |
|---|---|---|
| **Risk gateway** | `Part2_Infrastructure/main.py`, `config.py`, `modules/` | Long-lived. WebSocket subscriptions, portfolio state, the kill switch, the audit log. Routes are eight routers under `modules/api/`, not `main.py` — which carries only three `include_in_schema=False` console aliases. Deploys to OCI compute from `main` via `.github/workflows/deploy.yml`. |
| **Desk workspace** | `Part2_Infrastructure/web` | Serverless. Next.js on Vercel, region `sin1`. |
| **Research service** | `Part2_Infrastructure/OpenBB_Service` | Stateless and read-only. Its own Vercel project, its own `OPENBB_API_TOKEN` — so market-data access and portfolio access never share a credential. |

`Part2_Infrastructure/developer-console/` is **not** a fourth unit. The README
says so in its own heading — *Also in this directory: developer-console/ —
experimental, not a deployment unit*: deployed nowhere, shares no code or data,
not part of the assessed deliverable. Do not include it in an architecture
answer unless asked about it directly.

**How the browser reaches the gateway.** Never directly. Twenty server-side
proxy routes under `web/app/api/gateway/*`, in eight families — `portfolio`
(+ `history`), `orders` (+ `working`, `[id]/cancel`, `[id]/replace`), `risk`,
`audit`, `jobs/[jobId]`, `research` (`rag`, `graph/[id]`, `ml/fit`, `ml/runs`,
`ml/runs/[runId]`), `data` (`quality`, `schedules`, `jobs`, `work-items`,
`work-items/[id]`) and `data-quality/escalations/[id]/ack`. Count them with
`find web/app/api/gateway -name route.ts` rather than quoting this list, which
is the sort of thing that grows between tours. `web/lib/gateway.ts` is the
boundary: the URL and token are read there and nowhere in the client bundle. Its
`gatewayState()` returns four distinct kinds — `url`, `absent`, `invalid`,
`loopback` — because "a serverless function fetching 127.0.0.1 fetches
*itself*", and that mistake once read as a gateway outage for a day.

Write paths carry a **second** gate, and the distinction is the interesting
part: `web/app/api/gateway/risk/route.ts` — the gateway token says "this
deployment may talk to that gateway", the operator token
(`ALPHAENGINE_OPERATOR_TOKEN`) says "this *request* may change something".

`web/proxy.ts` is Next 16's renamed middleware and is routing only, explicitly
not authorisation: "a forged cookie here buys the application shell and no data
whatsoever." `/api/*` is deliberately outside its matcher.

**The audit log** is DuckDB, and `modules/audit/` is a PACKAGE now, not the
single `audit.py` older notes point at — `store.py` holds the writer and the
`AuditLedgerConflict` that keeps a lock failure distinguishable from an IO
error, with `schema.py`, `writers.py`, `read_models.py`, `subscribers.py`,
`boundaries.py`, `clock.py` and `ohlcv.py` beside it. Append-only by convention:
nothing in the application issues UPDATE or DELETE against `orders` or
`risk_events`. DuckDB rather than Postgres because the same file answers
`SELECT quantile(latency_ms, 0.99) FROM orders` with no ETL step. The path
resolves in `config.py` (the `DB_PATH` / `DATA_DIR` line — read it, do not cite
a line number, the file moves). In Docker it lives on a **named volume**, and
the compose file explains why: a bind mount breaks uid 10001's writes and
silently degrades DuckDB to an unwritable SQLite fallback.

---

## 2. Two implementations, one test that proves it

**The problem.** The maths that matters exists twice — Python for the gateway
and the Telegram companion, TypeScript for the browser — because neither runtime
can call the other. Two implementations of the same accounting is two chances to
be wrong. The failure mode is specific and awful: *a trader reads one VaR on
their phone and a different one on the screen, and neither is flagged as
suspect.*

**The resolution.** Python is the reference. `tools/` emits its own answers as
committed fixtures. The TypeScript suites assert the browser reproduces them.

| Emitter | Fixture | Covers |
|---|---|---|
| `tools/make_parity_fixture.py` | `web/tests/fixtures/parity.json` | Backtest engine. 48 cases × 1200 live Binance bars, every strategy in the catalogue × 4 param combos. Warns if the bars are not live. |
| `tools/make_risk_fixture.py` | `web/tests/fixtures/risk-parity.json` | Risk arithmetic: VaR backtest, historical VaR, allocation proposals, rebalance trades, scenarios, covariance. Input is **deterministic, not fetched** — "a parity fixture that depends on a network call is a parity fixture that fails for reasons unrelated to the code it pins." |

The three assertion suites, and the judgement in their tolerances — this is
where the tour gets good:

- **`web/tests/parity.test.ts`** opens with a *coverage* gate before any
  numerical one: it asserts the fixture contains every strategy id the API
  accepts, not a sample of them. Then position sizing and cost accounting
  (exposure, turnover, win rate) must match to `1e-9`, because those are
  bookkeeping; the ratios (Sharpe, Sortino, Calmar, CAGR, max drawdown) get
  `1e-6`; trade *count* must be exactly equal.
- **`web/tests/risk-parity.test.ts`** — the Kupiec statistic matches to `1e-3`
  but the **zone matches exactly**. The reasoning is the tour's best single
  quote: TypeScript uses an error-function approximation where Python has an
  exact `erfc`, so the p-values can differ in the last places — but the zone is
  what a risk manager acts on, and that must not differ.
- **`web/tests/mc-parity.test.ts`** — Monte Carlo, **byte-exact, zero
  tolerance**, three legs: the committed reference (canonical JSON plus a
  SHA-256 self-check), this Node runtime, and the browser worker program,
  executed and canonicalised. Seeded at `MC_PARITY_SEED = 0xa1fa0007` over 2000
  paths (`web/lib/mc-parity.ts`).

The same instinct produces the **digest gates**, and there are two of them.
Keep them apart, because they are easy to conflate and they guard different
things:

| Chain | What it pins | Where the verdict shows |
|---|---|---|
| **Schema contract** — `main.py` routes → `tools/export_openapi.py` → `tools/openapi.json` → canonicalise + SHA-256 → `web/lib/gateway-openapi-digest.generated.ts`, checked by `scripts/check-gateway-openapi-digest.mjs` at `prebuild` and by `python tools/export_openapi.py --check` in CI | that two separately deployed units agree on the API | the "Gateway OpenAPI" and "Production schema" rows of the Contracts pane, Developer → API & Schema. A pill only: **the digest itself is not drawn** |
| **Numerics reference** — `MC_PARITY_REFERENCE_SHA256` in `web/lib/mc-parity-reference.generated.ts` (`009be58f…`), recomputed in the reader's own browser and compared byte for byte | that the Monte Carlo this browser runs is the committed one | drawn in full: the Numerics pane of the same tab, `McBrowserParityCheck` plus `NumericsCustodyChain`, which shows both digests and where they first differ |

"Numerics custody" on that card is the second chain, not the first. The first is
the older and more consequential contract and it still has no drawing — its
components would be reusable (`CustodyDigestRow` knows nothing about Monte
Carlo), so this is an admitted gap rather than a decision.

---

## 3. The honesty doctrine

The house position: **zero is a measurement and absence is not.** From
`web/tests/null-honesty.test.ts` — a beta of 0.00 invents an exposure, a latency
of 0 ms invents the fastest possible response, and $0 of depth invents an empty
book where there is only an unread one.

Three enforced mechanisms:

**(a) Null is never coerced to zero.** `null-honesty.test.ts` scans source and
bans the specific coercions that would do it — `beta ?? 0` in
`components/portfolio/StressTest.tsx`, `p99 ?? 0` in
`components/systems/LatencyTrend.tsx`, `depthUsdBid ?? 0` in
`components/LiveMarket.tsx`. It strips comments first, so the explanation is not
read as the offence. The same file pins order-timeout honesty: the browser's
timeout must exceed the gateway's, and an abort must say the order *may still
have been decided* rather than claim nothing was sent.

**(b) Withheld values render as a dash.** `web/lib/format.ts` is the single
choke point — `fmt`, `pct`, `signedPct` and `usd` all return `"—"` on null or
non-finite, and `sign()` returns `muted` for null so colour never implies a
direction that was never measured. Guarded by `tests/format.test.ts`,
`data-trust.test.ts` ("`${tile.label}` invented a value with no snapshot"),
`drift-bars.test.ts`, `no-dead-ends.test.ts`.

**(c) Sample floors.** Every statistic has a named minimum below which it
returns `null` rather than a number, and says how far off it is:

| Constant | Floor | File |
|---|---|---|
| `LATENCY_MIN_SAMPLES` | 20 | `web/lib/overview-latency.ts` (re-exported by `overview-state.ts` and as `DECISION_MIN_SAMPLES` from `decision-plane.ts`) |
| `MIN_SAMPLES` (signal path) | 20 | `web/lib/signal-path.ts` — renders `collecting, n=4 of 20` — a comma, not the middle dot an earlier tour quoted here; `middle-dot.test.ts` holds the raw-literal count at zero |
| `TRUST_MIN_SAMPLES` | 20 | `web/lib/data-trust/slis.ts` — "a thin window, not a failure" |
| `MIN_ADV_OBSERVATIONS` | 20 | `web/lib/liquidity.ts` — band `unmeasurable`, `daysToLiquidate: null` |
| `MIN_SHARPE_OBSERVATIONS` | 20 | `web/lib/portfolio-analytics.ts` — the rolling line **breaks rather than bridges** |
| `MIN_TRIPS_FOR_RATE` | 3 | `web/lib/remediation.ts` — "1/1 rendered as 100% is theatre" |
| `MIN_TRADES_FOR_SIZING` | 30 | `web/lib/quant/sizing.ts` — same hurdle the promotion gate uses |

Three of those paths changed under an earlier tour: `data-trust.ts` and
`quant.ts` are directories now, and `LATENCY_MIN_SAMPLES` moved out of
`overview-state.ts` into `overview-latency.ts` (which still re-exports it, and
`decision-plane.ts` aliases it as `DECISION_MIN_SAMPLES`). Open the file before
you cite it; the constants and the floors themselves have not moved.

The house rules in `web/tests/house-rules.test.ts`, `motion.test.ts` and
`forced-colors.test.ts` are the same doctrine applied to the interface: no emoji
(the status vocabulary is typographic marks that inherit the text colour), no
colour-only meaning, `prefers-reduced-motion` honoured everywhere, empty results
reported rather than hidden. That test file's own header is worth quoting: the
rules were written in two plans and enforced by neither, and by the time it was
written four emoji had shipped — into the provider health counts and the kill
switch, the two most safety-critical surfaces in the product. *A rule documented
in two plans and enforced by neither is a preference.*

---

## 4. The research plane, and how it refuses

Newer than the rest of the tour and easy to miss: the desk retrieves over its
own notes, and the whole plane is built so that "I could not answer that" is a
first-class outcome. Postgres stays authoritative; nothing here decides
anything.

- **Retrieval is hybrid and fused, not stacked.** A `tsvector` lexical arm and a
  384-dim pgvector arm (`gte-small` through a Supabase Edge Function, zero API
  keys) are joined by Reciprocal Rank Fusion at **k = 60**, and the Neo4j graph
  arm is fused into the SAME ranking rather than appended after it —
  `modules/research_graph_fusion.py` imports `RRF_K` from `research_bm25`
  instead of restating it, which is the whole point.
- **The corrective policy is three bands, not two.** `ANSWER_BAND = 0.8`,
  `REFUSE_BAND = 0.4` in `modules/research_crag.py`; the middle band rewrites
  once and tries again.
- **The cross-encoder's cost was measured, and the bulkhead follows from the
  measurement.** `tools/bench_rerank.py` against real weights: 197 ms for twenty
  short rows, 1,523 ms for twenty at `MAX_DOCUMENT_CHARS`. That loop is also
  carrying pre-trade risk checks whose budget is microseconds, so every call
  goes through `asyncio.to_thread` under `asyncio.Semaphore(1)` in
  `modules/research_stages.py` — one, not two, because of what the second
  number costs. Retrieval only widens when a re-ranker is actually configured.
- **Generation refuses in a fixed order, each with its own name**
  (`modules/research_generate.py`): truncated by the provider's own cap, no
  text, an explicit silence marker, an ungrounded sentence, then a figure quoted
  from nowhere. Charts are attached as PNGs under a 45,000 ms budget where text
  gets 20,000 — both read off two live calls measured at 20,590 ms and
  29,924 ms — and `THINKING_BUDGET = 0`.
- **The route is bounded in two units.** `modules/research_quota.py` holds a
  request rate and a dollar spend ceiling over a window;
  `modules/research_quota_scope.py` adds an optional per-desk predicate. Both
  read `os.environ` directly rather than growing `config.py`.
- **A fourth arm exists and is still on trial.** CLIP over chart PNGs, fused at
  the same k = 60, with `tools/bench_image_retrieval.py` written to answer
  whether it beats the sentence `research_chartdoc.py` already renders from the
  numbers — a bench whose answer is allowed to be no.

With `GEMINI_API_KEY` unset the plane still retrieves and every answer reports
`verdict=refused` with the reason. That is the honesty doctrine of §3 applied to
a language model, which is the surface most likely to invent something.

---

## 5. Eleven tabs, seven roles

Tab ids live in `web/components/WorkspaceHeader.tsx`; sections in
`web/lib/sections.ts`, whose ids never change because they are public deep links
(`#<view>/<section>`).

**Seventy addressable rail sections in total**, counted from the eleven section
arrays in `lib/sections.ts` and mirrored by `EXPECTED_SECTIONS = 70` in
`scripts/desk-sweep-plan.mjs`. Markets, Proofs and Diffusion additionally expose
60 keyed engine views (23 / 21 / 16) from `lib/section-views.ts`; those views are
not double-counted as rail sections. Re-derive both figures before quoting them:

| Tab id | Label | Role | Sections |
|---|---|---|---|
| `overview` | Overview | all | loop, desks, audit |
| `research` | Research | Quant researcher | summary, parameters, walkforward, attribution, lineage, decision, runs, fitted, codex |
| `live` | **Execution** | Trader | trade, liquidity, routing, quality, activity |
| `portfolio` | Portfolio | Portfolio manager | overview, equity, positions, allocation, performance |
| `risk` | Risk | Risk manager | limits, model, diagram, drivers, montecarlo, oraclevar, scenarios, controls |
| `data` | Data | Data engineer | overview, feeds, quality, incidents, lineage, providers, queue |
| `reliability` | Reliability | SRE | overview, planes, services, events, controls |
| `developer` | Developer | Quant developer | overview, readiness, quality, apis, codebase, work |
| `markets` | **Markets** | Quant researcher | universe, settlement, books, dispersion, lattice, stake, fees, shell |
| `coherence` | **Proofs** | Quant researcher | certificate, portfolio, combos, index, calibration, corpus, lessons |
| `diffusion` | **Diffusion** | Quant researcher | arm, meetings, episodes, model, instrument, sandbox, findings |

The last three form the quant engine: Markets reads executable venue state,
Proofs tests whether prices admit a probability measure, and Diffusion measures
how event information reaches price. Stable ids preserve published links:
`markets`, `coherence` and `diffusion`; `coherence` continues to display as
Proofs. `RELOCATED_SECTIONS` in `web/lib/workspace-hash.ts` preserves historical
section locations after earlier consolidations and promotions.

**Ids and labels have drifted apart, and that is the design.** Ids are frozen
because they are public deep links; labels were rewritten as the surfaces
matured. Most gaps are harmless expansions (`loop` renders "Decision loop"). The ones
worth naming are, at the tab level, `live` → "Execution" and `coherence` →
"Proofs"; and at the section level `codex` → "Strategies", `activity` → "Blotter",
`model` → "Risk engine", `planes` → "Dependencies", `controls` →
"Remediation", `work` → "Task Queue", `certificate` → "Coherence test" and
`calibration` → "Scorecard". Read the file rather than infer
a label from a hash, and never rename an id to close the gap.

**Engine views are addressable as a third hash segment.** A location such as
`#markets/fees/example` names tab, rail section and view. The router treats the
third segment as opaque and the owning tab resolves it through
`lib/section-views.ts`; an unknown view confesses by rewriting to the section's
default rather than leaving a plausible but false URL. Research Summary also
uses the mechanism for Results/Setup. Presentation-only subcontrols inside a
view do not add a fourth URL level. This is why 70 rail sections and 60 engine
views are different units, and why `npm run audit:layout` walks the full view
catalogue rather than only the rail.

One naming collision worth knowing before someone else finds it: the Overview
hero's pipeline kicker reads "Decision loop", and so does the first rail
section — but that section renders the KPI deck, not the pipeline. The hero is
the accurate one. Two rail label sets are Title Case (`DATA_SECTIONS`,
`RELIABILITY_SECTIONS`) while the other six are sentence case; that is
unresolved rather than deliberate, and both are recorded here so a tour does
not present them as design.

**The seven roles.** `Part2_Infrastructure/README.md`, under *Who this is for*,
opens with a coverage
matrix: each role's question, where it is answered, and — the part that makes it
worth reading — **what is honestly still missing**. Traders get 15 pre-trade
gates and cross-venue TCA but paper fills only, with no queue position.
Researchers get Deflated Sharpe, walk-forward and PBO but no feature store. Risk
managers get a Kupiec VaR backtest and a kill switch but no margin or
liquidation modelling. Point the user at that table rather than reciting it; the
gaps column is the argument.

The 2026-08-29 generated release record is 3,255 gateway tests (3,254 passed,
1 skipped), 6,519 web tests across 1,408 suites (6,513 passed, 6 skipped), and
24 service tests. It will not stay that way without `npm run counts:refresh`
after the suites change. The standing rule outranks every sentence in this file: **never quote a
test count from prose.** Run the `verify` skill and read the number off the
output. The generated file is a dated record and only its web line is a CI gate.

---

## 6. Suggested walk

If they want to see it rather than read about it, use the `start-alpha-engine`
skill, then:

1. **Overview → loop** — the pipeline end to end, and the next action.
2. **Research → walkforward** — where a good-looking equity curve is told it
   fails out of sample.
3. **Execution → trade** — send a paper order and watch every gate's verdict
   render, for accepts as well as rejects.
4. **Risk → controls** — the kill switch, reachable from four surfaces.
5. **Data → overview** — the trust cockpit, and the panels that name a thin
   window ("collecting, n=4 of 20") instead of drawing a line through four
   points.

With no gateway running, all of it works on the tagged sandbox and every write
is disabled. That is itself part of the tour: the workspace degrades to an
honest read-only state rather than to a blank one.

---

## 7. If they want the long form

`docs/whitepaper/` is the institutional whitepaper — Typst source, six chapters,
compiled and visually verified for the 2026-08-29 documentation release with
`typst compile docs/whitepaper/main.typ docs/whitepaper/AlphaEngine_Institutional_Whitepaper.pdf`.
Read the current page count from `pdfinfo`, not this skill. It is the same argument as this tour at ten times the
length, with real notation: the seventeen-gate evaluation order printed, absence
as a typed state written out formally, and every measured figure carrying the
file it was read from.

Two honest things to say about it rather than oversell it. PDFs are ignored,
source is authoritative, and no CI job compiles it — so the release workflow
must compile and inspect it deliberately. The chapters run long: the brief was
about eight pages each and four of the six came in at 10 to 16, which their
authors reported rather than hid.

`docs/README.md` indexes the shorter documents on six shelves — `architecture/`,
`engineering/`, `planning/`, `product/`, `testing/`, `whitepaper/`. Point there
rather than reciting it.
