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

## 8. Layout and render, measured 2026-08-25

A brief asserted jagged grids and UI-thread lag. Both were measured before
either was changed, on a production build in headless Chrome.

**Layout: already symmetrical, except two tables.** Every section card at 1600
and 1280 — `w=1560, border=1px, radius=14px, pad=11/16, bg=#fff`; every seg,
head and lede at `x=37`; every formula-grid row already equal height. What was
wrong was column strategy:

    meetings   auto  -> fixed    179·124·313·417·238·253      -> 254·127·254·254·254·381
    findings   auto  -> fixed    658·139·118·108·124·176·202  -> 381·127·127·127·127·254·381
    instrument fixed (unchanged) 305 x5

Worst-to-narrowest went 3.4x and 6.1x to 3.0x on both. The widest column is
measured rather than judged: the longest relationship name on the live ledger is
38 characters, so three twelfths (~53 characters of room) rather than four.

**Render: already inside the frame budget.** At 4x CPU throttle —

    slider input -> committed   p50 0.2ms   max 1.8ms
    pointermove over 89 marks   p50 0.0ms   max 0.6ms
    JSON.parse of 404KB         1.5ms
    long tasks over 6s idle     none

**What was actually redundant.** Three polls 20s apart: 404,325 bytes each,
byte-identical apart from `observed_at`, each handed on as a fresh object.
Keeping the identity and memoising the sections saves **~1.9ms of script per
poll**, measured back to back with only that check toggled.

A first estimate of 14ms did not survive a control and is recorded here because
the mistake is instructive: it came from comparing a polling section against a
non-polling one and attributing the difference to the poll, when most of it was
the freshness clock ticking once a second on both. React writes nothing to the
DOM when output matches — zero mutations in every section subtree across a poll,
with the check on and off — so what a memo boundary saves is reconciliation,
not paint.

`absorptionBand` also went to a single pass: **8.0x fewer inner iterations**
(2,688 -> 336 and 3,008 -> 376), output identical element by element.

**The tab is now in the desk's own harnesses**, which had never included it:

    tab-switch (4x CPU)   click->paint 18.5ms   click->idle 20.3ms
                          longest task 0ms      blocking 0ms
    request-count         3 requests per switch, no duplicates

For context on the same run: `coherence` paints in 18.1ms and `research` carries
a 76ms long task with 26ms of blocking. Diffusion is the lightest of the three
engine tabs on requests — `markets` 6, `coherence` 7.

## Findings / Instrument, revamped 2026-08-25

Two defects a source read could not have found, both measured in the browser at
1600px before the change:

**The view opened on an empty drawing.** `ValueStrip` was drawing the two
out-of-sample rows as bars. The live findings read returns
`skill_baseline_r2: null`, `skill_gain: null` and `skill_meetings: 0`, so both
rows correctly declined to draw and the figure rendered as two lines of
"— — not measured" under a caption. Its row labels were also clipped mid-word
("Clock with…t the text"). The same two facts were then the last two rows of
the table beneath it, so the opener duplicated part of what followed it.

**The table's fifth column was most of the view.** "What failing it would mean"
is six fixed sentences that never move with the data, wrapped to three lines
each. Measured heights:

    before   panel 1,019px   1 svg   1 table (30 cells)   5 paragraphs   1 disclosure
    after    panel   764px   0 svg   6 ladder rows        1 paragraph    3 disclosures
    after, every disclosure forced open   1,041px

Nothing was deleted — the fully expanded view is the height the old collapsed
one was. `InstrumentFit` draws each requirement on its OWN nought-to-one scale
(an R², two indices out of ten, and a yes/no — every one of them native, so no
scale is invented) with the threshold ticked on the same track. That is the one
thing the old "✓ met" column could not say, and the margins are not alike:

    Recovers a known fact   R² +0.74   floor 0.20   0.54 clear
    Uses its dimensions     9.99/10    floor 9      0.99 clear
    Readings spread out     9.21/10    floor 9      0.21 clear

Row heights are even at 25px across all six at 1600, 1280 and 1100; the row
collapses to one column under 1100px, and no width scrolls the panel sideways.

**A false claim in the section head, found by the same look.** The lede read
"the absorption clock is predictable without the text at all — R² +0.14 out of
sample". That is what `skill.py` produced when it was run; this deployment's
wire says the run has never landed, and the pane below correctly said so. A
section lede is a fixed string and cannot read a payload, so it states the
DESIGN now and the number lives where it can be null.

The ladder is HTML rather than SVG, following `.diff-bars`: the numbers are
selectable text and the hover affordance is each track's own `title`. Meaning
is never in the fill — every row carries its mark and its margin in words — so
it needs no `forced-colors` block, for the reason `.diff-bars` needs none.

## Slice 1 — the bugs, 2026-08-25

Four of these were invisible to the suite by construction, and one was a
mislabelling of live data.

**The episodes table named the wrong two columns.** `KalshiArm.tsx` headed six
columns `Family · Constraint · Lifetime · Peak distance · Peak net edge ·
Half-life` over a body of `event_ticker · family · lifetime_s · peak_ci ·
peak_net_edge_dollars · half_life_s`. Column one was labelled "Family" over the
event ticker and column two "Constraint" over the family; "Constraint" named no
field in the payload at all. Six headers over six cells, so every count matched
and nothing could catch it. Now `Event · Family · …`, with `table-fixed`,
twelfths, and `tabIndex={0}` on its wrap — it was the tab's only auto-layout
table and the only scrolling region on it with no keyboard route.

**Verified by source alignment, not by a render:** this deployment has recorded
zero closed episodes, so the disclosure holding that table never renders. Say
that rather than claiming a look that did not happen.

**Diffusion had been rendering table markup and getting none of the rules.**
Measured against Proofs on one build:

    before            caption font      cell padding    row border
      Proofs          Inter             7px 10px        1px solid
      Diffusion       JetBrains Mono    3px 8px         none

    after: all three Diffusion tables Inter / 7px 10px / 1px solid

`.coh-table__caption { font-family: var(--sans) }`, the cell padding and the row
rules were scoped `.proofs-plane` (`14u`) and `.quotes-plane` (`14t`). Since
`Figure.tsx` and `.coh-table` are shared components, Diffusion rendered them and
two of three tabs styled them. `plane-scope.test.ts` cannot see this: it asks
whether a rule scoped to a plane reaches that plane's components — the forward
direction — never whether a class rendered on one plane is styled only on
another. The mono caption came from `table { font-family: var(--mono) }` at
`00:1680` being inherited with nothing to override it.

**The switcher did not stick.** `.coh-bar` had five render sites, all on Proofs,
so both `14u:73` (sticky) and `14r:343` (wrap) missed the tab whose banner said
it needed them most. The five Diffusion segs are wrapped now: measured
`position: sticky, top: 52px, z-index: 5`.

**One regression, caught by looking.** Copying `14r:347`'s `flex: 0 0 auto`
verbatim shrank all five switchers from the full-width segmented control to a
small left-aligned pill. That rule is right on Proofs because a `.coh-bar` there
also carries a family picker; on Diffusion the seg is alone in the bar. The seg
spans instead, and `flex-wrap` goes from `nowrap` to `wrap` — which is the
relief valve a fourth view will need.

**33 lines of CSS were duplicated verbatim.** `10b-coherence-figures.css`
101-133 was byte-identical to 134-166, `.coh-diffusion` included — the class on
all seven section elements, declared twice. Identical declarations, so nothing
rendered differently and `dead-css` could not see it: it asks whether a class
has a render site, never how many times it is declared.

**Two classes had no base rule.** `.diff-fit__value`'s only declaration was a
`text-align: left` inside a max-width query — undoing an alignment nothing had
set, since the column measured `start` at every width. `.diff-time__node` had
only its three modifiers.

**Cost, measured across all 15 views:**

    +17px on the 13 views with a switcher  (the .coh-bar padding and its rule)
    +137px on findings / Findings table    (7px cells over 14 rows)
    total 12,038px -> 12,379px

The +17 is the price of a sticky control row and Proofs pays it too. The +137 is
paid back with interest by the declutter slice.

**`coherence/status` costs ~515ms of gateway work, and it is not ours.**
Measured three runs each: 520/538/525ms through the proxy, against 4/5/7ms for
`coherence/episodes` on the same proxy with the same auth. The proxy adds ~3ms,
so the time is the gateway's own. It polls every 20s on the episodes section and
is a shared `coherence/*` route.

## Slice 2 — uniformity, 2026-08-25

The type ladder was inverted in four places, each traced with
`CSS.getMatchedStylesForNode` so the winner is measured rather than reasoned:

    slot                         before   after
    figure caption (the TITLE)     14       14
    figure reading (the gloss)     17       14
    figure missing (footnote)      13       13
    .diff-bars__head               14       14
    .diff-bars__foot               17       13
    instrument ladder row       12.75       13
    instrument ladder grouphead 12.75    12.75
    sandbox slider label           17       13
    folded table  th / td       13 / 13   12.75 / 13

One rule now holds across the tab: **12.75 labels a column, 13 is a body cell or
a footnote, 14 is a caption or a reading.**

**Why the reading came down rather than the footnote going up.** The question
was which way "uniform" should cut, since the caption/reading inversion is
desk-wide — Proofs and Markets measure 14/17 on every figure too. `10i:77-87`
settled it: the 13px footnote rung on this tab exists because of three separate
reports of that footnote reading "out of place" at the reading rung. Raising it
back would have undone a change that was asked for. So the cut is within the
figure — caption and reading are one voice about one drawing, already separated
by weight and colour, and the footnote sits a rung below both. The desk-wide
inversion is a proposal to the partial's owner, not a fork made here.

**Two classes were rendered with no rule reaching them, both found by asking
the browser rather than by reading source.**

`.diff-fit__value` had one declaration, `text-align: left`, inside a max-width
query — undoing an alignment nothing had set. Measured `start` at every width.

The sandbox slider labels rendered at **17px primary-colour prose**, louder than
the caption on the same card. `00:1434` styles `label.field`; the three
instruments render `<label><span class="field">…</span><input type="range">`.
The label wraps the control, which is the right markup, and the span carries the
words — so the element with the words is a `span.field`, the rule is written for
`label.field`, and nothing reached it. They inherit `body`'s `--fs-title`. Now
the same 13px caps every other field label on the desk uses.

**The arm's chips blinked in and out.** They rendered inside the Absorption
branch only, so switching to Control or Clocks removed them and switching back
restored them — a row of facts appearing and disappearing from a card that had
not changed. Neither chip is about that view: the ratio is the two stages'
median half-lives over the whole study, and the terminal window is a constant of
both. Hoisted; all three views now carry both.

**What is left, and it is one thing.** The findings table's cells read 15px
while the two folded tables read 13px. That is the fold/open distinction, not a
cascade fault — the disclosure body rung is a house contract
(`type-role-disclosure`: summary 14, body 13, exactly one rung apart), and a
table inside a fold reading 13 is that contract working. It resolves when the
findings table folds in the declutter slice, at which point every table on the
tab reads 12.75 / 13.

17px now renders nowhere visible on the tab except the "What breaks it" clauses
on the two formula catalogues, which the declutter slice folds.

**Height, net of both slices:** 12,038px to 12,289px across the 15 views. The
arm's Control view is the one that moved down (804 to 775) as its two readings
came off the title rung.
