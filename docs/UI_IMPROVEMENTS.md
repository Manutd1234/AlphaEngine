# UI Improvements — the audit behind the overhaul

*The audit (§1–3) is kept as it was written, because it is the acceptance test the slices
were built against; the ledger (§4) and the closing table (§5) are current to 2026-08-17 and
carry the passes that followed the eight slices.*

**Verdict first.** The workspace's engine outgrew its chrome. Forty-six documented strategies
hide behind a flat `<select>`, the promotion gate — the most dramatic moment in the product —
renders as a static list, and a 12,900-line design system contains exactly three animations.
The overhaul that followed fixed this in eight independently shippable slices, each one
findable in [`FEATURE_TOUR.md`](FEATURE_TOUR.md). This document is the audit the overhaul
stands on: every finding cites file and line, every recommendation names the alternative it
rejects, and the final section lists what was deliberately *not* done. The plan document that
sequenced the slices is a working note kept outside this repository; the audit is the part
worth reading, because it is the part that has to survive contact with the code.

**The boundary, stated once.** No confetti, no XP, no streaks, no locked content — a research
tool that celebrates output volume rewards exactly the multiple-testing behaviour the Deflated
Sharpe Ratio exists to punish. Engagement here means the interface makes evidence *feel* like
evidence, not that it makes running sweeps feel like winning. Every slice is accepted or
rejected against that sentence.

Paths below are relative to `Part2_Infrastructure/web`.

---

## 1. Findings

### Motion

- **Tokens.** `--dur-fast: 110ms`, `--dur: 170ms`, one `--ease` (`app/globals.css:125-127`).
  Nothing slower exists, so nothing can *reveal* — every state change is a cut.
- **Three `@keyframes` in 12,900 lines**: `shimmer` (skeletons), `panel-in` (tab entry), and
  `rise-in` — the most advanced motion in the file, scroll-driven via
  `animation-timeline: view()`, correctly progressive on Chromium.
- **Seven `transition:` declarations hardcode durations** instead of using the tokens
  (`globals.css:1214, 1417, 1488, 4580, 5604, 10376`), so a global timing change misses them.
- **Two conflicting `prefers-reduced-motion` blocks.** The nuclear
  `* { animation: none !important }` at `globals.css:1424` wins over the correct 1ms-duration
  block at `globals.css:11301`, making the latter dead code. Worse than dead: `animation: none`
  strips `animationend`, so any JavaScript sequenced on animation completion silently never
  fires for reduced-motion users.

### The catalogue

- **46 strategies with full documentation** — summary, formula, when it works, when it fails,
  similar strategies (`lib/strategy-docs.ts`) — and a 7-family taxonomy
  (`STRATEGY_FAMILY`, `lib/types.ts:74`) that **no component renders**.
- The picker is a flat 46-option `<select>` (`components/Controls.tsx:260`). There is no
  gallery, no grouping, no indication of which models this browser has already tried.
- Stale prose says "twenty-six" in `lib/strategy-docs.ts:5-15` and
  `components/research/StrategyDocCard.tsx:8-14`; the catalogue has been 46 for some time.

### Progression that already exists (build on, never duplicate)

- The experiment trail: `lib/experiments.ts` — localStorage, 60-record cap, request-deduped.
- The six-veto `PromotionPanel` — the natural "badge moment", currently a static list.
- `Verdict` PASS / MARGINAL / FAIL — styled entirely inline, an outlier in a token system.
- Numbered section rails with auto "Next →" advance; the `NextStepFooter` flow ring;
  `DecisionLoopPipeline` on Overview; the reproducibility capsule on Research → Summary.

### ⌘K

Twelve static commands, plain `.includes()` matching, three hardcoded symbols, no recents
(`components/header/CommandBar.tsx`). The palette knows less about the app than the app does:
`page.tsx` owns every tab, rail section, strategy and symbol list, and passes none of them in.

### Charts

All hand-rolled SVG over `components/chart-kit.tsx`. No chart animates — results appear as
cuts, which wastes the one moment a research tool has to show *how much work just happened*.

### Metric primitives

The canonical one is `PageMetric` (`components/workspace/PageHead.tsx`); `StatTile`,
`KpiDeck`'s card and `Verdict`'s inline metric are unconsolidated second-tier patterns.

---

## 2. Recommendations, one per slice

Each in the form *"Do X; the alternative Y fails because Z."*

1. **Documents first** (this file, the plan, the tour). The alternative — ship code and
   document later — fails because the audit is the acceptance test for the slices; written
   after, it becomes a description of whatever shipped.
2. **One motion foundation: slower tokens, one reduced-motion contract, one NumberTicker.**
   The alternative — each slice adding its own durations and easings ad hoc — fails because
   that is exactly how the current file got seven hardcoded transitions and two contradictory
   reduce blocks.
3. **A Strategy Codex: browsable reference library, explored-state derived from the run log.**
   The alternative — a separately persisted "tried" store — fails because the log caps at 60
   and dedupes, so a second store would immediately disagree with it. The other alternative —
   locking content until explored — fails the boundary sentence outright.
4. **Sequence the promotion gate and verdict as staggered evidence assembly.** The
   alternative — celebration effects on PASS — fails because a PASS here is a statistical
   claim, not a win; drama belongs to the *assembly* of the six gates, not the outcome.
5. **Tick flashes and gate cascades on live surfaces, keyed by decision identity.** The
   alternative — animating on every render — fails because re-render and resize are not
   events; replaying a flash on resize misreports data movement.
6. **Draw-in for lines via `pathLength` normalisation; opacity-only for the MC cone.** The
   alternative — scaling the cone in — fails because a scaling cone briefly draws a narrower
   uncertainty band than was computed: the animation would lie about the statistics.
7. **View Transitions for tab swaps; a real fuzzy scorer and recents for ⌘K.** The
   alternative — a routing/animation library — fails the no-new-dependencies house rule, and
   the hand-rolled scorer is ~40 unit-tested lines.
8. **A closing consolidation and honesty sweep.** The alternative — trusting slices 2–7 to
   have stayed within the reduced-motion and a11y contracts — fails because those contracts
   are exactly where drift is silent; the sweep is the assertion.

---

## 3. Deliberately not done

Each with its negation, because a list of omissions without reasons reads as a backlog.

- **No chart library.** The charts are hand-rolled SVG over `chart-kit.tsx` and stay that way;
  a library buys animation we can write in one CSS rule and costs a dependency the house rules
  prohibit.
- **No animation library.** Every motion in the plan is CSS keyframes, transitions, or a
  single rAF counter. Framer Motion is 40kB to do what `@starting-style` and
  `animation-timeline` already do natively.
- **No achievement system.** Badges, XP, streaks and completion meters fail the boundary
  sentence: they reward run *volume*, which is the multiple-testing behaviour the DSR gate
  exists to punish. Explored-state is a research ledger, not a score.
- **No locked content.** Gating capability behind usage is the navigation fork the
  complexity-tier system exists to prohibit; everything is reachable on first load.
  `/profile` is no exception — it manages the account itself and unlocks no desk
  capability.

  This bullet used to add that the sign-in at `/login` "is optional, gates nothing, and
  the whole desk stays browsable without an account". That was true until the desk moved
  behind a routing guard at `/dashboard`, and the sentence is corrected rather than
  quietly left standing. **Nobody is turned away, and no capability is behind an
  account**: `/login` offers "Continue as guest", which mints a pass and opens the full
  workspace on generated data, and a deployment with no Supabase credentials — which is
  the public one — is granted that pass automatically by the guard rather than being sent
  to a form that cannot help. What an account buys is preferences that follow you between
  devices. What changed is only *when* the question is asked: before anything renders,
  rather than after the whole shell has been painted at a stranger.
- **No seven new family colour tokens.** The theme test pins the dark-theme token blocks
  byte-for-byte; family identity comes from a monogram glyph, the printed name, and a
  `color-mix` accent derived from existing series tokens.
- **No KpiDeck conversion off the Tailwind bridge.** Converting it buys pixel parity nobody
  sees and risks `tailwind-bridge` test churn; it adopts NumberTicker without restyling.
- **No persisted rail-visited state.** A visited marker that survives reload claims memory of
  a session that no longer exists; per-session state only. Scoped to *visited* markers: the
  viewing preferences (theme, detail level, last-open tab) do persist, and sync to the
  signed-in account, because a preference someone set is a fact about them rather than a
  claim about a session.

---

## 4. The constraints ledger

Test-enforced properties every slice must keep green:

| Test | Property it pins |
|---|---|
| `tests/theme.test.ts` | the two dark-theme CSS blocks stay byte-identical; text colours use `-text` tokens (AA arithmetic-checked) |
| `tests/layering.test.ts` | every z-index resolves to a `--z-*` ladder token |
| `tests/dead-css.test.ts` | unreferenced-class ratchet (baseline 24 as of 2026-08-17, and no more than six below it — a baseline far above reality stops being a ratchet): a new class must be rendered in the same commit |
| `tests/tailwind-bridge.test.ts` | bridged tokens must exist in globals.css; preflight never loads |
| `tests/workspace-routing.test.ts` | tab + rail lists byte-identical across all three complexity tiers |
| `tests/motion.test.ts` *(Slice 2)* | one reduce block that collapses durations rather than deleting animations, no literal-duration transitions outside the token ladder, NumberTicker's mount/reduce guards |
| `tests/house-rules.test.ts` | the rules that were written down and never enforced — no emoji in any component or route (the typographic glyphs stay), every `pulse-live` element is aria-hidden decoration, an empty result is reported rather than hidden — with the two shipped emoji violations (provider counts, kill switch) as the reason it exists |
| `tests/forced-colors.test.ts` | Windows High Contrast: nothing means by colour alone |
| `tests/type-scale.test.ts` | one type scale in `:root` (9.5 → 28px, fourteen rungs), two font stacks, inline sizes on the scale; sanctioned exceptions annotated at their declaration |
| `tests/accent-budget.test.ts` | the saturated `--series-1` fill belongs to controls that commit something; a selected segment is not one of them (BUY/SELL is the deliberate exception, asserted as hard as the rule) |
| `tests/null-honesty.test.ts` | an unmeasured number is dashed, not zeroed; an unanswered order says so; legends are lists without bullets |
| `tests/live-motion.test.ts` | live values move (NumberTicker, freshness affordances) and honest absences stay still; durations wear the unit their magnitude earns |
| `tests/interaction.test.ts` | links respond, disabled fields say so, elevation only for what floats, 44px for coarse pointers, chrome offsets measured |
| `tests/decision-latency.test.ts` | the header chip headlines the gateway's in-process decision p99 from the model, the network figures are demoted to the title, Reliability teaches the two planes apart, no per-order ms sneaks back beside the µs |
| `tests/header-ladder.test.ts` | the header's nine-rung priority ladder: each rung takes only what it says, the essentials are never on it, the row wraps at 1090, tabs one rung above the chips and every chip word 12px |
| `tests/tour-truth.test.ts` | `docs/FEATURE_TOUR.md` names every rail section the app ships and quotes the 43-section total |

House rules, enforced by test since `house-rules.test.ts` and by review before it: no new npm
dependencies, no emoji in UI, no colour-only meaning, honest labels ("mocked", "from this
browser's run log"), `prefers-reduced-motion` respected everywhere.

---

## 5. Shipped versus deferred — the closing table

Every slice shipped; the deliberately-not-done list in §3 held. What each slice left behind:

| Shipped | Where to see it |
|---|---|
| Motion ladder (5 durations, 3 easings), one 1ms reduce contract | `globals.css` `:root`; the single `@media (prefers-reduced-motion: reduce)` block |
| NumberTicker (change-only, width-reserving, reduce-guarded) | KpiDeck, promotion cleared-count, "decided in X ms", PnlStrip, portfolio equity |
| Strategy Codex + `lib/strategy-progress.ts` + picker optgroups | Research → Codex; the Model select |
| Gate assembly, verdict stagger, one `--ease-pop` pulse, rail ✓ | Research → Decision and Summary; the research/execution rails |
| Tick flashes, order-gate cascade, `@starting-style` banner | Execution → Trade |
| AnimatedPath (`pathLength=1`), opacity-only MC cone, heatmap wavefront | Research → Summary and Parameters |
| View Transitions under a named stable header; `html.is-vt` suppression | any tab switch on Chromium |
| ⌘K: unit-tested subsequence scorer, ~95 commands from `page.tsx`, recents | `lib/command-score.ts`; `tests/command-score.test.ts` |
| Verdict converted to classes with `data-tone` over token pairs | `components/Verdict.tsx`; the `.verdict-*` block |

| Deferred, deliberately | Why it stays deferred |
|---|---|
| StatTile / KpiDeck / PageMetric consolidation into one primitive | pixel parity nobody sees; bridge-test churn risk — Verdict's conversion was the cheap, high-value subset |
| Chart library, animation library, achievement system, locked content, family colour tokens, persisted rail state | §3 — each negation still holds after eight slices |
| Historical "twenty-six" prose in `benchmark.test.ts` / `route.ts` comments | those describe a past coercion bug at its historical size; rewriting history is its own dishonesty. Present-tense claims were updated to forty-six |

### Since the eight slices — the passes that followed, to 2026-08-17

Same boundary sentence, same test-first shape. Each row names the finding it answered, in
the audit's own form, and where to see it.

| Shipped | Finding it answered | Where to see it |
|---|---|---|
| **One type scale** (2026-08-16): forty distinct font sizes — a half-pixel px ramp, pt, em and rem naming nearly the same steps — became fourteen `--fs-*` rungs from 9.5 to 28px, two font stacks, and a `<small>` that defaults to the reading floor rather than the UA's 8.3px | adjacent rungs no reader could tell apart and no author could choose between; sizes off the scale by ratios no rung named | `globals.css` `:root`; `tests/type-scale.test.ts` |
| **The moving desk** (2026-08-16): NumberTicker and the freshness affordances reach Data, Reliability, Developer, Research and Execution; the header carries the workspace heartbeat; a counting figure keeps its figure's size; the animation shorthand joined the motion ladder | "not dynamic" meant two things — no hover/pulse/transition, and figures that did not move on poll — and neither may ever replace a dash with a zero or a "Collecting" gate with a confident number | any console on poll; `tests/live-motion.test.ts`, `tests/null-honesty.test.ts` |
| **The header chip headlines the decision, not the network** (2026-08-17): DECISION P99 in µs from the gateway's in-process histogram, the compiled core's ns figure beside it, network p99 demoted to the title and the Reliability tiles; before the first order the chip reads `— · core N ns · no orders yet` and its title names the startup self-measure as the provenance | the one chip on every tab quoted a Vercel-hop millisecond figure under a label a reader took for the risk decision | `WorkspaceHeader`, `lib/overview-state.ts` (`formatDecisionChip`); `tests/decision-latency.test.ts` |
| **The Reliability tiles say which plane** (2026-08-17): decision µs, core ns and network ms as three tiles that never blend, the core tile carrying `· self-measure 300` (its title saying which samples those are) when that is where its number came from, and the guide teaching the planes apart | three units on one surface with nothing saying which was which | Reliability → Attention & SLIs; `tests/decision-latency.test.ts` |
| **The header's priority ladder** (2026-08-17): nine small rungs from 1860px down to 1170px — the Search label and the providers sentence's short form, the chip's state word, the Settings label, the data-tier label, the Connect label, the providers chip to its dot, the brand tagline and tab padding, the decision figure to its gauge, and last the Kill switch and Sign in labels — each measured to land just before the next clip; Settings, the account chip, the kill switch and the tabs are never on it; the core annotation is *not* a rung because it adds no width | `.workspace-header__utility` is `overflow-x: clip`, so a fully-labelled row (~1805px as a guest) silently lost Settings from 1722px down and by 298px at 1381 — the band that first replaced it folded 250px of labels at once at 1700 | the "The header's priority ladder" comment in `globals.css`; `tests/header-ladder.test.ts` |
| **Larger header type** (2026-08-17): tabs at `--fs-xl` (13px), every chip word at `--fs-md` (12px) — the data tier, the providers sentence, Settings, Kill switch, Sign in and Connect — with the ladder re-measured for the new widths | the row's words sat one and two rungs under the panels they opened | the same comment; the "one size class" contract in `tests/header-ladder.test.ts` |
| **The Telegram companion became interactive** (2026-08-17): inline keyboards on the command centre, tab and section cards, callback dispatch gated on the tapper (never the tapped message's author), refresh edits the card in place and degrades to a fresh send, sixteen chart generators; 114 commands catalogued from the one registry that drives dispatch, with README §6 and the live checklist generated from it | a text-only companion whose docs counted its commands by hand and drifted three times | `modules/telegram.py`, `modules/telegram_charts.py`; `tests/test_telegram_interactive.py`, `tests/test_telegram_docs.py` (gateway suite) |

What did *not* change: no new dependency for any of it, no emoji, no colour-only meaning,
one reduce block, and every one of the eight slices' tests still green (2,313 web tests across
592 suites on 2026-08-17).
