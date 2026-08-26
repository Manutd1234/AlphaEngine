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

## Slice 5 — declutter, 2026-08-25

Taken out of plan order, ahead of the interactivity and new-figure slices,
because it is cheap, it is the largest visible win, and its table fold is what
closes the one split slice 2 left open.

    section / view            before    after    delta   visible words
    model                       1411      921     -490      263 -> 20
    instrument                   952      650     -302      216 -> 19
    findings / Findings table   1090      690     -400       46 -> 46
    total across 15 views      12038    11029    -1009     1673 -> 1233

**The boundary clause folds, and that reverses a decision.** Each of the 13
formula cards was five grid rows: head, formula, figure, an OPEN definition list
carrying "What breaks it", and a disclosure carrying the summary and "When it
holds". The note that put it that way argued `LessonsPane`'s rule — never leave
the confident half on screen while hiding the failure — so the failure stayed
open and the claim folded.

Three things make the fold safe, and the third is what changed. The figure
already draws the failure: `primitives.tsx` says what each figure draws is the
mechanism AND where it fits, which is the failure the clause names — the linear
crossing landing where the log one does not, the asymptote walked upward, the
whitened spectrum collapsing to one bump. The order survives, because inside the
fold "What breaks it" sits above "When it holds", so the inversion is carried by
sequence rather than by visibility. And the arrangement it replaces had a
distortion its own note never named: a reader who opened no card got the warning
and never the claim. Behind one fold the two are inseparable.

Both section ledes said cards "state what breaks it above what it measures".
That stopped being true the moment the clause moved, so both were rewritten in
the same change — a stale lede is the failure mode this tab has already had once
this week, in Findings.

**Three columns from 1240px rather than 1400px.** At 1280 the grid used to drop
to two and `model` grew a fourth card row to 1,680px. With the prose folded the
row height is set by the fixed 96px figure rather than by reflow, so a narrower
card costs almost nothing.

**Subgrid goes from `span 5` to `span 4`,** and the rule that drew a hairline
over the open clause is deleted rather than moved: with the clause inside the
fold, no `.coh-lesson__bounds` is a direct child of a card for it to match, and
`02:106` already supplies that hairline. A selector matching nothing is
something `dead-css` cannot see, because the CLASS still has render sites.

**The findings table folds behind its own strip,** the pattern `MeetingTable`
already uses on this tab. The two were drawing the same 14 rows twice — the
strip bars `row.n` and the table's Events column IS `row.n` — with `t` for the
same rows one button away on the Effect plot. The length gate is load-bearing:
`FindingsTable` renders a `.console-empty` line when there is nothing, and
folding an empty state away would break the rule that an empty result is
reported rather than hidden.

**That fold is also what completes slice 2.** Measured after:

    meetings table   th 12.75  td 13
    episodes table   th 12.75  td 13
    findings table   th 12.75  td 13

One ladder across the tab: 12.75 labels a column, 13 is a body cell or a
footnote, 14 is a caption or a reading. 17px now renders nowhere on it.

**Nothing was deleted.** Every word is one click away, and the two catalogue
sections stop being roughly 60% of the tab's visible prose.

## Slice 3 — interactivity, 2026-08-25

Target: no figure on the tab that cannot be asked a question. Measured before
and after, same probe, same build:

    section / view          svg marks         kbd stops
    arm / Control            0 -> 26            0 -> 2
    findings / Instrument    0 ->  6            0 -> 1
    findings / Effect plot  14 -> 39            1 -> 1
    model                    0 -> 17 (hover)    0 -> 0
    instrument               0 ->  9 (hover)    0 -> 0

**Three figures were HTML pretending to be charts.** `StageBars`,
`FloorDistribution` and `InstrumentFit` were `<div>`s with `title` ATTRIBUTES,
and `useMarkReadout` collects SVG `<title>` CHILDREN — so every fact in them was
reachable by mouse and by nothing else. That is why `arm / Control` measured as
a view with no SVG at all. All three are SVG inside `<Plot>` now, with the same
geometry: the two-fill attrition track, the ten percentile buckets and the
off-axis unranked column, the six requirement rows and their threshold ticks.
Verified not clipped by comparing each SVG's viewBox against the lowest drawn
element: 158/136 and 226/213.

**`EffectPlot`'s only mark was on the row LABEL,** so hovering the dot — the
thing a reader points at — reported nothing, and the arrow walk read back text
already printed in the gutter. 14 marks to 39: the labels stay, the dots gain
`t`, `n` and the shuffled p, the band says what it is, and ten rows gain a `○`
in a reserved column carrying `Finding.note` verbatim. That field was on the
wire for 10 of 14 rows and rendered nowhere; it is the sentence that says why a
null is READABLE — "the positive control: without it, every null below is
unfalsifiable" — which is the one thing a dot at t = 1.15 cannot say for itself.

**The readout clipped its own text, and had since it was written.** `Readout`
bounded the pill to the plot width and let the `<text>` run on, so a long title
painted past the rounded corner and off the viewBox. It needed a mark title
longer than the plot to show, which is why no test could catch it: the suite has
no DOM, so a string length is a number nobody compares to a pixel width.
`ClockAgreement`'s per-run title is about 130 characters and overflowed at desk
width. Truncated in the middle now, because a readout is "what this mark is —
what it measures" and both ends are worth keeping; the full sentence still
reaches a screen reader through `announce`.

**The 19 formula figures gain hover and NOT a tab stop, and the split is the
point.** The old rule in `primitives.tsx` was "no hover marks on any of them",
argued on the grounds that nineteen diagrams would add nineteen tab stops to
re-read labels already drawn. Half of that holds and is kept: these figures
still do not go through `<Plot>`, because `Plot` promotes a figure to a tab stop
and the frame already names the whole drawing once with `role="img"`. The other
half does not — a `<title>` on a plain `<svg>` is a native tooltip and adds no
tab stop, so the two are separable. Measured after: 17 and 9 hover titles, **0
tab stops added**.

The sentences say what a part is DOING in the argument. "linear" names the wrong
crossing without saying why it is wrong; the hover says a linear reading puts
the crossing at the cell's arithmetic midpoint, which is later than the truth
whenever the cell spans a doubling. `diffusion-model-views.test.ts` is re-cut
rather than deleted: it now asserts the figures never reach for `Plot`, that a
hit shape exists for the titles to hang on, and that no `why` is merely its own
`word` again — which was the real defect the old rule guarded against.

**Three traps, each costing one red run.** A comment containing the literal
`@import` failed the "no partial imports another" guard; a comment containing
the word `Plot` failed my own new guard, which now blanks comments before
matching; and a `.diff-fit__row` rule survived inside an `@media` block my
rule-dropper could not reach, holding `dead-css` one over its baseline.

**Not done, and said rather than left implied:** `episodes / Episodes` still
draws 628 readings with 3 marks. Its titles are per FAMILY line, which is the
meaningful unit for a two-family tape, but a mark per unmeasurable gap would say
more and is not built.

## Slice 4 — the figures the wire was already paying for, 2026-08-25

**`ReturnFan`: the 64% of measured data nothing had drawn.**

    248 runs    89 cleared the noise floor    159 refused
      refused runs carrying a COMPLETE six-point measured path : 159 of 159
      measured cells inside refused runs : 954
      measured cells inside drawn runs   : 534

`_cell()` in `absorption.py` never consults the noise gate — the gate is applied
afterwards to `terminal_return` and lands in `signal_state` — so a refused run
still carries a full measured path. Every consumer on this tab opened by
filtering `signal_state === "ok"`. `StageBars` COUNTS the refused; it cannot
show they are the flat ones. This draws all 248, with 248 hoverable marks.

And the claim is computed rather than asserted: refused runs peak at a median
**49 bps** against **170** for cleared, with only 5% of refused runs exceeding
the median cleared run. The reading quotes both numbers off the drawn paths.

**A SIGNED-LOG AXIS, and the first build is why.** Bounded linearly by the
largest path the axis read ±891 bps, and |bps| runs median 29.7, p75 70.5, p95
217, p99 477, max 891 — a thirty-fold tail. The median half of the sample landed
inside 3.3% of the height; bounding at p99 only reached 6.2%. So a linear scale
was unreadable wherever it was cut, and cutting it is the clipping this figure
exists to avoid. `sign(v)·log10(1+|v|)` keeps every path, every sign and zero at
zero, and puts the median at 50% of the half-axis. Honest and legible were never
in tension — a linear scale only made them look it.

The axis stays unclipped for the reason `absorption.py` leaves the denominator
unclipped: 52 of 534 absorbed values exceed 1.0, the largest is 3.22, and both
mean curves top out at exactly 1.0000 — so `AbsorptionCurve`'s `highest > 1`
branch has never once fired and overshoot is structurally invisible everywhere
else on the tab.

Two defects the drawing exposed on its first build, both fixed: the footnote ran
two sentences together, because the wire's own `reason` ends without a full
stop; and the reading asserted "they are the flat ones" without the numbers that
make it checkable.

**Four more fields that arrived and were drawn nowhere.** `Finding.note` landed
as `EffectPlot` marks in the previous slice. `gate.fact` now names the fact —
the first requirement said the encoding "recovers a known fact" without ever
saying which, which is the difference between a check a reader can audit and one
they must trust; it reads "Recovers the policy move in basis points" now.
`gate.samples` joins its margin, because an R² of 0.74 over 61 meetings and over
6 are not the same claim. `study_id` and `verdict` fold into the run's own
disclosure, so the reported run is identifiable.

**A test taught rather than dodged.** `coherence-figure-margins.test.ts` scores
in-plot labels against a rung map, and `coh-svg-label` was missing from it — so
that class's labels had been going unchecked desk-wide. Added rather than
sidestepped: the suite went 4,920 to 4,929 because the check now covers more.

**Not built, and named so the next reader does not think they were missed:**
`MeetingCalendar` (a mark per meeting off `StageRun.t0`, 124 distinct decisions
back to 2019-01-30 — the tab is an event study with no event axis) and
`HorizonResolution` (the `[1, 2, 5, 10, 15, 30]` bar ladder off `cell.bars`,
which would say that the 1m point of all 248 paths is a single close). Both are
designed and neither is written.

### The last two figures, same day

**`HorizonResolution` — and the matrix it replaced.** The first design was a run
x horizon coverage grid. The arithmetic killed it: 1,984 cells is exactly
248 x 8 and 1,488 measured is exactly 248 x 6, so every run carries the
identical row `[unavailable, unavailable, ok, ok, ok, ok, ok, ok]` — there is no
per-run variation in `cell.state` at all. The matrix would have been 1,984 marks
saying one sentence, in two solid blocks. Eight rows instead, one per horizon,
with the two that resolve for nobody kept in rather than dropped.

The second track is the new fact: `cell.bars` is exactly `[1, 2, 5, 10, 15, 30]`,
so **the 1m point of all 248 paths is a single close** — the resolution the whole
absorption curve rests on, which nobody reading this tab had been told. Drawn as
one stroke per close, because the quantity is a count and a bar invites reading
a length. ~20 marks over 1,984 cells, which is every distinct fact in the field.

**`MeetingCalendar` — the event axis an event study did not have.**
`StageRun.t0` was on the wire and read by nothing: 248 timestamps, 124 distinct,
62 decisions from 2019-01-30 to 2026-07-29. Every other figure here plots a
horizon, a rank or a percentile; not one plotted a date. So a reader could take
away a half-life, a ratio and a null without learning that the ledger spans
eight years, or where in them the 89 accepted runs sit.

It answers the question nothing else can: if the runs that cleared the floor
cluster in one regime, every finding on this tab is a finding about that regime.
Measured on the drawing, they do thin out before 2021.

Shape carries the stage (`●` statement, `▲` press conference) and fill carries
the gate, so neither rests on a hue. The 62-tick rug is emitted FIRST in
document order, because `use-mark-readout` walks marks in document order — so
`Home` lands a keyboard reader on the earliest MEETING and the first 62 presses
are a meeting-level tour before any run-level detail. The two symbols share
every meeting, so their marks are nudged apart by a fixed offset that carries no
time, and the footnote declares it: a drawing device a reader could mistake for
data has to be named.

**One trap worth writing down.** The calendar branch was first written with its
own absorption gate — `return notice; … return (<figure>)`. The scan in
`engine-opens-on-a-drawing.test.ts` bounds a branch at its SECOND return, so the
window closed before the figure and the view reported "draws nothing". Moved
below the shared gate, the branch is a single return whose first tag is the
drawing. `VIEWS` goes 26 to 27 and the Diffusion count 15 to 16.

## The Survival watch and the fan's axis row, 2026-08-26

Two figures from this sweep, both mine, both fixed against measurements.

### The fan was putting its own count on its own axis

    tick row    top 272  bottom 284
    note row    top 280  bottom 297     vertical gap  -4px
    clashes     "82 of 124 below the floor" over the 2m and 5m ticks, both panels
    dead space  201px of each 703px panel (29%) with no ink, under ticks
    alley       26px, tightest tick gap 9px between panel 1's 30m and panel 2's 1s

The count moved to the panel header — stage left, count right, the
`.diff-bars__head`/`__count` idiom `StageBars` already uses. The leading
horizons that resolve for no run are hatched with the pattern `Plot` ships and
titled with the wire's own reason, so 29% of each panel says "never measured"
rather than sitting blank. Their ticks are gone, which is also what cures the
alley. After, at 1600/1280/1100:

    every text pair checked   0 clashes at all three widths
    tightest tick gap         78px
    lowest text 302 against a viewBox of 318 — no clipping

**One collision I introduced and had to measure to find.** Left-aligning the
panel head put "statement" at x=58, and the y-axis title "abnormal return" runs
from x=0 to about x=100 — invisible while the head was centred. The axis title
has its own row now and `HEIGHT` went 300 → 318 to pay for it, rather than
shaving a margin that was already 3px from clipping.

### The Survival figure was drawing a server default as a measurement

Before: 1504x138, **5 marks**, every one restating one of two constants, and
nothing at all encoded in y. Its own label guard was `x1 - x0 > 96` against a
leftmost band spanning 9.3% of the plot — so that label needed a plot wider than
1,030px and **was never drawn at any desk width**. It read as one enormous
rectangle with an unlabelled sliver at each end.

Two of its claims were false:

- **`round_trip_s` is not measured.** `modules/api/coherence_history.py:154`
  declares it `Query(default="0.240")` and `lib/coherence/routes.ts` never
  passes it, so the desk drew the gateway echoing its own default back, labelled
  as though something had timed it. Same class as `?? 0`: a number that looks
  measured and is not. It is named an ASSUMPTION now, with the reason.
- **The recordable floor is two polls, not one.** `episodes.py:37`
  `POLLS_TO_CLOSE = 2`, and `closed_ts_ns` is the SECOND coherent poll's
  timestamp — so at a 300s cadence nothing shorter than about ten minutes can be
  recorded. The old reading said "shorter than one poll" and understated the
  blind spot by half.

After: **225 marks**, all live.

    the watch, 27.5h of it                                    222 polls
    |||||||||||||||||//////////////////|||||||||||||||||||||||||||||
    08-24 13:07                                        08-25 16:35
    the interval in progress
    [####                                                        ]
                                                    next poll in 5m

One mark per poll across the tape's real span, the readings clustered back into
the visits that wrote them (each poll writes one reading per EVENT, so 775
readings are 222 visits). **Two stretches where the recorder was not looking are
hatched rather than left blank** — about 105 polls that would have fallen inside
them were never taken, and a blank stretch on a tape of ticks reads as "nothing
happened" when it means "nobody was watching".

The two rows deliberately do NOT share an x axis: one poll interval is 0.3% of a
27-hour span, so drawing the countdown up there would make it invisible and
imply a precision it has not got.

**It needed the `index` read, which it was never given.** `KalshiArm` handed
`index` to the Episodes branch only — the biggest live dataset on the section
was one line away from the view that had nothing live to draw.

Proof it is live: across two screenshots minutes apart, polls 29 → 30, snapshots
61,970 → 62,250, readings 771 → 775, and the interval track reset.

The four `.diff-watch__band*` rules went with the bands they styled; leaving
them would have failed `dead-css`.

**A second row-overlap, also found by measuring rather than looking.** At
`NEXT_TOP = 108` the label "the interval in progress" sat inside the tape's
end-label box at every width — eleven pixels apart, 13px type over a 10px tick.
122 now.

## The three infrastructure claims, and the header's core figure — 2026-08-26

Three claims arrived with a redesign brief. Each was checked against the code
and the running stack rather than accepted, and one of them led to the only
investigation worth writing up.

### "Backend and frontend sync have no issues" — true

Poll, 20 s, `transport="poll"` (`use-coherence.ts:31`). No WebSocket or SSE
reaches Diffusion; `/api/stream/desk` serves Execution only. Every route the
tab reads answered 200 on the restarted stack; `coherence/status` at ~265 ms
after the concurrency fix.

### "Oracle, Supabase, Neo4j and RAG are all used properly" — true of the repo, not of this tab

Diffusion reads SQLite (`data_ops.sqlite`, via `DataOpsStore` —
`data_ops_backend.py:106`) and DuckDB (`coherence.duckdb`, via
`coherence/fs/store.py:139`). It touches none of the four. The only "oracle"
in its code is `gaussian.py:227`'s `oracle_denoiser()`, a closed-form denoiser
in the diffusion-model sense. Supabase COULD serve it — `DATA_OPS_BACKEND=
postgres` is a supported branch that refuses to fall back — and is not
configured to. Those four backends are real and working on Research, Portfolio,
Risk, Execution and auth. Nothing to fix here; the premise is wrong for this tab.

### "Latency is sub-100 ns for all gateways, FastAPI and C++ engines" — not a claim this project makes

`LATENCY_BUDGET.md:46`: *three planes, three units, never blended — the whole
decision in µs, the core in ns, the network in ms.*

    C++ arithmetic core     83 ns p50 (quiet Mac, doc) · 320 ns p50 (production VM)
    whole risk decision     13.2 µs           ~160× the core
    every FastAPI route     milliseconds      `RequestTimingMiddleware`, unit ms
    gateway → browser       21–27 ms
    venue round trip        69–73 ms

100 ns is about one main-memory cache miss — less than one Python bytecode
dispatch. A FastAPI handler, a JSON parse or a TLS record cannot be sub-100 ns
by construction. On Vercel there is no C++ core and no FastAPI at all: the desk
runs alone, and the gateway is either absent (503) or a millisecond-distant
HTTPS hop — `vercel.json` pins `sin1` to the VM's city for that reason. So
"not sub-100 ns on my Mac and Vercel" is correct, and it is not a defect.

### Why the desk header reads `core 128 ns` p50 when the doc says 83

Investigated rather than explained, because 128 against 83 looks like a
regression and would be one if the core had slowed.

    the same core, the same Mac, re-benched today (load ~3, IDE and Chrome open):
      p50 83 ns   p99 166 ns   p999 541 ns   max 6,208 ns   fraction ≤ 2 ticks 0.974
    the doc, 2026-08-20, quiet machine:
      p50 83 ns   p99  84 ns   p999 167 ns   max   375 ns   fraction ≤ 2 ticks 0.995

**The p50 is unchanged at 83 ns** — two ticks of a 41.667 ns `steady_clock`.
The header's 128 comes from two things, neither a defect:

1. **The histogram reports a bucket's upper edge.** `quantile()` at
   `metrics/decision_latency.py:90-107` returns `self.edges[index]`, rounded
   up rather than interpolated, and the core histogram's edges run
   `…104, 112, 120, 128, 144, 160, 176…`. A p50 of three ticks (125 ns) lands
   in `[120, 128)` and prints as 128. The p99 of four ticks (167) prints as 167
   only because the quantile is clamped to `max_value`.
2. **The header's 300 samples are taken once, at startup, at whatever load the
   Mac has at that instant** (`main.py:171`). Under today's load the p99
   doubled from 84 to 166 while the p50 held — the startup run's p50 landed one
   tick higher, and the bucket rounded it up.

The honest framing was already in the doc at `:128`: *"that fraction, not the
p99 column, is what 'p99 under 100 ns' means on this clock."* What the desk
lacked was that framing beside the number. `decision-plane.ts`'s caveat now
carries one more clause — "each core figure is its histogram bucket's upper
edge on a 41.7 ns clock" — appended after `core max` because two suites pin the
caveat's opening clause and its tail adjacency.

## Slice 1 — the mechanism, with the meetings on it — 2026-08-26

`StageTimeline` drew two 30-minute windows from two constants, with 21 marks
that restated them and nothing from the ledger. It drew four of the wire's
eight horizons and silently dropped the two that never resolve. Its headline —
"30 minutes apart, set by the issuer" — was a universal.

Measured on the payload before replacing it:

    124 meeting×symbol pairs with both stages
    the gap is 30 minutes on 120 — and 60 on 4: fed:2020-03-03 and
      fed:2020-03-15 on both symbols, the March 2020 emergency cuts
    every one of the 89 measured half-lives lands INSIDE its own window
      statement          n=42   median 166 s   max 1,212 s
      press conference   n=47   median 728 s   max 1,402 s
    12 statement runs halved BEFORE the first measurable bar

`StageWindows` draws the same two windows with those 89 half-lives on them as
ticks, the medians as labelled rules, the horizons from the wire (all eight,
the two unmeasurable hatched with the source's own reason), and the gap read
per meeting — so the two cuts draw their conference window at +60 rather than
being normalised into a thirty they did not have. The 12 early runs are one
counted mark at the resolution limit, not twelve circles on one point.

Measured after: 0 text clashes at 1600/1280/1100, lowest text 527 in a 544
viewBox, all four figure guards green. `.diff-time__*` left `10c` and `14r`
with their render site; `10k` crossed the ceiling and split at the calendar
seam into `10l-diffusion-calendar.css` (257 + 177).

## Slice 2 — the Control view: distance to the floor, and the rank strip — 2026-08-26

**`StageBars` drew 82 and 77 refused runs as one grey block each.** Every one
of those refusals carries the sigma its terminal move represented, in the
sentence `signal_reason` — "the terminal move is 0.71 pre-event sigmas, below
the floor of 2" — and 159 of 159 parse. `FloorDistance` draws that as a
histogram per stage on 0.2σ buckets with the floor as a rule:

    statement    refused |σ|  n=82  median 0.72  p90 1.61  max 1.98
    conference   refused |σ|  n=77  median 0.63  p90 1.51  max 1.92

The reading is the fact the block hid: **the floor is a gradient, not a cliff.**
9 statement and 7 conference runs sat within 0.4σ of clearing. The 89 accepted
runs are counted above the floor and placed nowhere — their sigma is not on
the wire, and the figure says so rather than drawing them at the line.

**`FloorDistribution` was a ten-bucket histogram of nineteen points at two
values.** `control_percentile` is `0.0` on 13 runs and `1.0` on 6, so eight
buckets were height-zero rects carrying a title and a keyboard stop each, and
the `is-middle` highlight marked an empty bar. `ControlRank` draws the nineteen
as marks on the 0–1 axis, coincident ones stacked, the 0.5 rule kept, and the
70 unranked in a hatched off-axis column — a missing rank is not a rank of
nought.

**One defect the probes could not see and a screenshot could.** The nine
statement runs at 0.0 stacked UPWARD through the head text. The text-overlap
probe checks text against text; a dot over a label is invisible to it. The
stack goes downward now, into room the row reserves.

The `controls_used` guard in `diffusion-figures.test.ts` ate `FloorDistance`'s
own docblock — which explains why the figure does NOT read that field — and
now blanks comments first, proven red against a real read. Measured after:
22 and 23 marks, 0 text clashes at 1600/1100, nothing clips.

## Findings, 2026-08-26 — the field, the matrix, and the sentence the wire decides

Three views, measured on the live read at 1600, 1280 and 1100 before and after.

**The dot plot drew one number.** `EffectPlot` placed each of the 14 rows by
`t` on one axis; `shuffled_p` was hover text and `n` was a bar chart on a
different button. Live, the two rows that hold rest on 61 meetings and every
one of the twelve nulls on 26 or 29 — the section's most important caveat —
and no figure carried it. `EffectField` places each row by `t` across and
`shuffled_p` up, sizes the mark's AREA by `n`, and keeps the ±2 band and a
p 0.05 rule. The p axis is LINEAR, and the reason is measured: the nulls span
p 0.26 to 0.95, which a log axis to 0.001 folds into the bottom fifth of the
plot; linear they take seventy per cent of it, and the conference control's
p of exactly 0 sits on the top edge with no clamp inventing a floor for it.
Stage is the mark's shape (● / ▲, the Control view's pair) and the verdict is
filled against hollow. The ten wire notes — two distinct sentences — are two
counted lines under the axis, not ten marks in a cloud.

    before   14 dots on 14 rows       t only          n on another button
    after    14 marks, 2 axes         p 0.05 rule     18 keyboard stops, 0 text clashes at all three widths

**The table view opened on a bar chart of three values.** A `ValueStrip` of
`Finding.n` — fourteen bars reading 61, 26 or 29 — under a caption about
counts, above a folded table whose Events column is the same field.
`EvidenceMatrix` replaces it: a row per relationship, a column per stage, a
signed t bar from each column's own zero with the band behind it, the verdict
mark and `n` beside each bar. The reading is derived: "7 of 7 paired
relationships read the same in both stages". A cell with no measurement is
hatched, never a bar of nought (none on this ledger). 23 stops, 0 clashes.
The 1600px screenshot showed the widest name eliding to "resolution centro…
absorption speed" at every width, and the probe could not see it — an elided
label clashes with nothing. The cause was not the gutter cap (raised 280 → 320
first, which changed nothing): `gutterFor` pads the widest label by a 16px
clearance and the label was truncated at `gutter − 18`, so the widest name was
two pixels over its own budget by construction. Budget is `gutter − 14` now,
the room the end-anchored label actually has, less two.

**A fixed sentence was true of the wrong run.** `FindingsPane`'s docblock and
disclosure D3 asserted the clock is predictable out of sample — "R² +0.14 on
57 meetings". The wire says `skill_meetings: 0`, every `skill_*` null. Read
off `data/data_ops.sqlite` directly:

    prior:decision:d6:s7    skill_meetings 0     (the study the desk REPORTS)
    prior:guidance:d10:s7   skill_meetings 57    baseline R² +0.144  gain −0.343  p 0.875  +6.98 min

The score exists — on a study the selection rule does not report. The rule
picks "whichever run best recovers the known fact among the well conditioned",
fixed in advance; the scoring ran on a different run. So the sentence was true
of a run the reader was not looking at. Both places now branch on
`study.skill_meetings`: the ladder's row reads "not scored for this run" (it
read "0 meetings scored out of sample", a measurement of nothing rather than
no measurement), and D3 says the ladder WOULD report it and on this run has
not. A guard pins both branches and was proven red by making either
unconditional. Whether the reporting rule should prefer a scored run is a
gateway question, recorded here and not decided here.

**One clash the new column found in an old figure.** `InstrumentFit`'s first
row names the fact it recovers since 2026-08-25 — forty characters — and at
1100px it ran into the value end-anchored beside it ("Recovers the policy move
<> R² +0.74"). Elided to the room the value leaves; the track's title carries
the phrase.

`.diff-effect__*` left `10c`, `10j` and two `14r` lists with the plot. The
chance band, which the model's formula cards also draw, is `.diff-band` in
`10k` now — one name for one thing with three owners. `dead-css` unchanged at
its baseline.

## Findings / Instrument, the folds as tables — 2026-08-26

Three `<details>` sat under the ladder: 88, 134 and 85 words of prose, three
identical hairlines with no heading between, and summaries in three grammars
(a counted noun, an uncounted noun, a question). Two of the three were numbers
wearing sentences — the run's id, segment, conditioning, latent width, event
count, rank, spread, criterion and verdict in one paragraph; "62 of 62", 18
meetings and 32 votes in another.

`FindingsFolds` draws them as two tables, following `MeetingTable` on this tab
and the four folded tables on Proofs; the third fold's one genuine sentence —
why the predictor is reported as absent rather than dropped — is the run
table's caption, with its claim about the ladder still branching on
`study.skill_meetings`. Every summary names its table. The criterion and the
largest measured |t| are parsed from `verdict_reason`, the only place the wire
states them; a sentence that does not parse is printed whole beneath the
table rather than read into a row.

    The run, and what it was held to        setting · value · what it means
    Timestamps, checked against the issuer  check · result · read from
    What each requirement is guarding against   stays a definition list; six fixed sentences are prose

**2026-08-27 — the counts left these headers.** Neither of these two folds is
a measurement: 12 settings and 3 fixed checks, both gated on a non-empty body
(`study ?`, `stamps.length && calendar ?`), so the "empty fold looks like a
full one" case the counted-summary convention exists for cannot occur here.
See the round-2 sweep section below for the other three headers this touched.

Measured with every fold forced open, at 1600 and 1100:

    summary 14px   cells 13px   column heads 12.75px   caption 14px   cells 7px 10px
    closed 766px → open 1,661px (1600)   788 → 1,764 (1100)   the page never scrolls sideways

Two things only the open view could show. **The cells set in mono.**
`.coh-table` gives every cell the tabular face — right for "62 of 62", wrong
for "a rule fixed in advance, blind to absorption speed". `coh-table__prose`
joins `coh-table__caption` in `10j`: sans, wrapping, on the cell that says so.
**The run table scrolled 77px inside its fold** at every width while no cell's
edge crossed the wrap — a fixed-layout cell that cannot wrap overflows its box
without widening the table, so the row's `scrollWidth` said 1,602 in a wrap of
1,526 and every rect said fine. The same class fixes it; both tables fit now.

`diffusion-table-columns` declares both tables (a file may draw more than one
since this change: `nth` names which). The definition list under the ladder
takes the tables' rhythm — 7px 10px a cell, a hairline per row — so the three
folds land on one grid.

## The outages on the Survival tape, 2026-08-26 — documented at the cause

The tape carried ten hatched stretches on 26 August, eight of them in one
seven-hour window:

    08-24 17:59 → 08-25 02:17   497 min
    08-25 02:25 → 03:04          39 min
    08-26 02:01 … 08:53          eight gaps of 12–80 min

The recorder is not a service of its own. `main.py:157` starts it with
`asyncio.create_task(coherence_recorder_loop())` inside the gateway process,
and `recorder.py:236` is that loop — so every restart of port 8912 stops the
poller with it, and the tape shows a stretch from the last poll before to the
first poll after. Three desk sessions restarted the gateway independently that
morning; the eight gaps are those restarts. The figure was reporting the truth.

What changed: `EpisodeWatch`'s docblock says why a restart is a gap, and the
figure's `missing` line names it beside the count — "a restart of the gateway
is one of these — the recorder runs inside that process — so a stretch here is
not on its own evidence of the venue being away". Nothing else. Persisting the
poller's state across restarts was considered and declined: the loop is
peer-owned, and a gap the recorder did not see is still a gap; carrying state
over would change what the tape means, not what it shows. 3202 (gone) and
3210 (serving `main`) needed nothing.

## The sweep, 2026-08-26 — all seven sections, sixteen views, three widths

Run after the five slices above landed, with `viewprobe.mjs` driving every
section's own switcher through Chrome DevTools at 1600, 1280 and 1100, and a
screenshot of every view at 1600 looked at, not just measured.

    section     view                 opens on           marks  focusable  words   px
    arm         Absorption           svg                  270          2    183  1023
    arm         Control              svg                   45          2    200  1143
    arm         Clocks               svg                   89          1    153  1023
    meetings    Meeting by meeting   svg                   24          1     27   871
    meetings    Calendar             svg                  310          1    110   625
    meetings    Mechanism            svg                  112          2    227  1021
    episodes    Survival             svg                  415          1    176   573
    episodes    Episodes             svg                    3          1    119   644
    model       (single)             p.sub                 17          0     31   921
    instrument  (single)             p.sub                  9          0     30   650
    sandbox     Half-life            svg                    9          1     80   762
    sandbox     Simulator            svg                    3          1     80   752
    sandbox     Spectrum             p.coh-event__note      3          1    111   815
    findings    Effect plot          svg                   18          1     92   698
    findings    Findings table       svg                   23          2     77   666
    findings    Instrument           svg                    6          3    103   766

Held to the six lines the plan set:

**Every view opens on a drawing** — 13 of 16 on an `svg`; the three that open
on a paragraph are the two formula-card sections (Measurement, Instrument),
whose lede is the card, and Sandbox / Spectrum, all named exemptions in
`engine-opens-on-a-drawing`. **Every figure interrogable** — no `<Plot>` view
has 0 keyboard stops. The two card sections carry 17 and 9 hover titles and 0
focusable drawings, and that is BY DESIGN, not a gap: `diffusion-model-views.test.ts:124`
pins that a card figure "can be asked what a part means, without joining the
tab order" and refuses any card that reaches for `Plot`, because nineteen
diagrams of an argument would be nineteen new stops to walk decoration. Each
card names itself once (`role="img"` with a sentence) and hangs its titles on
a hit shape a pointer can reach. The census line reads "every figure a reader
can interrogate", and the cards meet it by hover and by name; they were never
meant to meet it by tab, and the guard says so. **One type ladder** — 12.75 / 13 / 14
on every fold and figure measured (`foldprobe`, `findprobe`). **No text
overlap at 1600 / 1280 / 1100** — every pair of `<text>` boxes checked on every
`svg` of every view. Before the sweep, three views clashed at all three widths
by under a pixel each: the Absorption fan's two key lines (14px glyphs 14px
apart), the Clocks figure's "wall" over "fastest" (two 10px boxes meeting at
the plot edge), and the Episodes legend. The first two were fixed in the
sweep commit (17px and 3px). The third was recorded "for its owner" as
`IndexSection`'s child — wrongly: the Episodes view mounts `EpisodeTape`, under
`diffusion/`, whose two family keys stepped by 14 with 14px glyphs. Fixed on
the same day (step 17, first line raised 3px); 0 clashes at 1600 / 1280 / 1100
after. The lesson is the one from slice 3 again: a probe names the svg, not
the file, and "which component drew this" is a question to answer by reading
the section's branch, not by grepping for a caption phrase — that phrase sat
in three files, none of them the right one. **Nothing clips its
viewBox** — 0 of 16. **No `?? 0`** — `null-honesty` is green and every gap on
the tab is hatched.

Marks over text, checked separately: after the fixes the only remaining pairs
are a `ValueStrip` row group carrying its own label (Meeting by meeting) and
count text sitting inside the chance-band REGION on the matrix and the field
— a region, not a mark — and the formula cards' bands under their own words,
which the `Band` primitive draws by design.

**One defect no probe was written for.** `StageWindows.tsx` — committed on
2026-08-26 in slice 1 — carried two NUL bytes: the pair key was
`${ref}\0${symbol}` and the split was on `"\0"`. It rendered, because a NUL in
a JS string is legal; it made the file binary to `file` and to BSD `grep`,
which printed nothing for it three times before anyone asked why. A space
now, and `file` says text. Every other source under `diffusion/`, `app/globals`,
`tests` and `lib/coherence` was scanned for control bytes: none.

### The three infrastructure bullets, answered by measurement

**Backend and frontend sync.** Every diffusion read is a 20-second poll
(`COHERENCE_POLL_MS = 20_000`), `revalidateOnVisible`, no socket. The route
table end to end, three runs each, the desk's proxy against the gateway direct
(bearer from `.env.local`, localhost only):

    route                                     proxy 3100        gateway 8912 direct
    coherence/status                          248–259 ms        253–260 ms
    research/diffusion/absorption?limit=400   12.5–15.5 ms      8.2–11.1 ms
    research/diffusion/findings               47–49 ms          46.6–47.9 ms
    coherence/episodes?limit=500              3.4–3.8 ms        1.0–1.3 ms
    coherence/index?limit=2000                9.1–10.0 ms       5.1–5.5 ms

The proxy adds one to four milliseconds; `status` is the gateway's own
quarter-second, unchanged since the concurrency fix. All 200. Nothing to fix.

**Oracle, Supabase, Neo4j, RAG.** Unchanged from the verdict above: this tab
reads SQLite and DuckDB and touches none of the four.

**Latency, and the header's core figure.** Read off the live page after slice
0: the stamp prints `core 167 ns` and its title now ends "…core max 167 ns;
each core figure is its histogram bucket's upper edge on a 41.7 ns clock;
n=300 self-measure samples; decision µs awaits the first order; network,
polled — desk hop p99 59.0 ms, upstream p99 33.0 ms". Three planes, three
units, each named. The core is under 100 ns at the p50 (83 ns, two ticks);
the gateway routes are milliseconds and are meant to be.

## Slice 2a, 2026-08-26 — the judged sigma on the wire, and every stage on the axis

The Control view's histogram placed the 159 refusals by the sigma their
refusal sentence quoted and could place none of the 89 that cleared: their
scale, `sigma_pre_per_bar`, was in the ledger (populated on all 248 rows,
checked directly) and not on the wire. The plan's one gateway change.

Two fields join `DiffusionStageRun`, not one. `sigma_pre_per_bar` is the raw
scale. `terminal_sigmas` is the number the floor was actually compared with —
`|terminal_return| / (sigma_bar × √(terminal.seconds × 1000 / step_ms))` —
computed in `_run()` from `absorption.py`'s own `sigma_at_terminal`, which
`_judge`'s scale now also calls, so the formula lives once and the desk never
carries a copy. Shipping the raw sigma alone would have left the desk to
re-derive √bars from the interval string: a second implementation of the
gateway's arithmetic, which is the thing the parity fixtures exist to stop.

Parity, measured in-process over every ledger row before the restart:

    248 rows: refused 159 (wire sigma missing on 0), accepted 89 (missing on 0)
    refused: max |sentence − wire| after rounding to 2dp = 0.0000
    accepted: min 2.00σ  median 3.03σ  p90 6.68σ  max 8.00σ  (one at exactly 8)

A test in `test_diffusion_runs.py` pins the first ledger refusal — per-bar
sigma 0.00047305, move −0.0018434, 1m bars, 30m terminal → 30 bars → "0.71" —
and that a stage with no scale gets `None`, not nought.

`FloorDistance` reads `terminal_sigmas` first and the sentence only where the
wire has none (a gateway that predates the field degrades to the old figure,
not to a blank one). The axis runs to 8σ, the floor rule at 2σ, the last
bucket open-ended and titled "8.0σ and past"; buckets past the floor take
their own fill and the title says "cleared". Its `missing` line about the 89
placed nowhere is gone. Measured after: 105 keyboard stops on the view (45
before), 0 text clashes and 0 marks over text at 1600 and 1100.

`tools/openapi.json` (+22 lines), the digest (`d8f7e72c…`) and the generated
client were regenerated in that order; `test_openapi_contract` is green.

**One cost, recorded.** Restarting 8912 for the new code: the old process
held the DuckDB ledger lock through SIGTERM for over a minute and the
replacement exited on the conflict twice, so the port had no gateway for
about ninety seconds until a SIGKILL. That is one more hatched stretch on the
Survival tape — the kind the tape has explained since slice 5 — and the reason
`lsof -ti tcp:8912` is the wrong PID source: it lists the client sockets too.
`pgrep -f "uvicorn main:app.*8912"`, SIGTERM, then wait for the lock, not the
port.
