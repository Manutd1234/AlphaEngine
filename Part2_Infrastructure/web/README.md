# AlphaEngine — Integrated Investment Infrastructure (Vercel)

**Last verified: 2026-09-02.** Local runtime commands, the 71-view frontend and
production gateway proxies were rechecked; historical measurements retain their
actual run dates. Locked versions and reproduction commands are centralised in the
[current-state ledger](../../docs/CURRENT_STATE.md); dated deployment and latency
observations below remain attached to the day they were actually measured.

The desk-facing half of AlphaEngine as a deployable Next.js app: one shared
instrument and decision context across portfolio oversight, strategy research,
live execution-cost analysis, market-data lineage and developer operations.
Research still gives an explicit answer to **"does this strategy actually
work?"** with the multiple-testing correction applied, not just the headline
Sharpe; the result now carries forward into the execution and data workflows.

The public market, research and data workflows need no backend, database or API
keys. An optional server-side connection to the stateful AlphaEngine gateway
adds the authoritative portfolio/risk view without exposing gateway credentials
to the browser. A separate stateless OpenBB service adds quotes, bars, news and
fundamentals. Provider keys (also optional) extend coverage through the
seven-provider registry — see [Data providers](#data-providers).

The Telegram companion is a separate client — text cards, charts and inline
keyboards on a phone, 138 commands. The header carries a one-way deep link out
to it (**Connect**), but the web workspace never embeds it and never
authenticates through it, and the bot never opens or controls this UI.

---

## Tech stack

**This app:** Next.js 16.3.0 (App Router), React 19.2.8, TypeScript 5.6 and
Tailwind 4.3.3 utilities over a hand-written token system (`app/globals.css` owns
every colour and both theme palettes; `tests/theme-contrast.test.ts` enforces
the AA contrast contract and `tests/theme-palette-parity.test.ts` holds the two
palettes to the same role set). The general desk uses the shared SVG scale kit
(`components/chart-kit.tsx`); Markets, Proofs and Diffusion add purpose-built
HTML/CSS and SVG quant instruments with linked exact-value inspectors rather
than forcing every problem into a standard chart primitive. There is no chart
library. Development uses Turbopack; the production script deliberately invokes
`next build --webpack`. Deployed on Vercel, region
`sin1` (venue egress — see the region note under Deploy).

**Behind it** (documented once, in
[`../README.md` §2 Tech stack](../README.md#2-architecture) — this section
deliberately summarises rather than restates, so the two files cannot drift into
different claims): a Python 3.12 / FastAPI gateway in Docker on port 8000 with
an authoritative DuckDB audit log; a Supabase Postgres mirror + pgvector RAG
layer (off by default, server-side only); a stateless OpenBB research service.

**Credential rule:** the browser bundle contains **zero backend env vars**.
`ALPHAENGINE_GATEWAY_URL` must be a valid `http://` or `https://` origin (the
proxy rejects `ws://` and other schemes, and rejects loopback/private hosts in
production). Use HTTPS once the pinned TLS flip is complete; the operator
runbook retains the explicit HTTP recovery path until then. A
server-only `ALPHAENGINE_GATEWAY_PUBLIC_URL` may be set as a break-glass
secondary while correcting a canonical value inherited from local development;
it is considered only when the canonical origin is unusable and is never sent
to the browser. Read-only Markets, Proofs, and Diffusion diagrams retain the
typed outage beside a deterministic sandbox snapshot when neither origin can
answer, so a serverless configuration error does not become a blank tab. The
`NEXT_PUBLIC_SUPABASE_*` variables are public by design and now carry three
browser surfaces: the decision tape, the optional sign-in at `/login`, the
preference sync that mirrors theme, detail level and last-open tab to the
signed-in account, and the account page at `/profile` (display name, avatar in a
private Storage bucket, linked providers, active sessions, password). Unset remains safe — each of those reads as not configured
and nothing else changes. `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` is public for the
same reason and, when unset, simply removes the header's Telegram button. The
bot token, the service-role key and every gateway credential stay server-side.

The private Makers RFQ proxy still requires a valid Supabase session. Migration
`20260902090000_rfq_membership_for_all_authenticated_users.sql` provisions the
fixed paper-only desk for every existing Auth account and every future sign-up,
so there is no email-specific SQL step. Anonymous guests remain blocked, and
the browser cannot create or reactivate its own membership.

---

## Deploy to Vercel

1. Import the GitHub repo at <https://vercel.com/new>.
2. Set **Root Directory** to `Part2_Infrastructure/web`. Everything else
   auto-detects (Next.js 16) — `Part2_Infrastructure/web/vercel.json` pins
   `"framework": "nextjs"` so the build cannot fall back
   to the static "Other" preset, which looks for a `public/` output directory
   and fails **after** a successful `next build` with
   *"No Output Directory named 'public' found"*.
3. Deploy. There are no required variables for keyless crypto research. For the
   integrated PM view, set `ALPHAENGINE_GATEWAY_URL` to the long-lived gateway
   and `ALPHAENGINE_GATEWAY_TOKEN` to its `WEB_API_TOKEN`. For OpenBB, deploy
   [`../OpenBB_Service`](../OpenBB_Service) separately and set
   `OPENBB_API_URL` plus the matching `OPENBB_API_TOKEN`. To make Artifact
   custody pass, pin the approved public-key SPKI SHA-256 fingerprint in
   `lib/artifact-trust.mjs`, then add the matching Ed25519 PEM as
   `ALPHAENGINE_ARTIFACT_SIGNING_KEY`; the build signs its commit/environment
   plus a digest of its Git tree, dependency lock, toolchain, and deployment
   identity without compiling the private key into the app. Then redeploy.

```text
ALPHAENGINE_GATEWAY_URL=https://stateful-gateway.example.com
# Optional temporary secondary when the canonical value cannot be replaced yet:
ALPHAENGINE_GATEWAY_PUBLIC_URL=https://stateful-gateway.example.com
ALPHAENGINE_GATEWAY_TOKEN=<gateway WEB_API_TOKEN>

OPENBB_API_URL=https://openbb-service.example.com
OPENBB_API_TOKEN=<OpenBB service token>
```

These URLs must not be collapsed into one production origin. The gateway owns
mutable portfolio and risk state; the OpenBB service is read-only and stateless.

Locally:

```bash
cd web
npm install
npm run dev        # gateway :8000 + workspace :3000; requires ../venv
npm run dev:web    # frontend-only workspace; sandbox is a labelled user choice
npm run build      # Next.js production build using the explicit webpack path
npm run typecheck  # tsc --noEmit
npm test           # 6,846 total: 6,840 passed, 6 skipped, 0 failed
                   # across 1,461 suites on 2026-09-02; no network required
npm run audit:layout -- --url=http://localhost:3000
                   # browser geometry; requires a ready app and Playwright Chromium
                   # historical 2026-08-29 run: 872/872 on the former 109-route inventory
                   # current 120-route default sweep is 960 states and needs its own run
```

`lib/test-counts.generated.ts` is refreshed by `npm run counts:refresh` and is
the contract the Developer console displays. The count gate lives outside the
suite because a test that asserts the total would itself change the total.
`next lint` was removed in Next 16; this project carries no ESLint config or
dependency, so `typecheck` is a real `tsc --noEmit` check rather than a renamed
lint command.

---

## What it does

**One surface per decision or research question** — the workspace has **eleven
tabs over 70 rail sections**. Eight tabs form the desk loop; Markets, Proofs and
Diffusion are the read-only prediction-market research engine. `NAV_ITEMS` in
`lib/workspace-nav.ts` declares tab order, `lib/sections.ts` declares section
ids, and `lib/section-views.ts` declares the addressable view beneath a section.
Those ids are public deep links and do not move with presentation labels.

| Tab | Role | What it answers |
| --- | --- | --- |
| Overview | All roles | What is the whole desk doing, and where should this role go next? |
| Research | Quant researcher | Is this candidate real, or did the search find noise? |
| Execution | Quant trader | What is the book doing right now, and what would this order cost? |
| Portfolio | Portfolio manager | What do we hold, and is the capital where it was meant to be? |
| Risk | Risk manager | How close are we to a limit, and what does the tail look like? |
| Data | Data engineer | What needs attention, where did this number come from, and can it be trusted? |
| Reliability | DevOps / SRE | Is the platform healthy, and which layer broke? |
| Developer | Quant developer | What is the contract, and what proves it still holds? |
| Markets (`#markets`) | Quant researcher | What is this exchange quoting, and what does a whole dollar of it cost? |
| Proofs (`#coherence`) | Quant researcher | Are these prices a probability measure, and what does the failure pay? |
| Diffusion (`#diffusion`) | Quant researcher | How quickly does new information reach the price, and was the instrument fit to say so? |

Panels have exactly one home. Where a second role needs a figure — a PM checking
headroom before adding to a sleeve, an SRE glancing at quarantine during an
incident — that tab carries a compact summary tile that links to the full panel
rather than a copy of it, so two tabs can never disagree about the same number.

Portfolio and Risk read one gateway snapshot through a shared hook; Data,
Reliability and Developer share one health poll the same way. Splitting the tabs
without sharing the fetch would have given each of them its own idea of the
book.

The Data workspace opens on an overview-first trust cockpit for the active
instrument. It combines market-data freshness, quote/bar validation evidence,
quarantine, lineage and provider capacity into one triage view, then drills into
six further panes — **Feeds & Contracts**, **Quality**, **Incidents**, **Lineage
& Payloads**, **Providers & Capacity** and **Work Queue**. A trust verdict is
evidence-backed: the validation window is
bounded and local to one function instance, and zero evaluated payloads is
reported as insufficient evidence rather than healthy. On entry, an on-demand
quote inspection attaches the contract outcome to that exact active-symbol
payload, so the verdict does not rely on module memory being shared across
separate Vercel route instances.

Lineage follows the workspace's active symbol and selected interval through the
cache key, TTL, provenance, skipped providers, upstream calls, raw vendor JSON
and normalised output.

**The Work Queue is no longer browser-memory sample data, and this paragraph
used to say it was.** Rows now live in the gateway's SQLite work-item table
(`GET`/`POST /api/gateway/data/work-items`, `PATCH …/{id}` through the browser
proxy; the gateway itself owns `/api/data/work-items`): every create and status
change is versioned and audit-logged, a stale edit is refused with the current
row rather than silently overwritten. A fresh store starts empty and every row
comes from an explicit create request; production has no sample-population mode.
What it is **not** is a ticketing
or incident system with a workflow engine behind it — the board says "queue" and
means it. When the gateway is unreachable the board says so and holds edits
locally until it answers. The durable quality ledger behind the Quality pane
works the same way: each web instance pushes its contract findings through the
ops-sync round trip and the gateway persists them in SQLite on its data volume,
so the record outlives the function instance that produced it. Quarantine
evidence and the raw-payload excerpts do **not** — those stay bounded to the
health-route instance that observed them, and an empty buffer is never treated
as proof of cleanliness. That split keeps the assessment's market-data
quality/freshness monitor useful to a trader while leaving the
implemented-vs-mocked boundary visible where it actually falls. The gateway side
of that contract — the SQLite tables, the retention window, the two escalation
rules and the versioned-edit semantics — is documented once, in
[`../README.md` §7 and §8](../README.md#7-api); this section describes only what
the tab does with it.

**Connected desk context** — instrument and horizon remain shared application
state, edited inside the workspaces that use them rather than in a permanent
header row. Research winners retain their modelled slippage budget when handed
to the live TCA probe; quote lookups and portfolio positions can focus the
other workspaces without re-entry.

<a id="systems-console"></a>
**Reliability console** — an observability surface, not a second quote lookup.
It answers the questions an SRE actually arrives with:

- **One source-aware status strip** — overall, trading-path and research-path
  posture are derived once. A provider-only deployment is degraded rather than
  nominal; stale gateway evidence is unknown; an unreachable configured gateway
  is critical; and an authoritative risk halt stays distinct from a research
  provider outage.
- **Authoritative gateway components** — when `ALPHAENGINE_GATEWAY_URL` is
  connected, the FastAPI gateway contributes a versioned snapshot of venue-feed
  freshness, risk mode, queue configuration, audit availability and bounded
  per-route latency. Source observation time travels with the payload, so a
  last-good snapshot cannot silently remain green.
- **Upstream health matrix** — per provider: circuit state with its failure
  count and cooldown, p50/p95/p99 latency *with the sample count that produced
  them* (a p99 over four calls is not a p99), quota consumption, failover rank,
  and per-row actions. The two direct exchange clients that `/api/depth` and
  `/api/tca` reach without the registry are measured separately and labelled as
  such, because they have no failover chain and no breaker.
- **Failover path** — the ranked chain for a capability/asset pair, evaluated
  with the same checks in the same order as the dispatch loop, marking the node
  a request issued right now would land on. `Simulate outage` holds a provider
  out server-side so failover can be *watched* rather than believed; it is
  bounded, self-expiring and reported as its own skip reason (`simulated_outage`)
  so a fault someone caused is never mistaken for one they did not.
- **Quota meters** — with the reserve boundary drawn on each bar. A provider at
  82% of Alpha Vantage's 25/day is not "nearly out"; it is already refusing
  background refreshes and saving the rest for a person, and one threshold
  cannot show that.
- **Pipeline inspector** — cache hit or miss, the exact key, TTL remaining and
  how old the served value was, the lineage, every provider skipped and why,
  each upstream HTTP call, and the vendor's raw JSON before normalisation. A
  second tab taps the browser's WebSocket frames, which never reach the server
  and are labelled accordingly.
- **Logs & traces** — server dispatch decisions and browser-side frames merge
  into a cursor-aware timeline with a structured detail pane. Provider and venue
  rows jump here with a contextual filter already applied; a discontinuity is
  rendered rather than hidden.
- **Guarded remediation** — disruptive provider-routing actions stop at a
  keyboard-focusable preview showing target, control plane, blast radius and
  consequence. Resetting a quota ledger clears *our* count, not the vendor's
  meter, and says so.
- **A map of what each write reaches** — the five server mutations against the
  seven stores they could touch. Of the 35 cells, five clear, one re-reads,
  twenty-four are left intact and five are out of reach: the whole column for
  the vendor's own meter, which no route in this deployment reads and no button
  here can reset. It is drawn three ways over one model — a bipartite figure
  (`role="img"`, the whole matrix spoken in its label), an eight-column table
  and a per-control selector — so no surface can disagree with another and none
  of them is the only route to a fact. Every cell names the function in
  `lib/operator.ts` it was read out of, and two of them came out *different*
  from the prose they replaced: `clear_telemetry` zeroes the cache counters
  while leaving cached responses in place, and `reload_providers` drops the
  cached OpenBB readiness verdict while leaving the response cache alone.

Reads are always available. Writes are gated by `ALPHAENGINE_OPERATOR_TOKEN`:
open outside production, refused in production when unset, so a public
deployment cannot have its data plane poked by a stranger. These mutations are
explicitly instance-local provider-routing controls; the Python gateway kill
switch remains on its authenticated trading surfaces.

For an assessment deployment, `ALPHAENGINE_PAPER_ORDER_DEFAULT=1` may reuse the
server-held operator token only for a missing credential on new paper orders.
The secret is never returned to the browser. Any pasted credential is validated
as a strict override, while kill/flatten, cancel/replace, and remediation remain
explicitly token-gated.

**Remediation is itself five panes**, on the in-panel `.seg role="group"`
pattern rather than a nested subtab rail — a second `WorkspaceSubtabs` would
publish a competing `--rail-h` and fight the first over every sticky offset in
the app. **Mutations** leads and is where a reader lands: the blast-radius
banner, the operator guard and its token field, the confirmation preview, the
five controls with their prices inline, and the map above. **Scope** carries
what a write *would* reach — the provider-routing ring and its three counts —
because that is a reference question asked before deciding, not while pressing.
**Session** holds this tab's own sockets and poll cadence (browser-only, so no
token gates it), **Recovery** the breaker state machine, **History** the
circuit-trip ledger for this instance. Each reads a different source, so each
degrades on its own. These pane IDs are component state and not deep links —
the URL still addresses the subtab `controls`, and "Copy link to this view" is
unchanged — but cross-tab prose elsewhere still points at "Reliability →
Remediation" without naming a pane, which stays correct only while Mutations is
the pane a reader lands on. The browser-backed layout audit now measures these
panes at the same eight viewports as the quant engine, including local
scrollport ownership and sibling intersections. The Node suite still has no
DOM; without a completed `npm run audit:layout` report, source checks alone do
not qualify the eight-column matrix or the seven-store map.

The five stable subtab IDs present the incident workflow as **Attention & SLIs
→ Dependencies → Services & Circuits → Logs & Traces → Remediation**. The
compact strip is the only repeated posture summary; the overview begins with
active attention and evidence scope instead of restating the same latency and
success figures. **SLIs, not SLOs**: this tab draws indicators with their sample
counts and a tone rule, and publishes no objective, because no SLA target is
defined anywhere in the tree. Defining one is an open item on the Data tab's own
work queue rather than something the label quietly implies.

<a id="developer-console"></a>
**Developer console** — six subtabs: **Topology**, **Readiness**, **CI / CD**,
**API & Schema**, **Code & Diffs** and **Task Queue**. Two of them changed shape
in this round, and both changes are the same idea: draw the mechanism instead of
asserting the verdict.

*API & Schema* is three panes — **Contracts** (which compatibility gates are
automated and which are unverified), **Routes** (the API catalogue) and
**Numerics**. Numerics used to be a status pill and one sentence: *byte-exact,
this browser reproduced sha256 009be58f34bb… exactly*. That digest is the end of
a five-artefact chain and none of the links were on screen, so the panel asserted
custody and showed none. It now draws the chain it actually is — `lib/mc-parity.ts`
runs the bootstrap, `lib/mc-distribution.ts` produces the result,
`lib/canonical-json.ts` canonicalises it, `crypto.subtle` hashes it, and the
committed `lib/mc-parity-reference.generated.ts` is the terminal node carrying
the digest in full and the verdict. It refuses to wear a row of ticks before
anyone presses the button: every computing link reads **not run**, because
nothing ran, and the one thing knowable at rest — whether the committed module is
self-consistent — is re-hashed on load rather than assumed.

The sibling gateway-contract chain is drawn too:
`main.py` routes → `tools/export_openapi.py` → `tools/openapi.json` → canonical
SHA-256 → `lib/gateway-openapi-digest.generated.ts`, enforced by prebuild and CI.
`GatewayContractCustodyChain` prints the complete committed and live digests,
the first divergence when they differ, and a named unmeasured state when the
gateway did not answer this poll. Both chains share `CustodyChainTrack`, so a
step, branch, status and remedy carry one interaction grammar instead of two
look-alike diagrams with different semantics. The 2026-08-29 snapshot contains
76 paths and 79 HTTP operations; prebuild accepted canonical digest
`6f50ebed6ccc76c0bc733d18ca9e8f86d8d2789f3092526076e727dba0282321`.

*Topology* draws the deployment map: a runtime band, a dashed bracket forking
from it, three deployable cards. It is DOM and CSS, not SVG — there is no SVG on
this tab at all — and its three node cards now share row lines through
`grid-template-rows: subgrid`, so a path that wraps to two lines in one card
(`Part2_Infrastructure/OpenBB_Service/app.py` is 42 characters and sets two under
the two-line clamp) no longer drops that card's detail sentence a line below its
neighbours'. `tests/developer-diagram-layout.test.ts` pins the arithmetic rather
than a remembered pixel — including a child-count assertion that fails if a sixth
row is ever added to the node card, which would otherwise land in an implicit row
and put the misalignment straight back. Two honest limits: subgrid needs Chrome
or Edge 117+, Safari 16+, Firefox 71+, and where it is unsupported the declaration
is dropped and the card renders as a plain five-row auto grid — the failure mode
is the old layout, not a broken one. Source tests do no layout; the Playwright
geometry audit owns rendered containment and collision checks.

**Portfolio oversight** — when `ALPHAENGINE_GATEWAY_URL` is configured, the
read-only server proxy renders authoritative equity, day P&L, gross/net
exposure, concentration, binding limits, positions, risk headroom and
audit-backed strategy flow. Gateway credentials remain server-side. The UI
retains a last-good snapshot only with an explicit stale warning, disables its
execution handoff while stale, and validates the gateway schema before calling
the book live.

The tab is five sub-tabs — **Overview**, **Equity & P&L**, **Positions**,
**Allocation**, **Performance** — on the same `WorkspaceSubtabs` roving-tablist primitive the
other six dense workspaces already use. Portfolio was the last one still a single
scroll, and a PM checking exposure had to travel past a rebalance table and an
attribution table to reach it. The split duplicates nothing: the Overview's
largest-exposure summary is five columns against the full table's nine — no mark,
no beta, no volatility contribution, no row actions — and *links to* Positions
rather than repeating them. Both read the same snapshot,
so they cannot disagree — but only one of them is the place to act on a position.

<a id="research-lab"></a>
**Research lab** — the Research tab is a validation pipeline, not a parameter
sweep with a chart. Beyond the verdict and the Sharpe surface it answers the
questions a researcher asks *after* a result comes back red:

- **Parameter stability** — every grid point is classified by what its
  *neighbours* do. A plateau degrades smoothly as parameters move; a cliff
  collapses one grid step away and is a coordinate the search found in noise.
  Adjacency is in grid-index space, because with a step of 5 the neighbour of 25
  is 20 — 24 was never tested.
- **Walk-forward timeline** — in-sample and out-of-sample Sharpe per fold on one
  axis, with walk-forward efficiency and parameter drift. One aggregate number
  cannot distinguish steady decay from a single regime break, and those imply
  different next experiments. Efficiency is blank where in-sample lost money,
  because OOS ÷ a negative IS returns a *positive* ratio for a fold that lost
  twice.
- **Factor exposure** — strategy returns regressed on three time-series factors
  built from the same instrument: market, trend (TSMOM) and volatility regime.
  Not Fama–French, and labelled as such: one symbol's OHLCV cannot produce a
  cross-sectional factor. Reports alpha with its t-statistic, R², the
  idiosyncratic share and the pairwise factor correlations that make an
  individual loading unstable.
- **Tail risk** — VaR/CVaR (expected shortfall over the worst *k* order
  statistics, not everything below a threshold), the Ulcer index, and a monthly
  return grid. Sharpe divides by standard deviation and so treats a fat left tail
  as ordinary variance.
- **Microstructure frictions** — optional square-root market impact
  (`k·√(order ÷ ADV)`), perpetual funding and short borrow. All default to zero,
  and at zero the run is arithmetically identical to the Python gateway's flat-bps
  engine — which the parity fixture pins. Any non-zero value makes the run a model
  of your assumptions, and the UI says so where the switch is.
- **Promotion gate** — six vetoes (DSR, OOS Sharpe, walk-forward efficiency,
  parameter neighbourhood, alpha t-statistic, trade count), all shown pass or
  fail. Hand-off to Execution is disabled until every one clears, and moves the
  candidate to paper pricing only.
- **Experiment history** — every run saved locally, with the count stated
  prominently: a per-run Deflated Sharpe prices the grid *inside* that run and
  knows nothing about the other thirty-nine hypotheses tested that afternoon.

**Trend & signal view** — price with the lines the model *actually trades on*
(SMAs for the crossover, breakout/trailing bands for Donchian, the trend filter
for RSI), and the bars where it held a position shaded behind them. Two moving
averages crossing is abstract; "you were long here and flat there" is not.

**Parameter controls** — symbol, interval, history depth, strategy (46 of them,
grouped into seven families in the picker — Trend, Breakout, Mean reversion,
Momentum, Volume, Volatility and Fitted), direction, the
fast/slow grid (from / to / step for each), fees and slippage in bps, and the
number of walk-forward folds. The combination count updates live, because a wider
search is not free: it raises the statistical hurdle the winner has to clear.

**The verdict, stated first** — before any chart, the page says PASS / MARGINAL /
FAIL and why, showing four numbers side by side:

| | |
|---|---|
| In-sample Sharpe | the number a naive backtest would report |
| Hurdle from the search | what a *random* search of the same size would have produced |
| Deflated Sharpe (DSR) | P(true Sharpe > 0) after paying for that search |
| Walk-forward OOS Sharpe | measured on data the parameters never saw |

**Equity curve vs buy & hold**, indexed to 1 so both share one axis, with the
drawdown underneath in its own panel.

**Sharpe surface** over the whole grid. The shape is the message: a broad plateau
means the edge survives small parameter changes; a lone bright cell surrounded by
neutral is an overfit that happened to win this particular search. Click any cell
to re-run that single combination and see what it actually did.

**Walk-forward folds** and the **top-15 table** — the full ranking behind the
winner, and the in-sample → out-of-sample gap that reveals overfitting.

<a id="coherence-console"></a>
**Markets, Proofs and Diffusion** are the last three tabs and are research
surfaces rather than desk roles. A contract paying $1 if an event happens is a
probability claim; a mutually exclusive family either admits a probability
measure or hands back a constructive witness. Markets reads the venue, Proofs
tests the claim, and Diffusion measures the recorded path through time. The
boundary is structural: **order path = none**.

The current engine has **22 rail sections and 71 addressable views**:

| Tab | Sections | Views |
|---|---:|---:|
| Markets (`#markets`) | 8 | 26 |
| Proofs (`#coherence`) | 7 | 29 |
| Diffusion (`#diffusion`) | 7 | 16 |

Markets and Proofs keep transport, freshness and fallback evidence in the
bounded engine readout. They do not append raw gateway notes or a shard-inventory
dropdown below every view. A genuinely live halted shard still renders one
concise trading-pause status; stale or generated fallback shards do not.

`lib/section-views.ts` is the single view registry. A default view keeps the
two-segment URL; every non-default gets `#<tab>/<section>/<view>`, a command
palette entry and a desk-sweep cell. Unknown third segments are corrected to the
section default. `RELOCATED_SECTIONS` preserves only genuine historical moves;
ids restored to a live rail resolve natively instead of retaining dead aliases.

The instruments are data-driven and domain-specific:

- **Markets** uses a family constellation, settlement board, selectable book
  identity and history scrubber, lattice reservoir, bankroll vault, fee
  counterfactual switchboard and filesystem lens. Dense selectors share roving
  focus, arrow/Home/End navigation and atomic exact-value readouts.
- **Proofs** links verdict checkpoints, constraint slack, state baskets,
  Fréchet ranges, coherence polls, Murphy terms, calibration cells, corpus rows
  and lesson guards through stable selection keys. A common coherent/zero-leg
  result remains quantitative and pinnable rather than becoming an empty panel.
- **Diffusion** preserves complete source arrays while offering local lenses for
  the selected absorption line; solid-cleared, dotted-refused or all measured
  returns; statement, conference or both control ranks; dotted background,
  solid main or all clock-ranked paths; calendar signal state; episode lifetime;
  and effect-stage, |t| and shuffled-p thresholds. The announcement means retain
  their measured middle-50% shadows. In Clocks, gray dotted paths are the
  non-material backdrop and solid blue/red paths are the main statement/conference
  crossings; its readout distinguishes all 248 input paths from the 89 carrying
  both clocks. The Findings sliders cover the full displayed |t| domain and the
  complete shuffled-p domain from 0 to 1. Filters keep plot domains and
  panel positions fixed, while sliders recompute only the loaded payload; no
  control reranks, refetches or fabricates observations. On a cold browser
  refresh, the pending Announcement-arm view reserves its eventual figure-stack
  height; terminal errors and genuinely empty reads remain compact.

Every selector publishes selected state and a keyboard path. Exact text wraps
rather than ellipsises, missing values remain missing, and colour is never the
only carrier. The general desk still uses the SVG scale kit where an axis is the
right representation; the redesigned engine deliberately uses purpose-built
HTML/CSS instruments where a normal chart would hide the decision structure.

Reads are gated by the open section and, for expensive work, the exact open
view. The shared cache joins identical in-flight reads. The replay request is
issued only for Fees → Ablation and Replay table and is not warmed. All 18
gateway coherence paths and all 21 workspace engine proxies are GET-only. The
gateway's additional authenticated Diffusion stage endpoint writes an
idempotent research observation, not an order; there is no engine executor.

Copy and interaction coverage are explicit rather than implied: eight decision
tabs have disclosure guards, ten tabs have summary-copy guards, Markets and
Proofs retain exact claim suites, and Diffusion has dedicated sparse-state,
routing, figure and interaction contracts. Browser geometry is qualified
separately with `npm run audit:layout`; a source-only test run is not a layout
pass. The historical 2026-08-29 run passed **872/872** combinations with zero
geometry failures and zero console errors on the former 109-route inventory; it
does not qualify the current 120-route surface. The current default system-theme
sweep is 960 route/viewport combinations and must be recorded separately.

---

## API

Every endpoint below the first group is public, needs no key, and hits the
exchanges live. `GET /api/markets` returns this list at runtime.

| Endpoint | Returns |
|---|---|
| `GET /api/markets` | symbols, venues, strategies, limits, endpoint index |
| `GET /api/ticker?symbols=BTCUSDT,ETHUSDT` | last price, 24h change, high/low, volume |
| `GET /api/depth?symbol=&limit=&depth=` | live L2 book per venue **and** the consolidated ladder, with cumulative notional |
| `GET /api/tca?symbol=&side=&notional=` | VWAP, slippage in bps, fillability per venue, and the cross-venue routing split |
| `GET /api/ohlcv?symbol=&interval=&bars=` | historical candles — crypto keyless via Binance; equities via the provider registry |
| `GET /api/gateway/portfolio` | same-origin read-only proxy to the authoritative FastAPI portfolio/risk book (optional gateway connection) |
| `POST /api/gateway/orders` | submit one order through the gateway's pre-trade gates; every field validated, never coerced |
| `GET /api/gateway/orders/working?symbol=` | the gateway's resting order book — what is still open, and therefore still actionable |
| `POST /api/gateway/orders/{id}/cancel` | pull one resting order |
| `POST /api/gateway/orders/{id}/replace` | cancel-and-new; relays the replacement's own check vector, not the original's |
| `GET /api/stream/desk` | the gateway's server-sent risk state, relayed same-origin: equity, drawdown and kill-switch pushed **on change** rather than polled, each event carrying a monotonic `seq` so a reconnecting client can tell "nothing happened" from "I missed something" |
| `POST /api/backtest` | parameter sweep with deflated Sharpe and walk-forward |

The read is ungated, exactly like every other read in this app; the two mutators
sit behind `ALPHAENGINE_OPERATOR_TOKEN` alongside `POST /api/gateway/orders`,
because reaching a book and being allowed to *move* it are separate questions. A
gateway rejection still comes back with HTTP 200 and its full check vector — a
blocked order is the system working, not a failed request — and on a replace that
matters twice over, because a rejected replacement still means the original is
gone, and the decision is the only place the client can learn it. An id that has
stopped resting is a 404 with its own sentence rather than the shared boundary's
blanket 502: the order filled or expired between reading the book and pressing
the button, which is the ordinary race, not an outage.

The research-data group routes through the [provider registry](#data-providers):

| Endpoint | Returns |
|---|---|
| `GET /api/quote?symbols=AAPL,BTCUSDT` | normalised quotes with provenance (which provider, latency, delayed?, quota left) |
| `GET /api/quote?symbols=AAPL&consensus=1` | every configured source at once: per-leg deviation from the median in bps, staleness, outliers |
| `GET /api/news?symbols=AAPL&limit=20` | normalised headlines; `sentiment` only where a provider actually scores it |
| `GET /api/fundamentals?symbol=AAPL` | company profile & valuation, edge-cached for a day |
| `GET /api/research?q=bitcoin+etf+flows` | open-web search returning readable markdown documents |
| `GET /api/research?url=https://…` | one page fetched as markdown (public HTTP(S) targets only) |
| `GET /api/providers` | the supply chain: per provider — configured? actively ready? circuit open? quota spent? which env var enables it |

Two optional Oracle routes back the Risk tab's **Oracle VaR** subtab and a
second opinion on retrieval. Both refuse in the open when no Oracle credentials
are configured — the panel reports the refusal, never a figure:

| Endpoint | Returns |
|---|---|
| `POST /api/oracle/var` | 99% Value at Risk from an **in-database** GBM Monte Carlo. Deliberately a *second* opinion, not a replacement: `lib/portfolio-risk/` already computes VaR from the covariance model and the Risk tab shows both, because two independent implementations of one quantity is the only cheap check on either. The two are **not interchangeable** and the panel must never present them as one figure with two sources — this is a terminal-value GBM VaR over a horizon, the client-side one is a one-day parametric/historical VaR on the current book. The simulation count is bounded here *and again in PL/SQL*, because a public endpoint that lets a caller choose how much database CPU to spend is a way to take the instance down from an anonymous request |
| `POST /api/oracle/research` | similarity search over the same research corpus, answered by Oracle 23ai's native `VECTOR` type instead of Supabase pgvector, in the existing `ResearchRagSearchResponse` shape. The query vector comes from the gateway's `/api/research/rag/embed`, so both stores are searched with the *same* embedding model — vectors are comparable only inside one model |

The coherence route group proxies the gateway's Kalshi engine — it is named for
the `coherence` id, which both tabs' routes still sit under — and every one of
them is a **read**:

| Endpoint | Returns |
|---|---|
| `GET /api/gateway/coherence/status` · `universe` · `books` · `certify` · `fees` · `surface` · `stake` · `combos` · `calibration` · `settlement` · `rfq` · `shell` | The watched families and their basket totals, both bid ladders with the implied offers, the coherence test and its failure certificate, the three-component cost model, the implication lattice and its implied mass, parlay bounds, settled-price calibration, and the universe as a filesystem. `rfq` is the one signed private-channel call and carries a 25-second budget |
| `GET /api/gateway/coherence/index` · `episodes` · `replay` | Pricing efficiency over time, recorded episodes, and the whole tape the fee ablation runs over — the largest read on the tab, which is why the workspace issues it only on one view |
| `GET /api/gateway/diffusion/events` · `findings` · `absorption` | The FOMC event ledger, the measured relationships (including the five `skill_*` fields of the out-of-sample verdict) and the absorption curve per stage |

There is deliberately **no** coherence write route on either side. The tab
certifies and records; it places no orders, and the absence of a mutator is what
makes that checkable rather than promised.

The systems group backs the [developer console](#systems-console):

| Endpoint | Returns |
|---|---|
| `GET /api/system/health[?priority=]` | provider breakers, latency, failover, cache and guard state plus an optional validated FastAPI `/api/ops/snapshot`; provider and gateway freshness remain independent, while bounded health-route-instance quote/bar totals expose their limited evidence window and leave zero observations unknown |
| `GET /api/system/events?since=<seq>&limit=` | structured trace cursored by sequence, with the oldest sequence still retained so a lagging client can detect dropped lines |
| `GET /api/system/inspect?symbol=&capability=&raw=1&refresh=1` | one lookup taken apart: cache key + TTL remaining, exact-payload contract result, lineage, every provider skipped and why, each upstream HTTP call, and the vendor's raw JSON before normalisation |
| `POST /api/system/actions` | purge cache, reset breaker, simulate/clear an outage, reset a local ledger, probe a provider, reload configuration, clear telemetry |

Common query params on the research group: `provider=` pins one adapter
(`?provider=tiingo`), `priority=interactive` marks a human-driven call that may
spend into the reserved quota — the default `background` is fenced out of each
provider's reserve so an auto-refreshing panel can never exhaust a monthly
budget a person needs later.

```bash
curl "https://<your-app>.vercel.app/api/tca?symbol=BTCUSDT&side=BUY&notional=100000"
curl "https://<your-app>.vercel.app/api/quote?symbols=AAPL,BTCUSDT&consensus=1"
```

## Data providers

Seven upstreams behind one registry (`lib/providers/`). Routes ask for a
*capability* — quote, bars, news, fundamentals, search, scrape — and the
registry picks the highest-ranked provider that is configured, under quota and
not circuit-broken, then attaches provenance and the list of everything it
skipped and why. **With no keys at all, crypto still works** through Binance's
public endpoints; each key adds capability without touching code.

| Provider | Capabilities | Free tier assumed | Env var |
|---|---|---|---|
| Binance (public) | crypto quote, bars | keyless | — |
| Financial Modeling Prep | quote¹, fundamentals¹, bars, news² | 250/day | `FMP_API_KEY` |
| Tiingo | quote, bars, news² (IEX + crypto) | 1,000/day | `TIINGO_API_KEY` |
| Massive (ex-Polygon.io) | bars¹, quote, news (equities), reference | 5/min, EOD | `MASSIVE_API_KEY` |
| Alpha Vantage | quote, bars, fundamentals, news+sentiment | 25/day | `ALPHAVANTAGE_API_KEY` |
| Firecrawl | web search¹, scrape¹ | 1,000 credits/mo | `FIRECRAWL_API_KEY` |
| OpenBB | stateless OpenBB/YFinance service — news¹ (free, uncapped) | n/a | `OPENBB_API_URL` + `OPENBB_API_TOKEN` |

¹ = ranked first for that capability. ² = declared, and on the free plans it
answers 403/402 — the runtime learns the refusal per capability and skips it
without a call for a day; a licensed key would simply start answering. Full
signup pointers in [`.env.example`](.env.example).

The reliability layer (`lib/providers/runtime.ts`) is what makes seven flaky
free tiers behave like one dependable feed:

- **Quota ledger** — calls are counted *before* they are made, per calendar
  window (Alpha Vantage's 25/day would otherwise be gone in half an hour of
  polling); background refreshes are fenced out of a per-provider reserve so
  interactive lookups still have budget at 4pm.
- **Circuit breaker** — 3 consecutive failures open the circuit for 60s, so one
  dead vendor stops costing every request its timeout.
- **Failover with provenance** — the response names who answered *and* who was
  skipped (no key / quota spent / circuit open / failed), so a degraded answer
  is visibly degraded.
- **Consensus mode** — the failure that costs money is not an outage, it is a
  feed quietly serving Friday's close with HTTP 200. `?consensus=1` fans out to
  every configured source and flags legs > 50bps from the median.
- **Honest limitation** — the ledger lives in the function instance's memory;
  on a multi-instance deployment each instance counts its own spend. `Store` is
  an interface with one in-memory implementation precisely so Vercel KV/Redis
  is a drop-in swap, and `/api/providers` states the scope in its payload.

OpenBB is the odd one out: it is a Python library, so this repository packages
it as an independent API in [`../OpenBB_Service`](../OpenBB_Service). That
service uses pinned provider fetchers directly and exposes only health, quote,
bars, news and fundamentals routes. It has no trading endpoints, Telegram
lifecycle, portfolio state, database or writable runtime dependency. Deploy it
as its own Vercel project and point `OPENBB_API_URL` to that project—not to the
stateful portfolio gateway. `/api/providers` actively probes the OpenBB
readiness route, so a non-empty but stale URL is never shown as ready.

### Streaming vs snapshots

A serverless function cannot hold a WebSocket subscription open between
invocations, so tick-by-tick L2 does not go through the API at all — the **Live
market** tab opens sockets straight from the browser to Binance and Bybit. No
backend, no key, no CORS (the WebSocket handshake is not subject to it), and one
hop of latency instead of two. `/api/depth` and `/api/tca` serve the same numbers
as REST snapshots for non-browser callers, computed with identical maths and
against the same ladder depth (Binance 20 / Bybit 50, matching the gateway) so a
probe answers the same question in both places.

The arithmetic is a port of Module A in the Python gateway, and
`tests/venues-book-maths.test.ts` and `tests/venues-parity.test.ts` replay the
gateway's own hand-computed ladders through it — so a slippage number here and one from the Telegram bot cannot disagree.

### Depth is measured in a price band, not a level count

`depthUsd` within **±10 bps of mid**, not "the top 20 levels". Level counts are
not comparable: 20 levels of a merged two-venue book spans a far narrower band
than 20 levels of one venue, and a fine-tick instrument packs more levels into
the same band. Measured by level count the same book read 93.9% bid-imbalanced;
measured in a band it reads +0.34, which is the number that means something.

---

## Architecture

```
web/
├── app/
│   ├── page.tsx              research console (client)
│   ├── layout.tsx            theme bootstrap, metadata
│   ├── globals.css           design tokens (palette, light + dark)
│   ├── login/page.tsx        optional sign-in — outside the workspace shell
│   ├── profile/page.tsx      account and security centre — the other one
│   └── api/                  65 route handlers (verified 2026-09-02). Re-derive:
│       │                     find app/api -name route.ts | wc -l
│       ├── backtest/route.ts parameter sweep
│       ├── depth/route.ts    live L2 books + consolidated ladder
│       ├── tca/route.ts      VWAP, slippage, cross-venue route
│       ├── ticker/route.ts   last price and 24h stats
│       ├── markets/route.ts  endpoint + instrument index
│       ├── ohlcv/route.ts    historical candles (crypto keyless; equities via registry)
│       ├── quote/route.ts    multi-provider quotes, incl. consensus mode
│       ├── news/route.ts     normalised headlines
│       ├── fundamentals/route.ts  company profile & valuation
│       ├── research/route.ts open-web search + page-to-markdown (Firecrawl)
│       ├── providers/route.ts  supply-chain health: keys, quotas, breakers
│       ├── favourites/route.ts pinned runs, per identity
│       ├── auth/             guest · login · logout · session — 4 routes
│       ├── stream/desk/route.ts  the gateway's server-sent risk state, relayed
│       ├── gateway/          same-origin gateway proxy, including risk, data,
│       │                     research and the read-only quant-engine routes
│       │   ├── risk/route.ts   halt · resume · flatten, and the reachability probe
│       │   ├── orders/         submit · working · [id]/cancel · [id]/replace
│       │   ├── portfolio/      book, and history
│       │   ├── audit/route.ts  the append-only log
│       │   ├── jobs/[jobId]/   one queued sweep or fit, polled
│       │   ├── data/          quality · work-items · [id] · jobs · schedules — the
│       │   │                  durable quality ledger, the persisted work queue and
│       │   │                  the replay/backfill jobs and their schedule
│       │   ├── data-quality/escalations/[id]/ack  take an open escalation
│       │   ├── research/ml/   fit · runs · runs/[runId] — supervised walk-forward
│       │   ├── research/graph/[id]  what one document is connected to
│       │   ├── research/rag/route.ts  retrieval over the research corpus
│       │   ├── coherence/    18 read-only proxies, including book/calibration
│       │   │                  history and fee-curve evidence; no order route
│       │   └── diffusion/    events · findings · absorption — the FOMC study
│       ├── oracle/           research · var — 2 routes, optional backend
│       ├── system/           actions · events · health · inspect — 4 routes
│       └── telegram/link/route.ts  mints the single-use Connect token
├── lib/
│   ├── engine.ts             vectorised backtester — port of the Python reference
│   ├── indicators.ts         O(n) SMA / rolling extremes / RSI kernels
│   ├── stats.ts              PSR, Deflated Sharpe, verdict logic
│   ├── marketdata.ts         measured provider klines; exhaustion fails closed
│   ├── venues/               live venue adapters, book/TCA maths, fill tolerance
│   ├── livebook.ts           browser WebSocket L2 client (Binance + Bybit);
│   │                          venue status decided by VenueLiveness, below
│   ├── desk-source.ts        DeskSourceMachine — what the desk shows and why:
│   │                          measured data is never replaced by generated,
│   │                          demotion is immediate, promotion needs a streak.
│   │                          The anti-twitch property, as a plain class a fake
│   │                          clock can drive; use-desk-source.ts is the wrapper
│   ├── venue-liveness.ts     per-venue live/stale hysteresis on the same
│   │                          asymmetry — read in update(), not on observation,
│   │                          so a throttled background tab cannot disarm it
│   ├── params.ts             NaN-safe query-parameter coercion for the routes
│   ├── format.ts             number/date formatting shared by the UI
│   ├── types/                shared contracts — analytics, strategies, sweep
│   └── providers/            the seven-provider registry
│       ├── types.ts          capability contracts, normalised payloads, provenance,
│       │                      the error taxonomy (failed / no_data / unlicensed / quota)
│       ├── capabilities.ts    which capability applies to which asset class — the
│       │                      table the route matrix is derived from
│       ├── contracts/         the quote, bars, news and fundamentals contracts,
│       │                      one file each over a shared base
│       ├── runtime.ts        quota ledger, circuit breaker, cache, learned licence
│       │                      state, dispatch
│       ├── registry.ts       ranked routing, consensus quotes, status
│       ├── route-labels.ts   a route's name in prose ("Crypto quotes")
│       ├── symbols.ts        asset classification (BTCUSDT≠BTC-the-stock)
│       ├── parse.ts          NaN-safe coercion funnel (vendor JSON is hostile)
│       ├── http.ts           route glue: one error shape, edge cache headers
│       └── …one adapter per vendor (binance, fmp, tiingo, massive,
│            alphavantage, firecrawl, openbb)
├── components/               SVG charts plus purpose-built quant instruments,
│                             controls, exact inspectors and tables
└── tests/                   489 .test.ts files; 6,846 tests across 1,461 suites
                              (6,840 passed, 6 skipped, 0 failed on 2026-09-02), incl.
                              cross-engine, risk-engine and gate parity, the
                              design-system ratchets (type-scale, motion, house-rules,
                              dead-css, accent-budget, null-honesty, live-motion,
                              forced-colors, interaction, header-ladder,
                              decision-latency, middle-dot, text-size, tour-truth)
                              summary/disclosure guards, the 71-view engine
                              inventory, interactive exact-value contracts and
                              browser-audit geometry helpers
```

**Why the sweep runs server-side.** Binance's public API is called from the
serverless function, not the browser: no CORS, the per-IP rate limit is pooled at
the function rather than spread across users' networks, and identical requests
are cached at the edge. A 74-combination sweep over 2000 bars takes **~20 ms**.

**Why the engine is reimplemented in TypeScript.** The Python gateway uses
vectorbt/numba, which cannot run in a serverless function. Two implementations of
the same accounting is two chances to be wrong, so
`tests/parity.test.ts` replays real Binance bars through the TS engine and
asserts it reproduces what `Part2_Infrastructure/modules/backtester/` produced
from identical input — across **all 46 strategies and both directions**, 48
cases in `tests/fixtures/parity.json` (2026-08-24). Trade counts,
exposure and turnover must match exactly; return statistics to 1e-6.

That test earned its keep: it caught two real bugs in the port — pandas applies
the exit mask *after* the entry mask (so exit wins when both fire, which turned
RSI reversion from 2 trades into 70), and position must be driven by crossover
*events* rather than the raw comparison (otherwise long/short mode opens a short
the instant the warmup ends, on a signal that never fired).

Regenerate the fixture after changing either engine:

```bash
cd ../Part2_Infrastructure && python tools/make_parity_fixture.py
```

---

## Typography

One ladder, in `app/globals.css` `:root`, and everything reads it.

| Rung | Comfortable, 16px root | Use |
|---|---|---|
| `--fs-2xs` | 12px | the reading floor: kickers, captions, table notes |
| `--fs-xs` · `--fs-sm` · `--fs-body` | 12.5 · 13 · **14** | small labels, notes, body |
| `--fs-md` · `--fs-lg` · `--fs-xl` · `--fs-2xl` | 14.5 · 15 · 15.5 · 16 | controls, mono tables, emphasis |
| `--fs-title` · `--fs-h2` · `--fs-h1` | 17 · 19 · 23 | card titles, section and page headings |
| `--fs-figure` · `--fs-display` | 26 · 32 | figures and the readiness ring |
| the three `--fs-hero-*` | 22 → 26 · 30 → 34 · 38 → 42, fluid 1280→1920 | the page heroes |
| `--fs-chrome-tab` · `-chip` · `-caption` · `-brand` | 13 · 12 · 11 · 16px, fixed | the header row, the ≤900 switcher, the ≤620 bottom bar |
| `--fs-tick` · `--fs-input` | 10px · 16px, fixed | SVG axis ticks; the iOS focus-zoom threshold |

Every content rung is `calc(<rem> × var(--type-step))` — one size each, centred on
`--fs-body: 14px`. **rem**, so the reader's browser font preference and page zoom scale
the desk (WCAG 1.4.4); `--type-step` is the **Text size** preference in Quick Settings
(compact 0.9375, comfortable 1, large 1.125; `lib/text-size.ts`, synced with the account
like the theme). The root stays `html { font-size: 100% }` and carries no rung — a
stepped root would multiply every rung by the step twice.

The content rungs were briefly fluid between 1280 and 1920px and it overshot: a 1720px
desk drew 25px headings and 29px figures. Only the three heroes stay fluid now — a hero
is one line of type on its own row, where a pixel of growth costs no layout.

The header is chrome. Its words use the four fixed px `--fs-chrome-*` tokens and never a
content rung, because the header's nine-rung priority ladder is a px measurement that a
preference must not move under it. Re-measure it whenever those tokens change:

```bash
PORT=3100 npm run dev:web
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9222 --disable-gpu about:blank
node scripts/header-ladder-measure.mjs                    # slack, tab squeeze, chip height, folded labels per width
node scripts/header-ladder-measure.mjs --text-size=large  # must be byte-identical to the default run
```

Components read the ladder through the bridged Tailwind utilities (`text-fs-sm`,
`text-fs-chrome-chip`, … — `app/tailwind.css` maps `--text-fs-*` to the tokens and strips
the stock `text-xs…9xl`) or `style={{ fontSize: "var(--fs-md)" }}`; a `text-[12px]`, a stock
`text-sm` or a numeric HTML `fontSize` fails `tests/type-scale.test.ts`. SVG `<text
fontSize={N}>` stays numeric (user units) on the inline list. Line-height and tracking are
tokens too (`--lh-none … --lh-loose`, `--ls-caps … --ls-figure`); tracking never goes
tighter than −0.03em (`tests/typography.test.ts`).

## Visualisation and instrument notes

The workspace owns its visual grammar rather than inheriting a chart library's
defaults. Conventional time-series and distributions use the shared SVG scale
kit; the 71-view quant engine also uses purpose-built HTML/CSS instruments when
the interaction is selection, decomposition, state coverage or counterfactual
rather than position on an axis.

- **Categorical hues are assigned in fixed order and never cycled.** Strategy is
  always slot 1, benchmark always slot 2 — filtering or re-running never repaints
  a series.
- **One axis, always.** Strategy and buy & hold are indexed to 1 at t0 rather
  than plotted on two y-scales, which would invent a correlation that isn't in
  the data. Drawdown gets its own panel for the same reason.
- **The Sharpe surface is diverging, not a rainbow.** Sharpe is signed around a
  meaningful zero, so it uses two hues that read as opposite with a *neutral*
  midpoint — zero reads as "nothing". (A red-yellow-green ramp puts a hue at the
  midpoint, and yellow/green is the first pair colour-blind readers lose.)
- **Palette validated, not eyeballed.** The categorical slots clear the
  colour-vision-deficiency separation, lightness-band, chroma and contrast checks
  in both light and dark mode. One light-mode slot sits below 3:1 contrast, which
  obliges the relief rule — hence the direct end-labels on every series and a
  table view of every number.
- **Dark mode is selected, not inverted** — its own steps chosen for the dark
  surface, reachable via the OS setting or the header toggle.
- **Interactive readings are exact and keyboard reachable.** Line charts use a
  crosshair/readout, heatmaps expose cells, and dense engine instruments use a
  roving listbox with one selected key shared across diagram, table and exact
  inspector. Pointer hover is never the only route to a value.

---

## Relationship to the rest of the system

This portal is Module C (research). The full AlphaEngine gateway in
[`the gateway`](..) adds the two modules that
need a long-lived process, which is why they are not deployed here:

- **Module A** — live L2 order books from Binance and Bybit over WebSocket, with
  VWAP, slippage and cross-venue smart routing.
- **Module B** — a pre-trade risk gateway (17 gates, 15 on any order path,
  decided in tens of microseconds — the compiled core inside it runs the
  arithmetic in nanoseconds, and the header chip here shows both planes), a
  resting-order book with cancel and replace, and an emergency kill switch
  controlled only through authenticated gateway surfaces — engaging it also
  cancels the resting book, because a halt that leaves orders working is not a
  halt.

Serverless functions cannot hold a WebSocket subscription open or keep risk state
between invocations, so those run on the always-on gateway. This workspace reads
portfolio state through its server-only proxy. The Telegram companion is a
separate client of the same authoritative state — cards, charts and inline
keyboards: it reports halts, risk, portfolio and execution quality, and it
cannot open this workspace or submit an order. It *can* queue a research sweep
(`/backtest`, on the shared jobs engine, never the order path), and it *can*
halt, resume, flatten, set reduce-only, reset the paper book and re-fetch a feed
through the validated path — six commands reserved for a second, narrower
operator allow-list, each needing a single-use confirmation code and never fired
from an inline button, because a desk that
can only be stopped from a laptop is a desk that cannot be stopped from a
train.

OpenBB is separate again: the web adapter calls the stateless
[`../OpenBB_Service`](../OpenBB_Service) using `OPENBB_API_URL` and
`OPENBB_API_TOKEN`. Portfolio reads call the long-lived gateway using
`ALPHAENGINE_GATEWAY_URL` and `ALPHAENGINE_GATEWAY_TOKEN`. Both token pairs stay
server-side and should be independently rotatable.

---

## Extending the system

The two extension points a developer reaches for, and the contract each one has
to honour.

### Adding a data provider

1. **Implement `Adapter`** (`lib/providers/types.ts`). Every capability method is
   optional and capability-declared, so a provider that only serves quotes
   simply omits the rest — the registry never offers it work it cannot do.
2. **Register it** in `lib/providers/registry.ts` with its quota shape and
   breaker defaults. Rank matters: the list is the failover order.
3. **Throw, do not coerce, on a missing primary field.** A quote with no price
   must fail loudly so the chain moves on. Returning a null price instead
   converts a failover into a silently wrong number.
4. **Add a case to the `tests/providers-*.test.ts` suite** with a canned vendor
   payload — `providers-coercion.test.ts` for the parsing, `providers-routing.test.ts`
   for classification and rank. Fixtures are committed, so no test reaches the
   network.

Quote and bar data contracts (`lib/providers/contracts/` — one file per
capability, with `shared.ts` beneath them) then apply
automatically: the capability façade attaches the expectations, and a payload
that fails them is failed over and quarantined without the adapter having to
know. The contract result travels with each inspected payload; health counters
and excerpts are separate bounded, route-instance diagnostics, not a durable
platform-wide quality ledger.

### Adding a panel

1. Components live in `components/` by audience — `portfolio/`, `research/`,
   `execution/`, `systems/`.
2. Read through a **same-origin route**, never a vendor directly: the credential
   stays on the server and the browser bundle never sees it.
3. Use the existing tokens. `--status-*` are fill colours at 3:1 and must never
   be a `color:` value; the `--*-text` roles exist for that and a test enforces
   it (`tests/theme-contrast.test.ts`).
4. State always encodes as **icon + word + colour**, never colour alone.
5. **A state that would render as nothing has to report itself.** An absent
   measurement dashes and says why it is absent; an empty result says it is
   empty. `?? 0` on a figure nobody measured invents one — a beta of 0.00 is an
   exposure, a latency of 0 ms is the fastest possible response — and
   `tests/null-honesty.test.ts` is the ratchet that keeps those four cases from
   coming back. It may be added to and never weakened.
6. **Wide content scrolls inside its own wrapper, and that wrapper is
   focusable.** `html` is `overflow-x: clip`, so a table or a strip that will
   not compress must carry its own `overflow-x: auto` container — and a
   container a pointer can drag but a keyboard cannot reach is a section of the
   panel no keyboard user can read. `tabIndex={0}` plus a name on the scroller
   is the pattern, and it is what `.table-wrap` carries everywhere it is used;
   `tests/developer-diagram-layout.test.ts` pins it for the Developer tab's
   pipeline strip, which scrolled where no keyboard could reach it.

### Adding a gateway endpoint

That one lives in the gateway's own README (§7): define the shape in the right
`modules/schemas_*.py` and re-export it from the `modules/schemas.py` façade, add
the route to the matching `APIRouter` in `modules/api/` — **not** to `main.py`,
which only mounts them now — with `response_model=`, test it, and regenerate
`tools/openapi.json`. The committed snapshot is what stops a rename there from
404ing a browser here; `npm run prebuild` verifies its SHA-256 before this app
will build at all.
