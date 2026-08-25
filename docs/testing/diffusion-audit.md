# Diffusion tab — audit

What was measured, including what failed. An audit that records only what
passed is a claim rather than a measurement.

Baseline taken **2026-08-25** at `be9e8a3`, before the seven-section
restructure. Gateway on 8912, Next dev on 3000, headless Chrome on 9222.

## 1. Backend — the gateway, direct

All four reads answer 200 with a non-degenerate payload. Checked against the
recorded trap that this API answers 200 with data that looks fine and is not,
so each row states what was asserted beyond the status code.

| Route | Result |
|---|---|
| `GET /api/research/diffusion/absorption?limit=400` | 200, `state: ok`, `backend: sqlite`, **`truncated: false`**, 8 horizons, 2 stages, **248 runs** |
| `GET /api/research/diffusion/findings` | 200, `state: ok`, calendar **62 of 62** verified, gate **passed** at R² 0.742 on 61 samples, study present, **14 findings** |
| `GET /api/research/diffusion/events?limit=50` | 200, `state: ok`, **`events: []`** — served, empty, and read by nothing on the desk |
| `GET /api/coherence/episodes?limit=500` | 200, **`state: "empty"`** — 0 closed, 0 open, `median_withheld_reason` set, `round_trip_s` 0.240 |
| `GET /health` | 200, `status: ok`, audit backend duckdb, telegram `mode: send-only` (correct for a local gateway) |

## 2. The Next proxy

Same four reads through `http://127.0.0.1:3000/api/gateway/...` with an
`ae_desk` cookie. **All four pass through with identical shapes and states** —
no renamed field, no dropped list. This is the layer where a rename becomes a
blank panel, so it is checked separately rather than assumed.

## 3. Payload quality — what the tab actually has to draw

    runs                 248        signal ok 89        no_signal 159
    stage split          release 124 / call 124
    measured             release 42 / call 47
    median half-life     release 165.5s / call 727.9s      -> the 4.4x the chip prints
    release_curve        [-, -, 0.426, 0.404, 0.654, 0.841, 0.806, 1.0]
    call_curve           [-, -, 0.016, 0.039, 0.087, 0.501, 0.684, 1.0]

Four findings that change the plan rather than merely confirm it:

**a. The per-horizon count is constant, not variable.** 42 statement stages and
47 press-conference stages at *every* horizon that has a source, and 0 at `1s`
and `30s`. The absorption band's footnote was going to report a per-horizon *n*
that falls along the curve; there is nothing to report. One sentence instead.

**b. The cell-state matrix is degenerate — cut that figure.** All 1,984 cells
hold two of the five possible states, and the state is fully determined by the
horizon:

    1s   unavailable 248        1m … 30m   ok 248 (each)
    30s  unavailable 248

No `pending`, no `uncaptured`, no `insufficient`, and no variation within a
column. A drawing of this carries exactly one fact — the first two horizons
have no source — which the pane's `missing` line already states and the curve
already draws with `◌`. **Drawing it would be the third telling of one claim**,
which is the thing this codebase guards against. Cut, and find another drawing
for the Meetings empty state.

**c. The control percentile is backed by 19 of 89 measured runs — 79% are
unranked.** `controls_used` is **5 for every run**, ranked and unranked alike,
so it distinguishes nothing and cannot be drawn as backing. This is the
strongest honesty finding of the audit: `StageBars` prints a median control
percentile (release 0.0, call 0.5) beside measured counts of 42 and 47, and
those medians rest on 19 runs. The floor view should say so where the number is
read.

**d. The two clocks disagree, substantially — keep that figure and strengthen
it.** All 89 measured runs carry both `half_life_s` and `half_life_vol`, and
**55 of 89 (62%) move more than a tenth of the field** when ranked by one clock
against the other. The magnitudes confirm they cannot share a length axis:
wall-clock runs 60s to 1,402s, the volatility clock 1.2e-07 to 1.2e-04, because
it is a position on accumulated control variance rather than a duration. A rank
slopegraph is the honest form and it has a real signal to show.

## 4. Frontend — and a false alarm worth recording

A peer session reported that tab navigation was broken for every tab on this
tree: deep links staying on Overview, clicks doing nothing, no console errors.
**Reproduced, then diagnosed as a harness fault, not a code fault.**

    _next responses: 68 | http >= 400: 26 | exceptions: 0
    {"hash":"#diffusion/arm","selected":"tab-overview","hydrated":false,"reactKeys":[]}

`next dev` returns **403 for every JS chunk** under Next's `allowedDevOrigins`
guard. The HTML is server-rendered, so the tab row, all eleven buttons and
`#tab-diffusion` are present and hit-testable — but **React never hydrates**,
so no click handler is ever attached and the hash listener never runs. It
presents as a dead tab row with a clean console.

`hydrated: false` is the decisive line: `#tab-diffusion` carries no `__react*`
props at all. The same chunks return **200 to curl**, because the guard keys off
browser-only request headers — which is why a source check and a curl check both
report everything fine.

**Consequence for anyone auditing this desk: `next dev` cannot be driven from
CDP.** Use a production build with `NODE_ENV=development next start` — the
latter is required because `gatewayState` in `web/lib/gateway.ts` returns
`{kind: "loopback"}` outside development and every proxy route then answers
`gateway_misconfigured`.

## 5. Frontend — every section, every view, measured

Production build, `NODE_ENV=development next start -p 3100`, headless Chrome at
1600x1000, `ae_desk` guest cookie, driven over CDP. **Hydration confirmed first**
(`__react*` props present on `#tab-diffusion`, `tab-diffusion` selected from the
`#diffusion/arm` deep link) so that nothing below is measured on a dead shell.

| section | view | height | figures | svg | tables | disclosures | svg `<title>` | keyboard stops |
|---|---|---|---|---|---|---|---|---|
| arm | Absorption | 527 | 1 | 1 | 0 | 0 | **14** | **0** |
| arm | Noise floor | 697 | 2 | 0 | 0 | 0 | 0 | 0 |
| arm | Meetings | 854 | 1 | 1 | 1 | 1 | 24 | 1 |
| arm | Mechanism | 481 | 1 | 1 | 0 | 0 | **5** | **0** |
| episodes | Survival | 342 | 1 | **0** | 0 | 0 | 0 | 0 |
| episodes | Episodes | 251 | **0** | 0 | 0 | 0 | 0 | 0 |
| model | Measurement | **1,260** | **0** | 0 | 0 | 7 | 0 | 0 |
| model | Instrument | **1,015** | **0** | 0 | 0 | 6 | 0 | 0 |
| model | Half-life | 953 | 1 | 1 | 0 | 0 | **9** | **0** |
| model | Simulator | 882 | 1 | 1 | 0 | 0 | **3** | **0** |
| model | Spectrum | 993 | 1 | 1 | 0 | 0 | **3** | **0** |
| findings | Effect plot | 760 | 1 | 1 | 0 | 0 | 14 | 1 |
| findings | Findings table | 1,090 | 1 | 1 | 1 | 0 | 14 | 1 |
| findings | Instrument | 1,019 | 1 | 1 | 1 | 1 | 2 | 1 |

**Zero exceptions and zero HTTP failures across the whole walk.**

Three readings:

- **34 facts are mouse-only.** Absorption 14, Mechanism 5, Half-life 9,
  Simulator 3, Spectrum 3 — every one on a figure with **no keyboard stop**, so
  unreachable from a keyboard and invisible on a touch screen. Only the three
  figures already drawing through `Plot` take a stop.
- **Three views draw nothing.** `Model → Measurement` and `Model → Instrument`
  are the two longest views on the tab and have no figure at all;
  `episodes → Episodes` is a dead pane, and on this deployment it is the LIVE
  state rather than an edge case, because the tape is empty.
- `episodes → Survival` reports one figure and zero SVG: it is the
  `FigureEmpty` branch, not a curve.

## 6. A live rendering fault, measured before and after

Six class families were scoped `.coherence-plane.proofs-plane` while the only
components rendering them sit under `components/coherence/diffusion/**`, which
renders `diffusion-plane`. Computed style in Chrome, same views, before and
after moving the rules into `10c-diffusion-figures.css`:

| property | before | after |
|---|---|---|
| `.coh-floor__buckets` display / height | `block` / **`0px`** | `flex` / `64px` |
| `.coh-floor__bucket` background / flex | transparent / `0 1 auto` | series tint / `1 1 0px` |
| `.coh-floor__bucket.is-unranked` background-image | `none` | the hatched gradient |
| `.coh-model__truth` stroke / dash | **`none`** / `none` | `rgb(82,82,91)` / `4px, 3px` |
| `.coh-model__controls` display / columns | `block` / `none` | `grid` / `757px 757px` |

So the noise-floor histogram was drawing **zero pixels tall**; the ground-truth
decay the simulator judges its recovered half-life *against* was **invisible**;
and every slider row in the three drivable views was unlaid-out. The
`is-unranked` column matters most of the three, because on this data it carries
70 of the 89 measured runs.

Suite after the fix: **4,794 tests, 4,792 passed, 2 skipped, 0 failed.**

## 7. After — the same walk, measured the same way

Production build, same browser, same viewport, same script. **Fifteen views
across seven sections. Every one draws, and every data figure takes a keyboard
stop.**

| section | view | height | svg | tables | disclosures | `<title>` | keyboard stops |
|---|---|---|---|---|---|---|---|
| arm | Absorption | 552 | 1 | 0 | 0 | 16 | 1 |
| arm | Control | 825 | 0 | 0 | 0 | 0 | 0 |
| arm | Clocks | 623 | 1 | 0 | 0 | 89 | 1 |
| meetings | Meeting by meeting | 854 | 1 | 1 | 1 | 24 | 1 |
| meetings | Mechanism | 481 | 1 | 0 | 0 | 5 | 1 |
| episodes | Survival | 486 | 1 | 0 | 0 | 5 | 1 |
| episodes | Episodes | 486 | 1 | 0 | 0 | 5 | 1 |
| model | (single) | 1,384 | **7** | 0 | 7 | 0 | 0 |
| instrument | (single) | 934 | **6** | 0 | 6 | 0 | 0 |
| sandbox | Half-life | 749 | 1 | 0 | 0 | 9 | 1 |
| sandbox | Simulator | 739 | 1 | 0 | 0 | 3 | 1 |
| sandbox | Spectrum | 826 | 1 | 0 | 0 | 3 | 1 |
| findings | Effect plot | 760 | 1 | 0 | 0 | 14 | 1 |
| findings | Findings table | 1,090 | 1 | 1 | 0 | 14 | 1 |
| findings | Instrument | 1,019 | 1 | 1 | 1 | 2 | 1 |

Zero exceptions and zero HTTP failures across every walk, before and after.

**The three views that drew nothing:**

- `Model → Measurement` had **zero** figures at 1,354px. It draws **seven** at
  1,384px — thirty pixels for seven drawings, because the cards moved to three
  columns above 1400px and a duplicated section note came out.
- `Model → Instrument` had **zero** at 1,084px. It draws **six** at 934px, so it
  is both shorter and no longer wordless.
- `episodes → Episodes` was a 251px dead pane, and on this deployment that was
  the LIVE state rather than an edge case. It draws the recorder's watch at
  486px: six live counters and the window an episode has to outlive to be seen.

**The 34 mouse-only facts are gone.** Six figures hand-rolled a raw `<svg>` and
carried their detail in SVG titles, reachable with a pointer and by nothing
else. All six now draw through the shared `Plot` frame: one tab stop each,
arrows to walk, Home/End, Escape. Two views hold no keyboard stop and both are
correct — `Control` draws HTML bars rather than SVG, and the thirteen formula
figures carry no marks on purpose, being diagrams of an argument whose every
word is already on the drawing.

**Two accessibility defects found on the way, neither in the brief.** The live
region every figure announces through sat INSIDE the `role="img"` element in all
25 callers — a children-presentational subtree — so it was announced to nobody;
its guard passed because it compared source positions inside one file. And
`EffectPlot` sized its label column from the mixed-case prose advance while its
labels are wire data that can arrive uppercase, so the column under-measured
exactly the labels most likely to overrun it.

**Two figures added from fields already on the wire**, no schema change: the
middle half of the runs behind each mean absorption curve, and `half_life_vol`
drawn for the first time as a rank slopegraph against the wall clock — **57 of
89 stages move more than a tenth of their own field between the two clocks**,
which is the identification check the tab argued in prose only.

**Four openers cut after the fact**, by a guard that was extended to reach this
tab rather than by eye. `Findings / Instrument` opened on a heading restating
the switcher button beside it; `Sandbox / Half-life` on a sentence restating its
own figure caption; `Sandbox / Simulator` on a sentence restating the section
lede. All three are gone and the three heights above are the ones after. The
fourth was the guard's own scanner: its read window was too short to see past a
six-chip row, so it reported "no drawing" for a view that had one.

Final suite: **4,880 tests across 1,055 suites, 0 failed.** Gateway: **3,049
passed, 2 skipped** in CI shape, ruff clean.
