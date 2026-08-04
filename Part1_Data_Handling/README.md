# Part 1 — Data Handling & Analytics

**NUSSIF Developer Analyst Case Study — Part 2 is in
[`../Part2_Infrastructure/`](../Part2_Infrastructure/).**

298 rows of LLM API usage: find what is wrong with them, repair it with a stated
reason, and then answer three questions about spend. The notebook is generated
from `build_notebook.py` so the narrative is diff-able as text rather than
buried in cell JSON.

| File | What it is |
|---|---|
| `Part1_Data_Handling.ipynb` | The notebook, with all outputs executed |
| `Part1_Data_Handling.html` | HTML export (open in any browser, no server needed) |
| `build_notebook.py` | Generates the notebook — the narrative lives here as text so it is diff-able |
| `NUSSIF_2026_INFRA_ASSESSMENT.xlsx` | The source workbook, unmodified |

## Reproduce

```bash
pip install pandas numpy matplotlib openpyxl jupyter nbformat nbconvert
python build_notebook.py
jupyter nbconvert --execute --to notebook --inplace Part1_Data_Handling.ipynb
jupyter nbconvert --to html --template lab Part1_Data_Handling.ipynb
```

The notebook reads the workbook from its own directory, so it runs from here
without arguments.

## What it found

Seven defects in 298 rows (2.7%), each repaired with a documented decision rather
than silently dropped:

| Issue | Rows | Treatment |
|---|---|---|
| `date` mixes ISO and `DD/MM/YYYY` | 1 | Day-first — month-first would fall outside the window, and day-first fills the panel's only gap |
| `team` case variant (`platform`) | 1 | Canonicalised — ungrouped it splits every per-team total |
| `service` label variant (`Chat Router`) | 1 | Canonicalised — the cost ranking depends on grouping it as one |
| Exact duplicate row | 1 | Dropped — identical in all seven columns, so a double-counted export |
| Missing `cost_usd` | 1 | Imputed from tokens × the model's rate |
| Missing `total_tokens` | 1 | Imputed from cost ÷ the model's rate |
| `requests = -25`, and a cost 4.8× the model rate | 2 | Each row's *other* fields were cross-checked to find which single field was corrupt, and only that one was repaired |

The last row is the interesting one. On the negative-request row the tokens and
cost divide to exactly the published rate, so only `requests` was broken; on the
billing row the tokens-per-request was normal, so only `cost` was broken. Same
symptom class, opposite diagnosis — which is why each was checked rather than
both being capped or dropped.

The 4.8× billing anomaly is a **$106 overcharge on one line**, ~4% of the
window's total spend. It is restated at the published rate here and flagged as
something to query with the vendor.

## The three questions

**Trend.** Requests +22%, tokens +27%, cost +33% across the window. The ordering
is the finding: cost outrunning tokens means the model mix is drifting toward the
premium tier, not merely that volume is rising. A single "spend is up 33%" number
hides which of those two it is, and they have different fixes.

**Cost driver.** `doc-analysis` is **52% of spend on 6.5% of requests**.
Decomposed, request volume is ×0.45 — it makes *fewer* calls — while
tokens/request is ×6.1 and unit price is ×4.1, so one `doc-analysis` request
costs roughly **25×** a `ticket-summarizer` one. The lever is therefore model
choice and context size, not call volume; a campaign to reduce the number of
calls would target the one factor already working in the right direction.

**Assumptions.** Every transformation is logged as it happens and printed as a
register at the end, with a raw→clean reconciliation of every total. The point is
that a reader can disagree with a specific decision without having to re-derive
the whole notebook to find where it was made.

## Submission checklist

| # | Item | Where |
|---|---|---|
| 1 | Up-to-date CV | `CV_Ian_Wangsa.pdf` (alongside the repository in the submission zip) |
| 2 | HTML export of the Part 1 notebook | `Part1_Data_Handling.html` |
| 3 | Original Part 1 notebook | `Part1_Data_Handling.ipynb` |
| 4 | All code, outputs and supporting files for Part 2 | [`../Part2_Infrastructure/`](../Part2_Infrastructure/) — gateway, `web/`, `OpenBB_Service/` |
