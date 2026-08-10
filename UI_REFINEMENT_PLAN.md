# UI Refinement Plan — the second pass: from overhauled to instrument-grade

**The conclusion first.** The overhaul ([`UI_OVERHAUL_PLAN.md`](UI_OVERHAUL_PLAN.md), eight
slices, all shipped) gave the workspace its motion system, its codex, its journey and its
palette. What it deliberately did not do — and what a fresh audit of the shipped state shows —
is finish the *instrument* qualities that no animation can supply: the keyboard can reach the
parameter grid but not steer it, a completed sweep changes the verdict silently for a screen
reader, 13,421 lines of CSS contain zero `@media print` and zero `forced-colors` support, and
⌘K can go everywhere but *do* nothing. This plan closes those in six independently shippable
slices.

The boundary sentence carries over unchanged, because it is still the acceptance test: **no
confetti, no XP, no streaks, no locked content — a research tool that celebrates output volume
rewards exactly the multiple-testing behaviour the Deflated Sharpe Ratio exists to punish.**
This pass adds no new motion at all; the ladder is complete, and more animation now would be
subtraction.

| Slice | Deliverable | Status |
|---|---|---|
| 1 | This plan, at the root where its reader looks | shipped |
| 2 | Keyboard instrument: heatmap roving grid, visible SVG focus, verdict live region | pending |
| 3 | ⌘K verbs: run, pin, toggle band, theme, copy deep link | pending |
| 4 | One metric grammar: StatTile joins the token classes; dead CSS down | pending |
| 5 | Forced-colors and contrast: the UI survives Windows High Contrast | pending |
| 6 | Narrow screens and paper: the 720/520 pass, and the tear sheet prints | pending |

---

## 1. Audit — what the shipped state actually lacks (claims verified against source)

Root: `Part2_Infrastructure/web`. Paths relative to it.

**The heatmap is tabbable but not steerable.** Every selectable cell carries `tabIndex={0}`
(`components/Heatmap.tsx:229`) and no arrow-key handler exists, so a 20×20 sweep is up to 400
consecutive tab stops between the rail and the results table. Worse: no `rect:focus` or
`:focus-visible` rule anywhere in `globals.css` targets SVG cells, so the keyboard position is
*invisible* — the global focus ring at `:11310` covers `button, a, [role="tab"], summary` only.
The rects already have `role="button"`, per-cell `aria-label`s and Enter/Space handlers; the
missing halves are a roving tabindex and a visible ring.

**Results arrive silently for screen readers.** The one `aria-live` region in the research
flow belongs to the corpus search (`components/research/ResearchCorpus.tsx:103`). A sweep
completing — the event the whole tab exists for — updates the Verdict pill, six metrics and
four charts with no announcement. The warning banners have `role="status"`; the *result* does
not.

**⌘K knows every noun and no verbs.** The palette reaches all 8 tabs, 33 sections, 46 models
and every symbol (`app/page.tsx`, the `commands` memo), but cannot run the sweep, pin the run,
toggle the Monte Carlo band, switch the theme, or copy a link to the current view — five
actions whose UI affordances all exist elsewhere (`Run now`, `Pin run`, the chart toggle,
`ThemeToggle`, the hash routing).

**The metric primitive count is still four.** `PageMetric` (canonical), `KpiDeck`'s bridge
card (deliberately kept), the new `.verdict-metric` classes — and `StatTile`, still inline-ish
and still imported by exactly two surfaces (`app/page.tsx` research tiles,
`components/LiveMarket.tsx`). The overhaul converted Verdict and deferred the rest; StatTile is
the remaining cheap convergence, and the dead-css ratchet (baseline 29, floor 23) has room to
fall when its duplicated styles collapse into the shared grammar.

**High-contrast modes get nothing.** Zero `forced-colors` and zero `prefers-contrast` queries
in the stylesheet. The design leans on `color-mix` washes (tick flash, codex accents, verdict
pill, ladder depth bars) — exactly the decoration Windows High Contrast strips. The glyph
discipline (✓/✕, ●/◌, sign glyphs) means *meaning* mostly survives; the *containers* don't:
washes vanish without replacement borders.

**Nothing prints.** Zero `@media print` rules. The research tab is an evidence pack — verdict,
reproducibility capsule, gate vector, walk-forward table — that a desk would physically carry
into a meeting, and printing it today emits a dark sticky-chromed app shell.

**Narrow screens, two known rough edges.** The section rail scrolls horizontally with its
scrollbar hidden (`globals.css:6515-6524`, `scrollbar-width: none`) and no other overflow
affordance, so off-screen sections simply don't exist on a phone until discovered by accident.
The breakpoint ladder (1120/900/720/520) predates the codex grid, the gate cascade and the
verdict conversion — none of the new surfaces has had a deliberate 520px pass.

**Verified fine, no work needed:** theme boot is flash-free (inline script,
`app/layout.tsx:62-74`); the reduce-motion contract is single and complete
(`tests/motion.test.ts`); rail/tab routing already survives reload and deep links.

## 2. Constraints — unchanged, plus the one the overhaul added

The five test-enforced properties from the overhaul stand (theme parity, z-ladder, dead-css
ratchet, tailwind bridge, tier-invariant routing), joined by `tests/motion.test.ts`: one reduce
block, token-timed transitions, NumberTicker's mount/reduce guards. House rules likewise: no
new npm dependencies, no emoji in UI, no colour-only meaning, honest labels,
`prefers-reduced-motion` respected everywhere. **New rule for this pass: no new animations.**
The ladder is complete; every slice below is structure, reach or resilience.

---

## Slice 2 — The keyboard instrument

Files: `components/Heatmap.tsx`, `app/page.tsx`, `app/globals.css`,
`tests/heatmap-keyboard.test.ts` (new).

- **Roving grid**: one tab stop for the whole surface. The grid tracks a focused cell;
  Arrow keys move it (row/col), Home/End jump within a row, Enter/Space select — the same
  automatic-activation grammar `WorkspaceSubtabs` already uses. Only the focused cell carries
  `tabIndex={0}`; the rest drop to `-1`. The alternative — keeping 400 tab stops — fails
  because a keyboard user pays 400 keypresses to reach the table below.
- **Visible focus**: a `:focus-visible` ring on the cell rects (stroke, not outline — SVG
  outlines are inconsistently painted), using the same `--series-1` the global ring uses.
- **The verdict announces itself**: one polite `aria-live` region near the Verdict mount,
  rendering a one-sentence summary ("Sweep complete: PASS — DSR 0.97, 51 combinations") when
  a *new* `dataHash` lands. Keyed to data identity exactly like the visual reveals, so
  re-renders and resizes announce nothing. The alternative — `aria-live` on the verdict card
  itself — fails because the staggered metric assembly would dribble six partial announcements.

**Verify:** `npm test`; Tab reaches the grid once, arrows steer it, the ring is visible in both
themes; VoiceOver announces one sentence per completed sweep and nothing on resize.

## Slice 3 — ⌘K verbs

Files: `app/page.tsx`, `components/header/CommandBar.tsx` (category ordering only),
`app/globals.css` (nothing expected).

Five commands in a new `Action` category, wired to handlers that already exist:
**Run sweep** (`run()` — the recorded kind), **Pin run** (`pinRun`, disabled-state text when
already pinned), **Toggle Monte Carlo band** (`setShowMcBands`), **Toggle theme** (the
`ThemeToggle` logic, lifted to a shared helper rather than duplicated), **Copy link to this
view** (current hash → clipboard, with the section included — the deep-link work from Slice 7
of the overhaul makes the URL worth copying). Actions appear above navigation on an empty
query only when recently used; the scorer needs no changes. The alternative — a separate
"actions menu" — fails because the palette already owns the muscle memory.

**Verify:** `tests/command-score.test.ts` untouched and green; "run" runs and records; the
copied link restores tab *and* section on paste.

## Slice 4 — One metric grammar

Files: `components/StatTile.tsx`, `app/globals.css`, possibly `tests/dead-css.test.ts`
(baseline down only).

StatTile's look becomes classes on the same token pairs `.verdict-metric` established
(label/value/note scale, `-text` tones via `data-tone`), and its two consumers keep their
markup. **KpiDeck still stays on the Tailwind bridge** — that negation held through the
overhaul and holds here; the bridge test's churn risk hasn't changed. The dead-css baseline is
lowered in the same commit if the collapse pushes the unreferenced count below the floor, as
the test's own comment instructs. The alternative — a grand unification of all four primitives
into one component — fails for the same reason it failed in the overhaul: pixel parity nobody
sees, purchased with regression risk on every tab at once.

**Verify:** `npm test && npm run typecheck`; research tiles and execution probes pixel-match by
eye in both themes; the dead-css count did not rise.

## Slice 5 — Forced colors and contrast

Files: `app/globals.css`, `tests/forced-colors.test.ts` (new, source-scan in the house style).

- One `@media (forced-colors: active)` block: every meaning-bearing wash gains a
  `1px solid` border twin (verdict pill, codex chips and accents, tick-flash container, ladder
  depth bars, status pills), charts keep `currentColor` strokes, and nothing sets
  `forced-color-adjust: none` except the two diverging-scale surfaces (heatmap, depth) whose
  colour *is* the data — each with its glyph/label twin already in place from the overhaul's
  no-colour-alone rule.
- The test pins the properties prose can't: exactly one forced-colors block; `forced-color-adjust: none`
  appears only on the allow-listed data surfaces.
- The alternative — trusting the glyph discipline alone — fails because glyphs survive but
  *grouping* dies: a pill with no background and no border is just floating text.

**Verify:** `npm test`; Windows High Contrast (or Chromium's forced-colors emulation) shows
bordered pills, legible chips, and a heatmap that still reads as a field.

## Slice 6 — Narrow screens and paper

Files: `app/globals.css`, `components/WorkspaceSubtabs.tsx` (attribute only).

- **The rail admits it scrolls**: an overflow fade-mask on `.workspace-subtabs__rail` at its
  scrollable edges (mask, not scrollbar — the hidden scrollbar was a correct call for the
  desktop density; the *affordance* was the missing half), plus `scroll-snap` stops so a swipe
  lands on a whole tab.
- **The 520px pass** over the surfaces the ladder predates: codex grid to one column with the
  family head unwrapped, gate-cascade rows allowed to wrap their detail line, verdict metrics
  to two columns, watchlist price row given truncation room.
- **`@media print` for the evidence pack**: Research prints as a document — chrome, rail,
  controls and NextStepFooter hidden; verdict, capsule, charts, gate vector and tables in
  black-on-white with borders standing in for washes; the honest labels ("from this browser's
  run log", "mocked") *kept*, because paper is where provenance matters most. Charts print at
  their final frame (the draw animation's `forwards` fill already guarantees it).
  The alternative — a PDF export feature — fails the no-dependency rule and rebuilds what the
  browser's print dialog already does.

**Verify:** `npm run build`; a 375px viewport walk of all eight tabs finds no horizontal page
scroll; ⌘P on Research → a legible multi-page document with provenance intact.

---

## Risk register

| Risk | Slice | Mitigation |
|---|---|---|
| Roving tabindex fights the existing Enter/Space handlers | 2 | handlers stay; only `tabIndex` and a `focusCell` state are added — selection logic untouched |
| Live region echoes on re-render | 2 | keyed by `dataHash`, the exact idiom the visual reveals already use |
| Theme toggle logic duplicated into the palette drifts | 3 | lift to one shared helper; the palette and the header button both call it |
| StatTile conversion shifts pixels on Execution | 4 | classes replicate current numbers first, converge second; eye-check both themes before push |
| forced-colors block collides with the theme parity test | 5 | the block sets no colour tokens — system colours and borders only; parity test scans dark blocks, untouched |
| Print styles leak into screen media | 6 | everything under `@media print`; dead-css scan is media-blind, so no ratchet impact |
| Scope creep back into motion | all | the no-new-animations rule in §2; a slice adding a keyframe fails review by definition |

## Sequencing

2 (keyboard + announcements — the largest honest gap) → 3 (verbs — smallest, rides on 2's
testing) → 4 (metric grammar) → 5 (forced colors) → 6 (narrow screens and paper). Each slice
commits with the full suite green and pushes before local verification, so production advances
incrementally and any slice is a safe stopping point. The status column above is updated as
slices ship.
