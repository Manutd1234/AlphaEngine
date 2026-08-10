# UI Overhaul Plan — eight slices to an Apple-grade, engaging research workspace

**The conclusion first.** The workspace's engine outgrew its chrome: 46 strategies hide behind a
flat dropdown, the promotion gate — the most dramatic moment in the product — renders as a static
list, and a 12,900-line design system contains exactly three animations. This plan adds
collection, progression and discovery mechanics **played straight as research instruments**, plus
Apple-grade motion, in eight independently shippable slices.

The boundary that keeps it honest, stated once and used as the acceptance test for every slice:
**no confetti, no XP, no streaks, no locked content — a research tool that celebrates output
volume rewards exactly the multiple-testing behaviour the Deflated Sharpe Ratio exists to
punish.** Engagement here means the interface makes evidence *feel* like evidence, not that it
makes running sweeps feel like winning.

| Slice | Deliverable | Status |
|---|---|---|
| 1 | This plan + `docs/UI_IMPROVEMENTS.md` + `docs/FEATURE_TOUR.md` | shipped |
| 2 | Motion foundation: tokens, one reduced-motion contract, NumberTicker | shipped |
| 3 | Strategy Codex: 46 strategies, 7 families, explored-state | shipped |
| 4 | Research journey: gate reveal, verdict moment, rail progress | shipped |
| 5 | Live-data theatre: tick flashes, order-gate cascade, book motion | shipped |
| 6 | Charts alive: line draw-in, heatmap wavefront, honest MC cone | shipped |
| 7 | Navigation: View Transitions, ⌘K fuzzy search + recents | shipped |
| 8 | Consolidation, honesty sweep, tour finalisation | shipped |

---

## 1. Audit — what exists today (all claims verified against source)

Root: `Part2_Infrastructure/web`. Paths below are relative to it.

**Motion.** Tokens `--dur-fast: 110ms`, `--dur: 170ms`, one `--ease` (`app/globals.css:125-127`).
Three `@keyframes` in 12,900 lines: `shimmer` (skeletons), `panel-in` (tab entry), `rise-in` —
the most advanced thing present, scroll-driven via `animation-timeline: view()`, correctly
Chromium-progressive. Seven `transition:` declarations hardcode durations (globals.css:1214,
1417, 1488, 4580, 5604, 10376). **Two conflicting `prefers-reduced-motion` blocks**: the nuclear
`* { animation: none !important }` at :1424 wins over the correct 1ms-duration block at :11301,
making the latter dead code — and `none` strips `animationend`, so any JS sequenced on animation
completion silently never fires.

**The catalogue.** 46 strategies with full documentation (`lib/strategy-docs.ts`: summary,
formula, when it works, when it fails, similar) and a 7-family taxonomy
(`lib/types.ts` `STRATEGY_FAMILY`) that **no component renders**. The picker is a flat 46-option
`<select>` (`components/Controls.tsx:260`). There is no gallery. Stale prose still says
"twenty-six" in `lib/strategy-docs.ts:5-15` and `components/research/StrategyDocCard.tsx:8-14`.

**Progression that already exists** (to build on, never duplicate): the experiment trail
(`lib/experiments.ts` — localStorage, 60-record cap, request-deduped), the six-veto
PromotionPanel (the natural "badge moment"), Verdict PASS/MARGINAL/FAIL (styled entirely inline —
an outlier), numbered section rails with auto "Next →" advance, the NextStepFooter flow ring,
DecisionLoopPipeline on Overview, the reproducibility capsule.

**⌘K.** Twelve static commands, plain `.includes()` matching, three hardcoded symbols, no recents
(`components/header/CommandBar.tsx`).

**Charts.** All hand-rolled SVG over `components/chart-kit.tsx`. No chart animates.

**The canonical metric primitive** is `PageMetric` (`components/workspace/PageHead.tsx`);
`StatTile`, `KpiDeck`'s card and `Verdict`'s inline metric are unconsolidated second-tier
patterns.

## 2. Constraints — test-enforced, non-negotiable

| Test | Property it pins |
|---|---|
| `tests/theme.test.ts` | the two dark-theme CSS blocks stay byte-identical; text colours use `-text` tokens (AA arithmetic-checked) |
| `tests/layering.test.ts` | every z-index resolves to a `--z-*` ladder token |
| `tests/dead-css.test.ts` | unreferenced-class ratchet (baseline 29, floor 23): a new class must be rendered in the same commit |
| `tests/tailwind-bridge.test.ts` | bridged tokens must exist in globals.css; preflight never loads |
| `tests/workspace-routing.test.ts` | tab + rail lists byte-identical across all three complexity tiers |

House rules: no new npm dependencies (everything hand-rolled), no emoji in UI, no colour-only
meaning, honest labels ("mocked", "from this browser's run log"), `prefers-reduced-motion`
respected everywhere.

## 3. Two cross-cutting decisions

**"Strategies tried" is derived, never separately persisted.** New pure module
`lib/strategy-progress.ts` computes per-strategy `{runs, bestVerdict, lastRunAt}` and per-family
rollups from the existing experiment log. A second store would immediately disagree with the log,
which caps at 60 and dedupes. Every surface that shows the state labels its provenance — *"from
this browser's run log (last 60 runs)"* — because the state can regress on eviction, and a
counter that cannot regress would be claiming memory the system does not have.

**Documents live where their readers look.** This plan at the repository root; the audit and the
tour in `docs/` beside `LATENCY_BUDGET.md`, linked from the root README. The tour covers the
whole infrastructure (portal, gateway, operator modes, Oracle/Supabase), not just the web app.

---

## Slice 1 — The three documents

- **This file.** The status column above is updated as slices ship.
- **`docs/UI_IMPROVEMENTS.md`** — the audit: verdict first, the DSR boundary sentence, every
  finding from §1 with file:line, one recommendation per slice in the form *"Do X; the
  alternative Y fails because Z"*, a **deliberately-not-done** section (chart library, animation
  library, achievement system, seven new family colour tokens, KpiDeck conversion — each with its
  negation), and the constraints ledger from §2.
- **`docs/FEATURE_TOUR.md`** — the walkthrough, structured as the decision loop itself
  (Overview → Research → Execution → Portfolio → Risk → Data → Reliability → Developer). Per tab:
  the question it answers, the 60-second click path using real section names, the one moment
  worth showing (promotion gate clearing, an order rejection's full gate vector, the kill switch,
  stress-test hand shocks, the sandbox toggle), and keyboard access (Alt+1–8, ⌘K). Plus:
  - **Zero-config** features (keyless Binance + Bybit: sweeps, all 46 strategies, depth, TCA) vs
    **keyed** (equities via FMP/Tiingo/Massive/AlphaVantage) vs **gateway-backed** (live book,
    orders) vs **operator-gated**, including the three guard modes (`locked` / `token` /
    `open-demo` via `ALPHAENGINE_OPERATOR_OPEN=1` — `lib/operator.ts:90`).
  - Live URLs (`https://developer-analyst-infra.vercel.app`, the OCI gateway) and the 11 E2E
    probes from `tools/e2e_smoke.py` as a verify-it-yourself checklist; local `npm run dev:all`.
  - The order-ticket presets (Valid $25k / Fat finger $500k / Rate-limit burst) as the guided
    demo of the pre-trade gates; the Oracle keepalive caveat (a stopped Always-Free ADB is the
    usual reason the VaR panel reads "unavailable").

**Verify:** `npm test` stays green (markdown is scanned by no test — the docs are inert); every
recommendation names its negated alternative.

## Slice 2 — Motion foundation

Files: `app/globals.css`, new `components/common/NumberTicker.tsx`,
`components/overview/KpiDeck.tsx` (first adoption), new `tests/motion.test.ts`.

- **Tokens** (base `:root` only — the dark-block parity test compares the two dark blocks with
  each other, so base-block additions are inert):
  `--dur-slow: 240ms`, `--dur-reveal: 420ms`, `--dur-draw: 700ms`,
  `--ease-out: cubic-bezier(0.16,1,0.3,1)`, `--ease-emphasized: cubic-bezier(0.3,0,0,1)`,
  `--ease-pop: cubic-bezier(0.34,1.56,0.64,1)`. The overshoot easing is **reserved for exactly
  one moment** (Slice 4's gate-clear); scarcity is what keeps it Apple rather than arcade.
- Consolidate the seven hardcoded durations onto tokens.
- **One reduced-motion contract**: delete the nuclear block; keep a single 1ms-duration block
  (preserves end-states and `animationend`); update the two prose comments (:3183, :12514) that
  describe the old behaviour.
- **NumberTicker**: rAF count-up over 420ms, cubic ease-out; reserves its final width
  (`--ticker-w: <final>ch` + tabular `.num`) so counting never reflows neighbours; animates
  **only on value change, never on mount** — a page counting up from zero on load is a slot
  machine, which is the gamification boundary; reduced-motion renders the final value instantly.
  First adoption: KpiDeck's four values.
- **`tests/motion.test.ts`**: exactly one reduce block; no literal-ms transitions outside the
  token block (comment-blanked source scan); NumberTicker carries the reduced-motion guard.

**Verify:** `npm test && npm run typecheck`; with OS reduce-motion on, hover states land
instantly rather than dying.

## Slice 3 — The Strategy Codex

The collection mechanic, played straight: a browsable reference library of all 46 strategies
with explored-state. **Nothing is ever locked** — gating capability behind usage is the
navigation fork the complexity-tier system exists to prohibit.

Files: new `lib/strategy-progress.ts` + `tests/strategy-progress.test.ts`, new
`components/research/StrategyCodex.tsx`, `components/Controls.tsx`, `app/page.tsx`,
`app/globals.css`.

- New research rail section `codex` ("All 46 models, by family"), added as **secondary**
  alongside `runs` — reference material, outside the numbered spine. The `!data` empty-state map
  at `page.tsx:951` is explicitly bypassed: a reference library that demands a completed run is
  wrong.
- Seven family groups, each: family name, one-line thesis, honest progress ("explored 3 of 9 ·
  from this browser's run log"), over a card grid. Card: label, summary, the first line of
  *when it fails* (the honest half), and an explored chip — `●  best: PASS` versus hollow
  `◌ not yet run` (glyph, never colour alone). Click selects the strategy and jumps to Summary;
  `similar[]` renders as lateral links.
- **Family identity without new colour tokens** (theme-test constraint): a monogram glyph, the
  printed family name, and one `--codex-accent` custom property per group derived by `color-mix`
  from existing series tokens.
- **The picker**: the flat select gains 7 `<optgroup>`s — the first rendering `STRATEGY_FAMILY`
  has ever had — with "— run" appended to tried options.
- Entry motion is free: codex children are `.workspace-subtab-panel > *`, already covered by the
  scroll-driven `rise-in`.

**Verify:** `npm test` (the new section is static and tier-invariant by construction;
`#research/codex` deep-links — the hash validator is list-driven); one sweep marks one card
explored; clearing localStorage hollows all.

## Slice 4 — The research journey

The badge moment as **evidence assembly, not celebration**.

Files: `components/research/PromotionPanel.tsx`, `components/Verdict.tsx` (classes only),
`components/WorkspaceSubtabs.tsx`, `app/page.tsx`, `app/globals.css`.

- **PromotionPanel sequenced reveal**: the gate list is keyed by `data.dataHash` so re-render ≠
  re-animate and resize ≠ re-animate; each of the six gates staggers in at 70ms steps
  (`--stagger-i`, `rise-in var(--dur-slow) var(--ease-out) both`). The cleared-count ticks up via
  NumberTicker. When eligibility flips false→true, the Promote button pulses **once** — scale
  1→1.02→1, `var(--ease-pop)`, removed on `animationend`. The sole overshoot in the product.
- **Verdict**: the PASS/MARGINAL/FAIL pill renders immediately — the answer never waits — then
  the six metrics stagger at 40ms.
- **Rail progress**: visited sections' numbers cross-fade to ✓ (glyph, not colour;
  `aria-label` gains ", visited"). Per-session state, deliberately not persisted: a marker that
  survives reload claims memory of a session that no longer exists.

**Verify:** cascade fires once per new result, never on hover or resize; reduced-motion shows
rows instantly.

## Slice 5 — Live-data theatre

Files: `components/LiveMarket.tsx`, `components/execution/OrderTicket.tsx`,
`components/execution/PnlStrip.tsx`, `components/PortfolioWorkspace.tsx`, `app/globals.css`.

- **Watchlist tick flash**: on price change, a 600ms translucent background fade
  (`color-mix` on the status fills), direction-classed. Redundant emphasis only — the signed 24h%
  with its sign glyph already sits beside the price, which is what the no-colour-only rule
  requires.
- **Order-ticket gate cascade**: the check vector (up to 14 gates) staggers at 40ms steps, delay
  capped at 480ms, keyed by decision id. The verdict banner enters via `@starting-style` (it is
  conditionally rendered — precisely that feature's use case). "Decided in X ms" ticks up via
  NumberTicker: counting up to a sub-millisecond figure is the honest flex.
- **The book**: PnlStrip and the portfolio equity headline adopt NumberTicker (15s poll — at
  most one tick per poll, no thrash).

**Verify:** flashes are directional against live venue data; a rejected preset order cascades
and the failing gate is findable with motion off.

## Slice 6 — Charts alive

Files: `components/chart-kit.tsx`, `components/EquityChart.tsx`, `components/PriceChart.tsx`,
`components/Heatmap.tsx`, `app/globals.css`.

- **`AnimatedPath`** in chart-kit: `pathLength={1}` normalisation so one CSS rule
  (`stroke-dashoffset 1→0` over `var(--dur-draw)`) fits every line. **The animation key is data
  identity** (`dataHash`, series length + last timestamp) — never width: `useMeasuredWidth`
  re-renders on every drag, and a width-keyed path would replay its draw on resize.
- Adoption: equity strategy line, benchmark delayed 120ms (the race reads as a comparison);
  price close line. **The Monte Carlo cone fades in — opacity only. A scaling cone would briefly
  draw a narrower uncertainty band than was computed; the animation would lie.** The Sparkline
  gets nothing: drama on a 40px chart is noise.
- **Heatmap**: cells cascade along the diagonal (`(row+col) × 12ms`, capped 360ms) — a wavefront
  that restates the panel's actual message: this grid was searched.
- Crosshair and tooltip gain opacity transitions only; **position stays instant** — a lagging
  crosshair misreports which bar you are on, and correctness beats smoothness.

**Verify:** draws once per new result; drag-resizing replays nothing; reduced-motion shows
completed charts.

## Slice 7 — Navigation

Files: `app/page.tsx`, `components/header/CommandBar.tsx`, new `lib/command-score.ts` +
`tests/command-score.test.ts`, `app/globals.css`.

- **View Transitions** (progressive, Chromium — the same posture `rise-in` already takes):
  `navigate()` wraps its state change in `document.startViewTransition(() => { flushSync(apply);
  window.scrollTo({top: 0, behavior: "auto"}); })`. The sticky header carries
  `view-transition-name: workspace-header` — the stable frame that makes the swap read as content
  changing. `html.is-vt .view-panel { animation: none }` suppresses the `panel-in` double-fire;
  the existing smooth scroll moves inside the callback as `auto` so it cannot race the snapshot.
- **⌘K, grown up**: a hand-rolled ~40-line subsequence scorer (`lib/command-score.ts`,
  unit-tested — prefix, word-boundary and consecutive-run bonuses); command sources passed as
  props from `page.tsx`, which already owns every list — all 8 tabs, all 32 rail sections, **all
  46 strategies** ("Model: Hull trend — Trend" selects and navigates), every research symbol, the
  kill switch. **Recents** (ids only, max 8) in localStorage under the same guarded pattern as
  the experiment log, shown when the query is empty. The dialog enters via `@starting-style`
  scale 0.98→1; **list selection movement stays instant** — palette latency is felt in single
  milliseconds.

**Verify:** Chromium cross-fades under a static header; Firefox/Safari keep `panel-in`; "hull"
finds the strategy; recents survive reload; Escape and focus restoration remain native.

## Slice 8 — Consolidation, honesty sweep, tour finalisation

Files: `components/Verdict.tsx`, `app/globals.css`, `lib/strategy-docs.ts`,
`components/research/StrategyDocCard.tsx`, both docs, possibly `tests/dead-css.test.ts`
(baseline only).

1. **Verdict's inline styles become classes** (`.verdict-card/-pill/-metric…`), tones via
   `data-tone` attribute selectors over the existing status-fill and `-text` tokens — which keeps
   the AA contract green by construction.
2. Tile rationalisation, cheap subset only. **KpiDeck stays on the Tailwind bridge**: converting
   it buys pixel parity nobody sees and risks bridge-test churn.
3. Stale prose: "twenty-six" → "forty-six", both files.
4. Reduced-motion and a11y audit of everything added in Slices 2–7: every animation inside the
   single reduce block's reach; every motion signal has a static twin (flash ↔ sign glyph,
   visited ↔ ✓, cascade ↔ pass/fail marks).
5. dead-css ratchet: if deletions push the unreferenced count below the floor, lower the
   baseline in the same commit, as the test's own comment instructs.
6. **The tour's final pass** appends the shipped moments (codex, gate cascade, ⌘K recents, view
   transitions) into the existing tab spine; the audit doc gains a closing shipped-vs-deferred
   table; this file's status column reads *shipped* eight times.

**Verify:** `npm test && npm run typecheck && npm run build`; production E2E smoke; a manual
walkthrough following `docs/FEATURE_TOUR.md` itself — the tour doubles as the acceptance script.

---

## Risk register

| Risk | Slice | Mitigation |
|---|---|---|
| Reduced-motion consolidation changes dependants of the nuclear block | 2 | 1ms pattern preserves end-states and events; manual pass in 2, re-audit in 8 |
| NumberTicker layout shift, or slot-machine feel | 2 | final-width reservation; animate on change only, never mount |
| Codex vs the `!data` empty-state map | 3 | explicit bypass at `page.tsx:951`; the codex renders runless |
| Family colours vs the theme test | 3 | zero new colour tokens; glyph + printed name + `color-mix` accent |
| Animations replaying on re-render or resize | 4–6 | React keys are data identity (`dataHash`, decision id) — never width |
| An animated MC cone misstating uncertainty | 6 | opacity fade only, no scale |
| View Transitions double-firing `panel-in`, racing smooth scroll | 7 | `html.is-vt` suppression; `flushSync`; scroll moved inside the callback |
| dead-css ratchet in both directions | all | every class ships with its renderer; baseline check in 8 |
| Gamification creep | all | one overshoot easing, used once; progress derived from the honest run log; the DSR boundary sentence in §0 is the acceptance test |

## Sequencing

1 (documents) → 2 (the tokens everything else consumes) → 3 (codex) → 4 (journey) → 5 (live) →
6 (charts) → 7 (navigation) → 8 (sweep). Each slice commits with the full suite green and pushes,
so production advances incrementally and any slice is a safe stopping point.
