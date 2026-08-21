# Part 1 — Data Handling & Analytics

**NUSSIF Developer Analyst Case Study — Part 2 is in
[`../Part2_Infrastructure/`](../Part2_Infrastructure/).**

298 rows of daily LLM API usage: find what is wrong with them, repair it with a
stated reason, and then answer three questions about spend. The notebook is
generated from `build_notebook.py` so the narrative is diff-able as text rather
than buried in cell JSON.

| File | What it is |
|---|---|
| `Part1_Data_Handling.html` | HTML export with all outputs — open in any browser, no server needed |
| `Part1_Data_Handling.ipynb` | The notebook, executed end to end |
| `build_notebook.py` | Generates the notebook — the narrative lives here as text so it is diff-able |
| `requirements.txt` | Pinned environment the committed outputs were produced in |
The source workbook, `NUSSIF_2026_INFRA_ASSESSMENT.xlsx`, is **not in this
repository**. It is the assessment's own material and this repository is public,
so it ships with the submission rather than with the code. Every output committed
here was produced from it, and the provenance cell prints its SHA-256 so a reader
holding the file can confirm it is the same one.

**Nothing needs to be re-executed to read the analysis** — the `.ipynb` and the
`.html` both carry every output. To re-run it, drop the workbook into this
directory first; the build stops with that instruction rather than a stack trace
if it is missing.

## Reproduce

```bash
python3.12 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python build_notebook.py
venv/bin/python -m jupyter nbconvert --execute --to notebook --inplace Part1_Data_Handling.ipynb
venv/bin/python -m jupyter nbconvert --to html Part1_Data_Handling.ipynb
```

The notebook reads the workbook from its own directory, so it runs from here
without arguments. Its first cell prints the interpreter version, the five analysis
library versions (pandas, numpy, scipy, statsmodels, matplotlib), the workbook's
SHA-256 and the random seed, so a reader can tell at a glance whether their run
matches the committed outputs. Every bootstrap is seeded; re-running gives identical
numbers.

**No derived number in the notebook's prose is typed by hand.** Markdown cells
carry argument, and quote literal values from the file verbatim (`09/05/2026`,
`requests = -25`); every quantity computed from the data is rendered from the
dataframe by the code cell above it. Re-running against a different file cannot
leave the text stale.

## How it is organised

| § | Section |
|---|---|
| 0 | Provenance; the schema contract; the cleaning pipeline defined once as a parameterised function, with unit checks on its rules; the figure style and its colour audit |
| 1 | Executive summary — the three answers and the one consequential caveat |
| 2 | What is wrong with the data, including the price rule and the ambiguous date — each argued with a figure |
| 3 | The cleaning decisions and the argument for each, with every repair drawn in place |
| 4 | Q1 — usage trend, fitted with confidence intervals |
| 5 | Q2 — cost driver, decomposed with bootstrap intervals |
| 6 | Q3 — assumptions, exclusions and transformations |
| 7 | Sensitivity analysis — the whole analysis re-run nine ways |
| 8 | Limitations — what this data cannot answer |
| 9 | What I would do next |

The pipeline is a single function rather than a sequence of mutating cells because
§7 has to run it nine different ways. That is also what makes the sensitivity
analysis a measurement rather than a second implementation.

Fifteen figures, numbered in execution order by a counter rather than by hand, each
captioned with what it shows, what was excluded, and the one thing to conclude from
it. Every figure carries a written text alternative, and no set of axes ever asks a
reader to tell two of the notebook's three identity hues apart — an invariant a
helper asserts on every figure before it is displayed.

## What it found in the data

Eight defects across 7 of 298 rows (2.3%), in eight classes. Defects and bad rows
are different counts because one row carries two of them.

| Issue | Rows | Treatment |
|---|---|---|
| `date` mixes ISO and `DD/MM/YYYY` | 1 | Day-first — month-first falls outside the window every other row occupies, and day-first fills the only gap in `ticket-summarizer`'s own series exactly (the panel has four gaps in all) |
| `team` case variant (`platform`) | 1 | Canonicalised — ungrouped it splits every per-team total |
| `service` label variant (`Chat Router`) | 1 | Canonicalised — the cost ranking depends on grouping it as one |
| Exact duplicate row | 1 | Dropped — identical in all seven columns, so a double-counted export |
| Missing `cost_usd` | 1 | Computed from tokens × the service's rate |
| Missing `total_tokens` | 1 | Computed from cost ÷ the service's rate |
| `requests = -25` | 1 | Only `requests` was corrupt — the row's tokens and cost obey the price rule to the cent |
| Cost 4.8× the service's rate | 1 | Only `cost` was corrupt — the row's tokens per request is ordinary for that service |

The last two rows are the interesting pair. Same symptom class, opposite diagnosis,
which is why each row's *other* fields were cross-checked to find which single field
was broken rather than both being capped or dropped.

**The price rule.** `cost_usd = round(total_tokens × rate(service) / 1000, 2)`
reproduces every untouched row in the file to the cent. That is a stronger fact than
it looks: it makes both imputations arithmetic rather than estimates, and it makes
the one row that disobeys unambiguous. Note the grain — the rate is **per service**,
not per model. Three services share `gpt-4.1-mini` and bill at $0.011, $0.012 and
$0.014 per 1k tokens; taking the rate per model instead is wrong by up to 17% on a
service's unit cost.

**A $106.29 billing anomaly on one line** — $134.26 charged where the rule gives
$27.97, 3.9% of the window's billed total. Restated here and flagged for the vendor.

## The three answers

**Trend.** Spend is growing **+3.54% a week** (95% CI +2.91 to +4.17, p ≈ 1e-28),
which doubles it in about 4.6 months. Requests (+3.65%) and tokens (+3.60%) grow at
rates indistinguishable from cost, and the ratio tests confirm it directly: blended
price per token trends −0.06%/week (p = 0.80) and tokens per request −0.05%/week
(p = 0.82). **This is volume growth at constant unit economics** — no mix drift, no
prompt bloat.

That last point matters, because the obvious method gives the opposite answer. A
first-week-versus-last-week comparison that trims both ends as a precaution — which
here discards a week that was in fact complete — reports +22% requests, +27% tokens,
+33% cost, and with it a tidy story about the model mix drifting to the premium tier.
Fitted over the whole window with standard errors that respect the serial correlation,
that story disappears. §4.3 shows what all 36 pairs of endpoint weeks would have
concluded: they span −9.8 to +10.1 points a week and split 47/53 on the sign. The
fitted estimate is −0.11 points a week (−0.93 to +0.73).

**Cost driver.** `doc-analysis` is **52.3% of spend on 6.5% of requests** (95%
interval 51.6% to 53.7%; it is the biggest spender and the smallest caller in all
10,000 bootstrap replicates). Decomposed against `ticket-summarizer`, request volume
is ×0.45 — it makes *fewer* calls — while tokens per request is ×6.1 and unit price
×4.1, so one `doc-analysis` request costs about **25×** one `ticket-summarizer`
request. The lever is model choice and context size, not call volume; a campaign to
reduce calls would attack the one factor already working in the right direction.

Sizing it conservatively: at the dearest of the non-premium tiers, `doc-analysis`
would have cost $428 rather than $1,376 over this window — a **$948 saving, 36% of
total spend**. That is a ceiling, not a plan. This data records what was spent, not
whether the cheaper model's answers would have been good enough.

**Assumptions.** Every transformation is logged as it happens and printed as a
register, with a raw→clean reconciliation of every total. A reader can disagree with
one decision without re-deriving the notebook to find where it was made — and §7
tells them what disagreeing would cost.

## What the sensitivity analysis changed

§7 re-runs the entire analysis — cleaning, aggregation and both estimators — under
nine cleanings, each flipping one judgement call.

**Q2 survives everything.** `doc-analysis` is the cost leader in all nine; its share
moves at most 1.85 points, and the cost-per-request ratio at most 1.93× on a base
of 25×.

**One decision changes Q1 materially: the date.** Read month-first, weekly growth is
+1.21% with an interval of −2.49 to +5.04% — no longer distinguishable from zero,
because it moves one row four months — 9 May to 5 September — stranding it 83 days
past the last row in the file, with enormous leverage on the fit. That does not
make the growth finding fragile; it means *that* reading destroys the series. The
evidence for day-first is independent of the trend and was settled before any model
was fitted. The point of reporting it is that a reader who rejects the date argument
must also give up the growth estimate.

Everything else is near-immaterial — under 0.51 points on the cost share. Notably,
reading `requests = -25` as a sign flip changes no cost figure at all.

## What changed on 2026-08-17

The notebook's three answers did not move; everything around them tightened.

**More of the argument is drawn.** Six figures became fifteen. The additions put a
picture under each claim that previously rested on a table: the price rule as a
per-service scatter with the one disobedient row ringed; the ambiguous date shown
against every service's day-by-day coverage under both readings; the defect
register as a row-by-class map; every repair marked on the as-delivered versus
clean daily series; the reconciliation as one bar per repair per measure; the
weekday cycle the trend model's dummies absorb; the two ratio series behind the
"no drift" finding, with their fitted bands; the Q2 decomposition as a
dot-and-interval plot on a log axis; and the cost leader's share stacked week by
week.

**The handling now states its contract and proves its rules.** §0.1 validates the
workbook against an explicit schema — columns, delivered types, value rules —
failing loudly on drift and printing one row per column. The parsers refuse to
guess: unparseable numbers and dates raise instead of becoming `NaN`, and rows
sharing a key with *different* measures stop the pipeline as a conflicting
restatement (a policy the file never triggers, tested anyway). The register now
records, per repair, the workbook rows touched and the change to each measure,
and the build asserts that raw totals plus logged deltas equal clean totals to
the cent, that row counts reconcile, and that `clean(clean(x)) == clean(x)`. A
unit-check cell exercises every parsing and canonicalisation rule on synthetic
values — thousands separators, currency signs, both date orders, underscore label
variants — so a regression fails the run three cells in.

## Submission checklist

| # | Item | Where |
|---|---|---|
| 1 | Up-to-date CV | `CV_Ian_Wangsa.pdf` (alongside the repository in the submission zip) |
| 2 | HTML export of the Part 1 notebook | `Part1_Data_Handling.html` |
| 3 | Original Part 1 notebook | `Part1_Data_Handling.ipynb` |
| 4 | All code, outputs and supporting files for Part 2 | [`../Part2_Infrastructure/`](../Part2_Infrastructure/) — gateway, `web/`, `OpenBB_Service/` |
