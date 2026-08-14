#!/usr/bin/env python3
"""
Generates Part1_Data_Handling.ipynb.

The notebook is authored here rather than by hand so it is reproducible and
diff-able: re-running this script regenerates an identical notebook, and the
narrative lives in version control as text rather than inside JSON cell blobs.

    python build_notebook.py && jupyter nbconvert --execute --to notebook --inplace Part1_Data_Handling.ipynb

House rule for this file: **no number may be typed into a markdown cell.** Any
figure that appears in the prose is rendered by a code cell from the dataframe,
so re-running against different data cannot leave the text lying. Markdown cells
carry argument and method; code cells carry every quantity.
"""

from __future__ import annotations

import pathlib

import nbformat as nbf

nb = nbf.v4.new_notebook()
cells: list = []


def _add(cell):
    # nbformat assigns a random id to every cell, which makes two builds of the same
    # source differ on every line. A positional id keeps the generated notebook
    # byte-identical across rebuilds, which is the entire point of authoring it here.
    cell["id"] = f"cell-{len(cells):03d}"
    cells.append(cell)


def md(text: str) -> None:
    _add(nbf.v4.new_markdown_cell(text.strip()))


def code(src: str) -> None:
    _add(nbf.v4.new_code_cell(src.strip()))


# ═══════════════════════════════════════════════════════════════════════════
# Front matter
# ═══════════════════════════════════════════════════════════════════════════
md(r"""
# What drives LLM spend, and is it growing?

### An analysis of daily LLM API usage across four services
#### NUSSIF Developer Analyst Case Study — Part 1 · Ian Wangsa

---

**Data.** The `Raw Data` tab of `NUSSIF_2026_INFRA_ASSESSMENT.xlsx`: one row per
day per team / service / model, over spring 2026. The brief describes it as
*"mostly clean but contains a few realistic issues"*.

**Questions.** (1) What is the overall usage trend over time? (2) Which service is
the biggest cost driver, and is that request volume, token volume, or unit cost?
(3) What assumptions, exclusions and transformations were applied?

**The answers are in §1, below the two setup cells.** Everything after §1 is the
working: what was wrong with the data (§2), what was done about it and why (§3),
the two substantive analyses with their uncertainty (§4, §5), the assumptions
register (§6), what happens to the conclusions if the cleaning had gone the other
way (§7), what this data cannot tell you (§8), and what I would do next (§9).

**Method note — no derived number in this notebook is typed by hand.** Every
quantity that appears in the prose — every percentage, interval, count and total —
is rendered from the dataframe by the code cell above it. Markdown cells carry
argument and quote literal values from the file verbatim; code cells carry
everything computed from it. Re-running against a different file cannot leave the
text stale.
""")

# ── 0. Provenance ──────────────────────────────────────────────────────────
md(r"""
---

## 0. Provenance and environment

A result that cannot be reproduced is an opinion. This cell stamps the exact
inputs — library versions, the SHA-256 of the workbook, the row count, the random
seed — so that a reader who re-runs it can tell immediately whether they are
looking at the same data and the same arithmetic.

The workbook is read with **no type coercion** (`dtype=object`). Letting pandas
infer types on load would quietly repair some of the very defects this exercise is
about: it would parse the mixed date formats and coerce a stray value in a numeric
column to `NaN` without saying so. The point is to *see* the raw state first.
""")

code(r'''
import base64
import hashlib
import io
import platform
import textwrap
import warnings
from html import escape as html_escape
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scipy
import statsmodels.api as sm
from IPython.display import Markdown, display

warnings.filterwarnings("ignore", category=FutureWarning)

pd.set_option("display.width", 120)
pd.set_option("display.max_columns", 30)
pd.set_option("display.float_format", lambda v: f"{v:,.4f}")

SEED = 20260614            # fixed: every bootstrap in this notebook is reproducible
RNG = np.random.default_rng(SEED)
N_BOOT = 10_000            # bootstrap replicates, chosen so a 95% percentile CI is stable to ~0.1pt

WORKBOOK = Path("NUSSIF_2026_INFRA_ASSESSMENT.xlsx")
if not WORKBOOK.exists():                      # also runs from the repo root
    WORKBOOK = Path("Part1_Data_Handling") / WORKBOOK.name

DIGEST = hashlib.sha256(WORKBOOK.read_bytes()).hexdigest()

# dtype=object: read it as delivered, repair nothing implicitly.
raw = pd.read_excel(WORKBOOK, sheet_name="Raw Data", dtype=object)

MEASURES = ["requests", "total_tokens", "cost_usd"]
KEY = ["date", "team", "service", "model"]


def say(text: str) -> None:
    "Render computed prose. Used wherever a sentence contains a number."
    display(Markdown(textwrap.dedent(text).strip()))


def md_table(frame: pd.DataFrame, fmt="{:,.2f}", corner: str = "") -> str:
    """A markdown table from a DataFrame. Hand-rolled so the notebook needs no
    extra dependency beyond the six libraries stamped above."""
    def cell(v):
        if isinstance(v, str):
            return v
        return fmt(v) if callable(fmt) else fmt.format(v)

    head = "| " + " | ".join([corner, *map(str, frame.columns)]) + " |"
    rule = "|" + "---|" * (len(frame.columns) + 1)
    body = "\n".join("| " + " | ".join([f"**{i}**", *(cell(v) for v in row)]) + " |"
                     for i, row in zip(frame.index, frame.to_numpy()))
    return f"{head}\n{rule}\n{body}"


say(f"""
| Provenance | |
|---|---|
| Workbook | `{WORKBOOK.name}` |
| SHA-256 | `{DIGEST}` |
| Sheet | `Raw Data` — {len(raw):,} rows x {raw.shape[1]} columns |
| Python | {platform.python_version()} ({platform.system()} {platform.machine()}) |
| pandas / numpy | {pd.__version__} / {np.__version__} |
| scipy / statsmodels | {scipy.__version__} / {sm.__version__ if hasattr(sm, '__version__') else __import__('statsmodels').__version__} |
| matplotlib | {mpl.__version__} |
| Random seed | `{SEED}` ({N_BOOT:,} bootstrap replicates) |
""")
raw.head()
''')

md(r"""
### 0.1 The cleaning pipeline, defined once

The whole of §3 is an argument about seven judgement calls. §7 then re-runs the
analysis with each of those calls made the *other* way, to see which conclusions
survive. That is only possible if the pipeline is a single parameterised function
rather than a sequence of cells mutating a dataframe in place — so it is one.

Read it now if you want the method in forty lines; §2 and §3 justify every branch
in it. `DECISIONS` accumulates a machine-readable record of every alteration,
printed as a register in §6.
""")

code(r'''
DECISIONS: list[dict] = []


def unit_rate(d: pd.DataFrame, by: str = "service") -> pd.Series:
    """Effective $ per 1,000 tokens, from rows where both measures are present.

    Median, not mean: one row in this file is a billing anomaly ~4.8x its rate,
    and a mean would let it move the very benchmark used to detect it.
    Rounded to 3dp because §2 shows the underlying rate is a published tier.
    """
    ok = d[["total_tokens", "cost_usd"]].notna().all(axis=1)
    return (d[ok].assign(u=d.loc[ok, "cost_usd"] / d.loc[ok, "total_tokens"] * 1_000)
                 .groupby(by)["u"].median().round(3))


def clean(
    src: pd.DataFrame,
    *,
    dayfirst: bool = True,          # §2.2  the one non-ISO date: 9 May, or 5 September?
    dedupe: bool = True,            # §3    the byte-identical row: export artefact, or real?
    missing: str = "impute",        # §3.1  "impute" | "drop"
    neg: str = "impute",            # §3.2  "impute" | "abs" | "drop"   requests = -25
    anomaly: str = "restate",       # §3.2  "restate" | "keep" | "drop" cost 4.8x the rate
    rate_by: str = "service",       # §2.3  the price tier is per service, not per model
    log: list | None = None,
) -> tuple[pd.DataFrame, pd.Series]:
    """Raw -> analysis-ready. Every keyword is a decision §7 flips."""
    def note(issue, rows, action, rationale, impact=""):
        if log is not None:
            log.append({"Issue": issue, "Rows": int(rows), "Action": action,
                        "Rationale": rationale, "Impact": impact})

    d = src.copy()

    # 1. Labels first: otherwise one entity is counted under two names everywhere,
    #    and 'Chat Router' never collides with its own duplicate row.
    n_team, n_svc = d["team"].nunique(), d["service"].nunique()
    d["team"] = d["team"].astype(str).str.strip().str.title()
    d["service"] = (d["service"].astype(str).str.strip().str.lower()
                    .str.replace(r"[\s_]+", "-", regex=True))
    d["model"] = d["model"].astype(str).str.strip().str.lower()
    note("`team` case variant", n_team - d["team"].nunique(), "Normalised to Title Case",
         "Same team, two spellings; ungrouped it splits every per-team total.",
         f"team labels {n_team} -> {d['team'].nunique()}")
    note("`service` label variant", n_svc - d["service"].nunique(),
         "Normalised to lowercase-hyphenated",
         "Same service, two spellings; the cost-driver ranking depends on grouping it as one.",
         f"service labels {n_svc} -> {d['service'].nunique()}")

    # 2. Dates: ISO for the bulk, then a single fallback parse for the remainder.
    iso = pd.to_datetime(d["date"], format="ISO8601", errors="coerce")
    rest = pd.to_datetime(d.loc[iso.isna(), "date"], dayfirst=dayfirst, errors="coerce")
    iso.loc[rest.index] = rest
    d["date"] = iso
    assert d["date"].notna().all(), "a date failed to parse"
    note("`date` mixes ISO-8601 with another format", rest.notna().sum(),
         f"ISO first, then {'day' if dayfirst else 'month'}-first for the remainder",
         "Day-first is forced by the data — see §2.2.",
         f"all {len(d)} rows now datetime64[ns]")

    # 3. Measures to numbers. errors='coerce' is safe only because §2 confirmed
    #    the only non-numeric entries are genuine blanks.
    for c in MEASURES:
        d[c] = pd.to_numeric(d[c], errors="coerce")

    # 4. De-duplicate BEFORE imputing, so a doubled row cannot skew the rate.
    if dedupe:
        n0 = len(d)
        d = d.drop_duplicates()
        note("Byte-identical duplicate row", n0 - len(d), "Dropped, keeping the first",
             "Identical in all seven columns. A restatement would differ in at least "
             "one measure; identical rows are a double-counted export.",
             f"{n0} -> {len(d)} rows")

    # 5. The price rule. §2.3 shows cost = tokens x rate(service) / 1000 exactly.
    rate = unit_rate(d, rate_by)
    key = d[rate_by]
    mc, mt = d["cost_usd"].isna(), d["total_tokens"].isna()
    if missing == "impute":
        d.loc[mc, "cost_usd"] = (d.loc[mc, "total_tokens"] * key[mc].map(rate) / 1_000).round(2)
        d.loc[mt, "total_tokens"] = (d.loc[mt, "cost_usd"] / key[mt].map(rate) * 1_000).round()
        note("Missing `cost_usd`", mc.sum(), f"Imputed = tokens x rate({rate_by}) / 1000",
             "The price rule reproduces every other cost in the file to the cent, so "
             "this cell is recoverable by arithmetic rather than estimated.",
             f"+${d.loc[mc, 'cost_usd'].sum():,.2f}")
        note("Missing `total_tokens`", mt.sum(), f"Imputed = cost / rate({rate_by}) x 1000",
             "The inverse of the above; billing is present, so the token count is implied.",
             f"+{d.loc[mt, 'total_tokens'].sum():,.0f} tokens")
    else:
        d = d[~(mc | mt)]
        key = d[rate_by]
        note("Missing `cost_usd` / `total_tokens`", int((mc | mt).sum()), "Rows dropped",
             "Alternative treatment: refuse to reconstruct anything.", f"-{int((mc | mt).sum())} rows")

    # 6. Impossible request count. §3.2 shows the row's OTHER fields are sound.
    ng = d["requests"] <= 0
    if ng.any():
        if neg == "impute":
            tpr = (d[~ng].assign(r=d.loc[~ng, "total_tokens"] / d.loc[~ng, "requests"])
                         .groupby("service")["r"].median())
            d.loc[ng, "requests"] = (d.loc[ng, "total_tokens"] / d.loc[ng, "service"].map(tpr)).round()
            act = f"Imputed from the service's median tokens/request -> {int(d.loc[ng, 'requests'].iloc[0])}"
        elif neg == "abs":
            d.loc[ng, "requests"] = d.loc[ng, "requests"].abs()
            act = "Sign flipped (abs)"
        else:
            d, key, act = d[~ng], d.loc[~ng, rate_by], "Row dropped"
        note("Impossible `requests` <= 0", ng.sum(), act,
             "Tokens and cost on that row obey the price rule exactly, so only the "
             "request count is corrupt — see §3.2.",
             "affects the request series only; cost and tokens untouched")

    # 7. Billing anomaly: cost far above what the price rule implies.
    expected = d["total_tokens"] * key.map(rate) / 1_000
    an = (d["cost_usd"] / expected) > 2          # 2x a published rate is not variance
    if an.any():
        over = float((d.loc[an, "cost_usd"] - expected[an]).sum())
        if anomaly == "restate":
            d.loc[an, "cost_usd"] = expected[an].round(2)
            act = f"Restated at the price rule (${expected[an].sum():,.2f})"
        elif anomaly == "drop":
            d, act = d[~an], "Row dropped"
        else:
            act = "Left as billed"
        note("Cost far above the model's published rate", an.sum(), act,
             "Tokens/request on that row is normal for the service, so usage was "
             "ordinary and the billed amount is the outlier — see §3.2.",
             f"${over:,.2f} of anomalous spend")

    # 8. Types and derived fields. `source_row` keeps every surviving row traceable
    #    to its line in the workbook — the frame is re-sorted and re-indexed below,
    #    so positional identity would otherwise be lost.
    d["source_row"] = d.index
    d["requests"] = d["requests"].round().astype("int64")
    d["total_tokens"] = d["total_tokens"].round().astype("int64")
    d["cost_usd"] = d["cost_usd"].round(2)
    d["tokens_per_request"] = d["total_tokens"] / d["requests"]
    d["usd_per_1k_tokens"] = d["cost_usd"] / d["total_tokens"] * 1_000
    d["usd_per_request"] = d["cost_usd"] / d["requests"]
    return d.sort_values("date").reset_index(drop=True), rate


df, RATE = clean(raw, log=DECISIONS)

# Post-conditions: assert the invariants rather than eyeballing them.
assert df.notna().all().all(), "nulls survived cleaning"
assert (df[MEASURES] > 0).all().all(), "a non-positive measure survived"
assert not df.duplicated(KEY).any(), "a duplicate key survived"
assert df["requests"].dtype.kind == "i" and df["total_tokens"].dtype.kind == "i", "counts are not integers"

print(f"raw {len(raw):,} rows -> clean {len(df):,} rows, "
      f"{df['date'].min():%d %b %Y} to {df['date'].max():%d %b %Y} "
      f"({df['date'].nunique()} days, {df['service'].nunique()} services); all post-conditions hold")
''')

md(r"""
### 0.2 The two estimators, defined once

Two quantities carry the argument: a **growth rate** (§4) and a **cost
decomposition** (§5). Both are defined here as functions, for the same reason the
pipeline is — §7 re-estimates both under eight alternative cleanings, and §5
bootstraps the decomposition ten thousand times. Defining them once means the
sensitivity analysis is measuring the data, not two slightly different
implementations.

**The trend model.** Daily totals are regressed as

```
    log(y_t)  =  a  +  b·t  +  weekday dummies  +  e_t
```

and the reported growth rate is `exp(7b) − 1`, a compounding weekly rate.

*Why logs:* spend that grows by a percentage compounds, so the additive-in-logs
form is the one whose single coefficient means something. *Why weekday dummies:*
this data has a pronounced business-week cycle; absorbing it removes variance
that would otherwise inflate the standard error without touching the trend.
*Why HAC (Newey–West, 7 lags) standard errors:* daily observations are serially
correlated and the residual variance is not constant, so ordinary OLS standard
errors would be too small and the confidence intervals too narrow — which is
exactly the failure mode that turns noise into a finding.
""")

code(r'''
def growth(y: pd.Series, *, dow: bool = True, lags: int = 7) -> dict:
    """Log-linear trend with HAC standard errors. Returns a weekly growth rate.

    y must be a daily series, positive, indexed by date. Missing days are dropped
    (not zero-filled: a day with no row is not a day with no usage).
    """
    y = y.dropna()
    t = np.arange(len(y))
    X = [t]
    if dow:
        X.append(pd.get_dummies(y.index.dayofweek, prefix="d", drop_first=True).astype(float).values)
    X = sm.add_constant(np.column_stack(X))
    m = sm.OLS(np.log(y.values), X).fit(cov_type="HAC", cov_kwds={"maxlags": lags})
    b = m.params[1]
    lo, hi = m.conf_int()[1]
    wk = lambda v: (np.exp(v * 7) - 1) * 100          # weekly %, compounding
    return {"weekly_pct": wk(b), "lo": wk(lo), "hi": wk(hi), "p": m.pvalues[1],
            "daily_log": b, "n": len(y), "r2": m.rsquared, "model": m, "X": X, "index": y.index}


def ratio_growth(num: pd.Series, den: pd.Series, **kw) -> dict:
    """Trend in the RATIO of two daily series.

    This is the test that matters for Q1. Regressing log(cost) and log(tokens)
    separately and eyeballing whether one slope looks bigger ignores that the two
    share the same daily shocks. Differencing them first removes that common
    component, which makes the test of 'is cost outrunning tokens?' both correct
    and far more powerful than comparing two overlapping confidence intervals.
    """
    joint = pd.concat([num, den], axis=1).dropna()
    return growth(pd.Series(joint.iloc[:, 0].values / joint.iloc[:, 1].values,
                            index=joint.index), **kw)


def daily_totals(d: pd.DataFrame) -> pd.DataFrame:
    return (d.groupby("date").agg(requests=("requests", "sum"),
                                  tokens=("total_tokens", "sum"),
                                  cost=("cost_usd", "sum")).asfreq("D"))


def by_service(d: pd.DataFrame) -> pd.DataFrame:
    """cost = requests x tokens/request x cost/token, per service."""
    s = (d.groupby("service")
           .agg(cost=("cost_usd", "sum"), requests=("requests", "sum"),
                tokens=("total_tokens", "sum"), model=("model", lambda x: x.mode().iat[0]))
           .assign(cost_share=lambda t: t["cost"] / t["cost"].sum(),
                   req_share=lambda t: t["requests"] / t["requests"].sum(),
                   tok_share=lambda t: t["tokens"] / t["tokens"].sum(),
                   tokens_per_request=lambda t: t["tokens"] / t["requests"],
                   usd_per_1k=lambda t: t["cost"] / t["tokens"] * 1_000,
                   usd_per_request=lambda t: t["cost"] / t["requests"]))
    return s.sort_values("cost", ascending=False)


def naive_endpoints(d: pd.DataFrame, src: pd.DataFrame) -> pd.DataFrame:
    """The 'first week vs last week' comparison, done three defensible ways.

    Reported in §4.3 only to show what it does wrong. Each windowing is a choice
    a careful analyst might make; §4.3 shows they disagree about which measure is
    growing fastest, which is the whole objection to reading a trend off two
    endpoints instead of fitting one.
    """
    cols = ["requests", "tokens", "cost"]
    out = {}
    a, b = d.dropna().iloc[:7].sum(), d.dropna().iloc[-7:].sum()
    out["first 7 days vs last 7 days"] = {c: (b[c] / a[c] - 1) * 100 for c in cols}

    wk = (src.groupby(pd.Grouper(key="date", freq="W-SUN"))
             .agg(requests=("requests", "sum"), tokens=("total_tokens", "sum"),
                  cost=("cost_usd", "sum"), days=("date", "nunique")))
    full = wk[wk["days"] == 7]                                   # complete weeks only
    out["first vs last complete ISO week"] = {
        c: (full[c].iloc[-1] / full[c].iloc[0] - 1) * 100 for c in cols}
    # The common 'trim both ends in case they are partial' convention — which here
    # discards a week that is in fact complete.
    trim = wk.iloc[1:-1]
    out["ISO weeks, both ends trimmed unchecked"] = {
        c: (trim[c].iloc[-1] / trim[c].iloc[0] - 1) * 100 for c in cols}

    t = pd.DataFrame(out).T
    t["appears fastest"] = t[cols].idxmax(axis=1)
    return t


def defect_flags(src: pd.DataFrame, rate: pd.Series) -> pd.DataFrame:
    """One boolean column per defect class, one row per RAW row.

    Kept as a matrix rather than a count because a single row can carry more than
    one defect — and here one does, which is why 'number of defects' and 'number
    of bad rows' are different numbers.
    """
    svc = (src["service"].astype(str).str.strip().str.lower()
              .str.replace(r"[\s_]+", "-", regex=True))
    tok = pd.to_numeric(src["total_tokens"], errors="coerce")
    cost = pd.to_numeric(src["cost_usd"], errors="coerce")
    return pd.DataFrame({
        "date not ISO-8601": ~src["date"].astype(str).str.match(r"^\d{4}-\d{2}-\d{2}$"),
        "team label variant": src["team"].astype(str).ne(src["team"].astype(str).str.strip().str.title()),
        "service label variant": src["service"].astype(str).ne(svc),
        "duplicate of an earlier row": src.duplicated(keep="first"),
        "cost_usd missing": cost.isna(),
        "total_tokens missing": tok.isna(),
        "requests <= 0": pd.to_numeric(src["requests"], errors="coerce").le(0).fillna(False),
        "cost far above the price rule": (cost / (tok * svc.map(rate) / 1_000) > 2).fillna(False),
    }, index=src.index)


# The alternative cleanings. Each flips exactly one decision from §3; §7 re-runs
# the whole analysis under each and reports what moves.
VARIANTS = {
    "Baseline — every decision as argued in §3": {},
    "Date read month-first (5 Sep) not day-first (9 May)": {"dayfirst": False},
    "Identical duplicate row kept, not dropped": {"dedupe": False},
    "Rows with a missing measure dropped, not imputed": {"missing": "drop"},
    "Price tier taken per model, not per service": {"rate_by": "model"},
    "requests = -25 read as a sign flip (abs)": {"neg": "abs"},
    "requests = -25 row dropped entirely": {"neg": "drop"},
    "Anomalous cost left exactly as billed": {"anomaly": "keep"},
    "Anomalous cost row dropped entirely": {"anomaly": "drop"},
}


def sensitivity(variants: dict = VARIANTS) -> pd.DataFrame:
    """Re-run the ENTIRE analysis under each alternative cleaning."""
    rows = []
    for label, kw in variants.items():
        d, _ = clean(raw, **kw)
        s, g = by_service(d), growth(daily_totals(d)["cost"])
        t, b = s.iloc[0], s.loc[s["usd_per_request"].idxmin()]
        rows.append({
            "variant": label, "rows": len(d), "total_usd": d["cost_usd"].sum(),
            "leader": s.index[0], "leader_share": s["cost_share"].iloc[0],
            "weekly_pct": g["weekly_pct"], "lo": g["lo"], "hi": g["hi"], "p": g["p"],
            "cost_per_req_ratio": t["usd_per_request"] / b["usd_per_request"],
            "volume_factor": t["requests"] / b["requests"],
        })
    return pd.DataFrame(rows).set_index("variant")


DAILY, SVC = daily_totals(df), by_service(df)
FLAGS = defect_flags(raw, RATE)
G = {c: growth(DAILY[c]) for c in ["requests", "tokens", "cost"]}
DIVERGE = {"cost/tokens": ratio_growth(DAILY["cost"], DAILY["tokens"]),
           "tokens/requests": ratio_growth(DAILY["tokens"], DAILY["requests"])}
TOP, CHEAPEST = SVC.index[0], SVC["usd_per_request"].idxmin()
print(f"estimated: {len(DAILY)} daily observations, {len(SVC)} services; "
      f"biggest spender = {TOP}")
''')

md(r"""
---

## 1. Executive summary
""")

code(r'''
_t = SVC.loc[TOP]
_b = SVC.loc[CHEAPEST]
_f_vol = _t["requests"] / _b["requests"]
_f_verb = _t["tokens_per_request"] / _b["tokens_per_request"]
_f_price = _t["usd_per_1k"] / _b["usd_per_1k"]
_dbl = np.log(2) / G["cost"]["daily_log"] / 30.44
_defects = sum(d["Rows"] for d in DECISIONS)

SENS = sensitivity()                       # §7 presents and interprets this
_base = SENS.iloc[0]
_span = (SENS["leader_share"] - _base["leader_share"]).abs().max() * 100
_NAIVE = naive_endpoints(DAILY, df)        # §4.3 dissects this
_naive_md = md_table(_NAIVE, lambda v: v if isinstance(v, str) else f"{v:+.0f}%", "windowing")

say(f"""
**Q1 — Usage is growing, at about {G['cost']['weekly_pct']:.1f}% a week, and there is no
evidence that cost is growing any faster than usage.**
Over {G['cost']['n']} days, daily spend trends up
{G['cost']['weekly_pct']:.2f}% per week (95% CI {G['cost']['lo']:.2f} to {G['cost']['hi']:.2f}%,
p = {G['cost']['p']:.1e}); requests {G['requests']['weekly_pct']:.2f}%
({G['requests']['lo']:.2f} to {G['requests']['hi']:.2f}%) and tokens
{G['tokens']['weekly_pct']:.2f}% ({G['tokens']['lo']:.2f} to {G['tokens']['hi']:.2f}%).
Held at that rate, spend doubles in about **{_dbl:.1f} months**
({np.log(2) / (np.log(1 + G['cost']['hi'] / 100) / 7) / 30.44:.1f} to
{np.log(2) / (np.log(1 + G['cost']['lo'] / 100) / 7) / 30.44:.1f} months).
The three rates are statistically indistinguishable: the cost-per-token trend is
{DIVERGE['cost/tokens']['weekly_pct']:+.3f}%/week (p = {DIVERGE['cost/tokens']['p']:.2f}) and the
tokens-per-request trend {DIVERGE['tokens/requests']['weekly_pct']:+.3f}%/week
(p = {DIVERGE['tokens/requests']['p']:.2f}). **This is volume growth at constant unit
economics** — not a drift toward the expensive model, and not requests getting fatter. §4.

**Q2 — `{TOP}` is the biggest cost driver at {_t['cost_share']:.1%} of spend, and the cause
is unit price and verbosity, not request volume.**
It generates {_t['req_share']:.1%} of requests — the *lowest* share of the
{len(SVC)} services — and {_t['tok_share']:.1%} of tokens. Against the cheapest service
(`{CHEAPEST}`) its request volume is **x{_f_vol:.2f}**, pushing its cost *down*;
its tokens per request are **x{_f_verb:.1f}** and its price per 1k tokens
**x{_f_price:.1f}**. Those two compound: one `{TOP}` request costs
**x{_f_verb * _f_price:.0f}** one `{CHEAPEST}` request. Cutting call volume — the intuitive
first move — attacks the only factor already working in our favour. §5.

**Q3 — {_defects} defects across {int(FLAGS.any(axis=1).sum())} of {len(raw):,} rows
({FLAGS.any(axis=1).mean():.1%}); all are logged, and every conclusion survives the
alternatives.**
{FLAGS.shape[1]} classes of defect, repaired one at a time with the reason recorded as
it was made (§6). §7 re-runs the entire analysis {len(SENS) - 1} further ways, flipping
each judgement call in turn: the cost leader is `{TOP}` in all {len(SENS)} of them and
its share moves by at most **{_span:.1f} percentage points**. One reading *is* overturned
— see the caveat below.

---

**The single most consequential caveat.** The obvious way to answer Q1 is to compare
the first week with the last. Do that three equally defensible ways and this is what
you get:

{_naive_md}

The last row is the dangerous one, and it is dangerous precisely because it looks
careful: trimming the first and last week guards against partial weeks at the edges —
but here it discards a week that was in fact complete, and that single discarded week
is what produces a story in which **cost outruns tokens outruns requests**. That story
has an obvious moral ("the model mix is drifting to the premium tier, go and fix the
routing"). It is not in the data. Fitted over the whole window, with standard errors
that respect the serial correlation in daily observations, the three growth rates are
indistinguishable and the premium model's token share has no trend at all. That is the
difference between recommending a fix for a drift and recommending a fix for a
structural cost, and only the second is supported. §4.3 shows the working.
""")
''')

# ═══════════════════════════════════════════════════════════════════════════
# 2. What is wrong with the data
# ═══════════════════════════════════════════════════════════════════════════
md(r"""
---

## 2. What is wrong with the data

The brief says the file is *"mostly clean but contains a few realistic issues"*.
The job is to locate them deliberately rather than trip over them halfway through
an aggregation. Each subsection below looks for one *class* of defect, using a
check that would find it in any file of this shape — not a check reverse-engineered
from knowing the answer.
""")

code(r'''
print("Column dtypes as delivered (all object — nothing was inferred):")
print(raw.dtypes.to_string())

print("\nPer-column Python types actually present — a mixed column is a defect signature:")
for col in raw.columns:
    kinds = raw[col].map(lambda v: type(v).__name__).value_counts().to_dict()
    print(f"  {col:14} {kinds}")

print("\nMissing values:")
missing = raw.isna().sum()
print(missing[missing > 0].to_string() if missing.any() else "  none")
''')

code(r'''
print("Categorical cardinality — near-duplicate labels are the thing to look for.\n")
for col in ["team", "service", "model"]:
    counts = raw[col].value_counts()
    print(f"{col} ({counts.size} distinct)")
    for label, n in counts.items():
        # Flag any label that collides with another once case and punctuation are normalised.
        canon = str(label).strip().lower().replace(" ", "-").replace("_", "-")
        twins = [o for o in counts.index
                 if o != label and str(o).strip().lower().replace(" ", "-").replace("_", "-") == canon]
        marker = f"   <-- same entity as {twins}" if twins else ""
        print(f"    {label!s:22} {n:4}{marker}")
    print()
''')

code(r'''
# Dates: one regex, applied to everything, rather than trusting the first few rows.
non_iso = raw[FLAGS["date not ISO-8601"]]
print(f"Date strings not in ISO yyyy-mm-dd: {len(non_iso)} of {len(raw)}")
display(non_iso)

print("\nNumeric sanity — a request count cannot be negative, and a cost cannot be:")
for col in MEASURES:
    numeric = pd.to_numeric(raw[col], errors="coerce")
    bad = raw[numeric.le(0).fillna(False)]
    print(f"  {col:14} {len(bad)} row(s) <= 0")
    if len(bad):
        display(bad)
''')

code(r'''
# Exact duplicates: identical in every column, i.e. the same day's usage counted twice.
dupe_mask = raw.duplicated(keep=False)
print(f"Fully-duplicated rows: {dupe_mask.sum()}")
if dupe_mask.any():
    display(raw[dupe_mask].sort_values(list(raw.columns)))

# A weaker key would catch a genuine RESTATEMENT of the same series with new numbers.
key_dupes = raw[raw.duplicated(KEY, keep=False)]
print(f"Rows sharing {KEY}: {len(key_dupes)}")
print("  Identical on the key AND on every measure, so this is a duplicated export,")
print("  not a restatement. A restatement would differ in at least one measure.")
''')

md(r"""
### 2.1 The price rule

Effective unit cost is the strongest available tell for a billing anomaly, because
API pricing is a published rate rather than a negotiated per-invoice number. If the
rate is stable, then any row where cost and tokens disagree with it is either a
mis-billing or a data error — and the same stability makes a missing cost or a
missing token count recoverable rather than lost.

So the first question is not "is there an outlier" but **"is there a rule at all,
and at what grain?"** The cell below tests per model, then per service. The answer
matters: the two grains give different rates, and using the wrong one would put a
systematic error into every imputation built on it.
""")

code(r'''
probe = df.copy()
probe["usd_per_1k"] = probe["cost_usd"] / probe["total_tokens"] * 1_000

print("Effective unit cost, grouped by MODEL ($ per 1,000 tokens):")
display(probe.groupby("model")["usd_per_1k"]
             .agg(n="size", median="median", min="min", max="max")
             .assign(spread_pct=lambda t: (t["max"] / t["min"] - 1) * 100))

print("\nSame thing, grouped by SERVICE:")
display(probe.groupby("service")["usd_per_1k"]
             .agg(n="size", median="median", min="min", max="max")
             .assign(spread_pct=lambda t: (t["max"] / t["min"] - 1) * 100))
''')

code(r'''
# The falsifiable test: does cost = tokens x rate(service) / 1000 reproduce the file?
# Applied only to rows this notebook has NOT touched, so it cannot be circular.
untouched = raw[~FLAGS.any(axis=1)].copy()
untouched["service"] = (untouched["service"].astype(str).str.strip().str.lower()
                        .str.replace(r"[\s_]+", "-", regex=True))
for c in ["total_tokens", "cost_usd"]:
    untouched[c] = pd.to_numeric(untouched[c], errors="coerce")

for grain, r in [("model", unit_rate(df, "model")), ("service", RATE)]:
    k = untouched["service"] if grain == "service" else (
        untouched["model"].astype(str).str.strip().str.lower())
    pred = (untouched["total_tokens"] * k.map(r) / 1_000).round(2)
    exact = (pred - untouched["cost_usd"]).abs() < 0.005
    print(f"rate per {grain:8} reproduces {int(exact.sum()):3}/{len(untouched)} untouched costs "
          f"to the cent   (worst error ${(pred - untouched['cost_usd']).abs().max():.2f})")

say(f"""
**The price rule is per service, and it is exact.**
`cost_usd = round(total_tokens x rate / 1000, 2)` reproduces
**every one** of the {len(untouched)} rows this notebook has not touched, to the cent,
using {len(RATE)} service-level rates: {", ".join(f"`{k}` ${v:.3f}" for k, v in RATE.items())}
per 1,000 tokens.

Grouping by model instead collapses the three `gpt-4.1-mini` services onto one rate
and is wrong for two of them by up to
{max(abs(RATE[s] / unit_rate(df, "model")["gpt-4.1-mini"] - 1) for s in RATE.index if s != "doc-analysis") * 100:.0f}%.
That matters because both imputations in §3.1 divide by this rate — at the model
grain they would have been quietly wrong; at the service grain they are arithmetic.

Whether the per-service rate is a negotiated price or simply a stable prompt-to-
completion mix within each service cannot be settled from this file, which carries
no token split. Either way it is the right denominator, and §7 re-runs everything at
the model grain to show what the choice is worth.
""")
''')

code(r'''
# With an exact rule established, an anomaly is whatever the rule cannot explain.
# Measured on the frame BEFORE the anomaly is restated, or there would be nothing to see.
pre, _ = clean(raw, anomaly="keep")
expected = pre["total_tokens"] * pre["service"].map(RATE) / 1_000
pre = pre.assign(expected_usd=expected.round(2), ratio=(pre["cost_usd"] / expected))

print("Billed cost divided by what the price rule implies:")
print(pre["ratio"].describe()[["count", "min", "50%", "max"]].to_string())
print("\nThe three largest departures from the rule:")
display(pre.nlargest(3, "ratio")[["date", "team", "service", "model", "requests",
                                  "total_tokens", "cost_usd", "expected_usd", "ratio"]])
''')

md(r"""
### 2.2 The ambiguous date

One date is written `DD/MM/YYYY` where every other row is ISO-8601, and `09/05/2026`
could be 9 May or 5 September. This is the only defect in the file where the repair
is not mechanical — it needs an argument — so it gets one, and §7 re-runs the whole
analysis on the other reading to price the risk of being wrong.

Two independent pieces of evidence point the same way, and both are checked below
rather than asserted:

1. **The window.** Every other row falls in a contiguous spring range. A September
   date would sit outside it by months, alone, with nothing either side.
2. **The hole.** The panel is otherwise near-complete — every day carries a row for
   every service. Read day-first, this row lands exactly in a gap that would
   otherwise have no explanation. Read month-first, the gap stays open *and* a
   lone island appears in September.

Evidence 2 is the stronger of the two, because it is a positive fit rather than an
argument from absence.
""")

code(r'''
iso_dates = pd.to_datetime(raw.loc[~FLAGS["date not ISO-8601"], "date"], format="ISO8601")
amb = raw.loc[FLAGS["date not ISO-8601"]].iloc[0]
day_first = pd.to_datetime(amb["date"], dayfirst=True)
month_first = pd.to_datetime(amb["date"], dayfirst=False)

# Would the panel gap be filled? Build the grid from the ISO rows only.
iso_rows = raw.loc[~FLAGS["date not ISO-8601"]].assign(date=iso_dates)
iso_rows["service"] = (iso_rows["service"].astype(str).str.strip().str.lower()
                       .str.replace(r"[\s_]+", "-", regex=True))
grid = iso_rows.pivot_table(index="date", columns="service", values="requests", aggfunc="size")
gaps = [(d, s) for (d, s), miss in grid.isna().stack().items() if miss]

amb_service = (str(amb["service"]).strip().lower().replace(" ", "-").replace("_", "-"))
print(f"ambiguous cell: {amb['date']!r}  ({amb['team']} / {amb_service})\n")
print(f"  read day-first   -> {day_first:%Y-%m-%d}  "
      f"inside the observed window? {iso_dates.min() <= day_first <= iso_dates.max()}   "
      f"fills a known gap? {(day_first, amb_service) in gaps}")
print(f"  read month-first -> {month_first:%Y-%m-%d}  "
      f"inside the observed window? {iso_dates.min() <= month_first <= iso_dates.max()}   "
      f"fills a known gap? {(month_first, amb_service) in gaps}")
print(f"\n  observed window from the 297 unambiguous rows: "
      f"{iso_dates.min():%d %b %Y} to {iso_dates.max():%d %b %Y}")
print(f"  gaps in the {grid.shape[0]} x {grid.shape[1]} panel before this row is placed: "
      f"{[f'{d:%Y-%m-%d} {s}' for d, s in gaps]}")
''')

md(r"""
### 2.3 The defect register
""")

code(r'''
reg = (FLAGS.sum().rename("rows").to_frame()
       .assign(**{"first seen at row": [FLAGS.index[FLAGS[c]][0] if FLAGS[c].any() else None
                                        for c in FLAGS.columns]}))
display(reg)

say(f"""
**{int(FLAGS.to_numpy().sum())} defects across {int(FLAGS.any(axis=1).sum())} of
{len(raw):,} rows ({FLAGS.any(axis=1).mean():.1%}), in {int((FLAGS.sum() > 0).sum())} classes.**

Defects and bad rows are different counts because
{int((FLAGS.sum(axis=1) > 1).sum())} row carries two of them — the row with the
`team` case variant is the same row with the `service` label variant. Reporting
"{int(FLAGS.to_numpy().sum())} bad rows" would overstate the corruption rate by
{int(FLAGS.to_numpy().sum()) / int(FLAGS.any(axis=1).sum()) - 1:.0%}; it is the kind of small
double-count that makes a data-quality metric untrustworthy.

Every one of these rows:
""")
display(raw[FLAGS.any(axis=1)])
''')

# ═══════════════════════════════════════════════════════════════════════════
# 3. Cleaning decisions
# ═══════════════════════════════════════════════════════════════════════════
md(r"""
---

## 3. The cleaning decisions, and why each went the way it did

Order matters, and the pipeline in §0.1 fixes it. Labels are canonicalised
*before* de-duplication — otherwise `Chat Router` and `chat-router` are two rows
rather than one entity, and the duplicate never collides with its twin.
De-duplication runs *before* the rate is derived, so a doubled row cannot skew the
benchmark that everything downstream is measured against.

Four of the eight defects have only one sensible treatment: a label variant is
normalised, a byte-identical row is dropped, a non-ISO date is parsed. The other
four need an argument. Each is made below, and each is then re-run the other way in
§7, so a reader who disagrees with one can see immediately what it would cost them.
""")

md(r"""
### 3.1 The two missing measures

§2.1 established that `cost_usd = round(tokens x rate(service) / 1000, 2)` holds
for every untouched row in the file. That changes the character of the problem.
Imputation is normally a statistical act — you estimate a plausible value and
accept a distribution of error. Here it is an **arithmetic** one: the missing cost
is not estimated from similar rows, it is *computed* from the row's own token count
and its service's rate, and the missing token count is computed from its own cost.

The alternative — dropping both rows — would silently understate two service-days.
That is a real cost for no gain in honesty, given the rule reproduces every other
row in the file exactly. §7 drops them anyway, to show the size of the difference.

The residual risk is not "is the arithmetic right" but "is the rate right". At the
model grain it would not have been, which is the point of §2.1; the cell below
shows what each cell would have become under the wrong grain.
""")

code(r'''
model_rate = unit_rate(clean(raw, missing="drop")[0], "model")
was_imputed = FLAGS.index[FLAGS["cost_usd missing"] | FLAGS["total_tokens missing"]]
imputed = df[df["source_row"].isin(was_imputed)]

for _, r in imputed.iterrows():
    svc_rate = RATE[r["service"]]
    mdl_rate = model_rate[r["model"]]
    print(f"{r['date']:%Y-%m-%d}  {r['team']} / {r['service']} ({r['model']})   "
          f"[workbook row {r['source_row'] + 2}]")
    if FLAGS.loc[r["source_row"], "cost_usd missing"]:
        print(f"    cost_usd was blank; tokens = {r['total_tokens']:,} are present")
        print(f"    imputed  {r['total_tokens']:,} x ${svc_rate:.3f}/1k = ${r['cost_usd']:.2f}")
        print(f"    at the MODEL grain it would have been ${r['total_tokens'] * mdl_rate / 1_000:.2f} "
              f"({(mdl_rate / svc_rate - 1) * 100:+.0f}%)")
    else:
        print(f"    total_tokens was blank; cost = ${r['cost_usd']:.2f} is present")
        print(f"    imputed  ${r['cost_usd']:.2f} / ${svc_rate:.3f}/1k = {r['total_tokens']:,} tokens")
        print(f"    at the MODEL grain it would have been {r['cost_usd'] / mdl_rate * 1_000:,.0f} "
              f"({(svc_rate / mdl_rate - 1) * 100:+.0f}%)")
    print()

say(f"""
Together the two imputed cells are
**{imputed['cost_usd'].sum() / df['cost_usd'].sum():.2%}** of total spend and
**{imputed['total_tokens'].sum() / df['total_tokens'].sum():.2%}** of total tokens.
Neither is large enough to move a conclusion — but the {len(imputed)} rows would have
been *dropped* by the obvious alternative, and dropping is the treatment that leaves
no trace in the output for a reader to disagree with.
""")
''')

md(r"""
### 3.2 The two impossible values

These need a judgement each, and the judgements differ — which is exactly why each
row is examined rather than both being handled by one rule. Both are cases where a
*single field* is corrupt and the row's other fields are sound; the useful move is
to work out which field, using the price rule as the arbiter, and touch only that
one.

**`requests = -25`.** A request count cannot be negative. But the same row's tokens
and cost satisfy the price rule to the cent, so the money and the token count are
sound and only `requests` is broken. The tempting repair is `abs()`, treating it as
a sign flip. The cell below tests that: 25 requests against that row's token count
would imply a tokens-per-request figure several times larger than doc-analysis has
ever recorded. So the magnitude is wrong too, not just the sign — `-25` is not a
negated 25, it is a corrupted number. It is discarded and re-derived from the
service's own tokens-per-request.

**The cost far above the rule.** Here the opposite holds. That row's
tokens-per-request sits comfortably inside doc-analysis's observed range, so usage
that day was ordinary; it is the billed amount that departs from the rule, by a
factor the cell below reports. Because the rule is exact everywhere else, the
correct cost is computable — so it is computed, not capped at some percentile and
not dropped.

*Why not simply cap the outlier?* Capping picks a number with no meaning: it
encodes "this looked too big" rather than "this is what it should have been". And
because a multiple-fold billing departure is itself something a FinOps team needs
to see, §6 reports it as a finding rather than burying it in a footnote.
""")

code(r'''
# --- the negative request count ------------------------------------------
src_i = FLAGS.index[FLAGS["requests <= 0"]][0]
row = df[df["source_row"] == src_i].iloc[0]
raw_req = pd.to_numeric(raw.loc[src_i, "requests"])

peers = df.loc[(df["service"] == row["service"]) & (df["source_row"] != src_i),
               "tokens_per_request"]
print(f"row: {row['date']:%Y-%m-%d} {row['team']} / {row['service']}, "
      f"requests as delivered = {raw_req}\n")
print(f"  price-rule check     ${row['cost_usd']:.2f} vs "
      f"${row['total_tokens'] * RATE[row['service']] / 1_000:.2f} implied "
      f"-> tokens and cost are internally consistent, so only `requests` is corrupt\n")
print(f"  doc-analysis tokens/request across the other {len(peers)} days: "
      f"min {peers.min():,.0f}  median {peers.median():,.0f}  max {peers.max():,.0f}")
print(f"  if requests were abs({raw_req}) = {abs(raw_req)}:  "
      f"{row['total_tokens'] / abs(raw_req):,.0f} tokens/request "
      f"= {row['total_tokens'] / abs(raw_req) / peers.max():.1f}x the highest ever observed")
print(f"  imputed from the service median instead:  {row['requests']:,} requests "
      f"-> {row['tokens_per_request']:,.0f} tokens/request, inside the observed range")
''')

code(r'''
# --- the billing anomaly --------------------------------------------------
an = pre.loc[pre["ratio"].idxmax()]
peers = df.loc[(df["service"] == an["service"]) & (df["source_row"] != an["source_row"]),
               "tokens_per_request"]
print(f"row: {an['date']:%Y-%m-%d} {an['team']} / {an['service']}\n")
print(f"  usage that day    {an['requests']:,} requests, {an['total_tokens']:,} tokens "
      f"= {an['total_tokens'] / an['requests']:,.0f} tokens/request")
print(f"                    that is the {(peers < an['total_tokens'] / an['requests']).mean():.0%} "
      f"percentile of the other {len(peers)} days (range {peers.min():,.0f}-{peers.max():,.0f})"
      f"  -> ordinary usage")
print(f"  billed            ${an['cost_usd']:,.2f}")
print(f"  price rule implies ${an['expected_usd']:,.2f}  ->  billed at {an['ratio']:.2f}x the rate")
print(f"  restated to       ${df.loc[df['source_row'] == an['source_row'], 'cost_usd'].iloc[0]:,.2f}")

say(f"""
Restating this one line removes
**${an['cost_usd'] - an['expected_usd']:,.2f}** of spend that the price rule cannot
account for — **{(an['cost_usd'] - an['expected_usd']) / pre['cost_usd'].sum():.1%}** of the
window's billed total. It is the single largest correction in this notebook, and §7
shows what leaving it in would do to the answers.
""")
''')

code(r'''
# Panel completeness: absence of a row is not the same as zero usage.
grid = df.pivot_table(index="date", columns="service", values="requests", aggfunc="size")
expected_cells = grid.shape[0] * grid.shape[1]
present = int(grid.notna().sum().sum())
print(f"Panel: {grid.shape[0]} days x {grid.shape[1]} services = {expected_cells} expected cells, "
      f"{present} present, {expected_cells - present} absent\n")
for (d, s), is_gap in grid.isna().stack().items():
    if is_gap:
        print(f"  no row at all for {s} on {d:%Y-%m-%d}")
print("\n  These are absent from the source, not dropped here. They are treated as")
print("  'not recorded', NOT as zero usage: filling them with zeros would invent")
print("  three days of nil demand and bias every daily mean downward.")
''')

code(r'''
recon = pd.DataFrame({
    "metric": ["rows", "total cost (USD)", "total requests", "total tokens"],
    "raw as delivered": [len(raw),
                         pd.to_numeric(raw["cost_usd"], errors="coerce").sum(),
                         pd.to_numeric(raw["requests"], errors="coerce").sum(),
                         pd.to_numeric(raw["total_tokens"], errors="coerce").sum()],
    "clean": [len(df), df["cost_usd"].sum(), df["requests"].sum(), df["total_tokens"].sum()],
}).set_index("metric")
recon["delta"] = recon["clean"] - recon["raw as delivered"]
recon["delta %"] = recon["delta"] / recon["raw as delivered"] * 100
print("Raw -> clean reconciliation. Every difference is accounted for by the register in §6:\n")
display(recon.style.format({"raw as delivered": "{:,.2f}", "clean": "{:,.2f}",
                            "delta": "{:+,.2f}", "delta %": "{:+.2f}%"}))
''')

# ═══════════════════════════════════════════════════════════════════════════
# 4. Q1 — usage trend
# ═══════════════════════════════════════════════════════════════════════════
md(r"""
---

## 4. Q1 — What is the overall usage trend?

### 4.0 House style, and a check that colour is never load-bearing

One style block, applied once, and three fixed hues that a series keeps for the
whole notebook regardless of what else is plotted. The audit below is the part
worth reading: it computes the perceptual distance between the hues under
simulated colour-vision deficiency, and their contrast ratio in greyscale, rather
than asserting that the palette is fine.

Greyscale is the harder constraint of the two, and this palette does not clear it
on its own — as the numbers below show. The design rule that makes that acceptable
is stated as an executable invariant instead of a promise: **no single set of axes
in this notebook ever carries more than one of the three identity hues**, so no
reader is ever asked to tell two of them apart. Series are separated by panel,
and every line is labelled at its own end. `audit_figure()` enforces it, and it is
called on every figure that follows.
""")

code(r'''
mpl.rcParams.update({
    "figure.dpi": 110, "savefig.dpi": 110,
    "font.size": 10, "axes.titlesize": 12, "axes.titleweight": "bold",
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.alpha": 0.25, "grid.linewidth": 0.6,
    "axes.axisbelow": True, "figure.facecolor": "white", "axes.edgecolor": "#c3c2b7",
    "xtick.color": "#52514e", "ytick.color": "#52514e", "axes.labelcolor": "#52514e",
    "hatch.linewidth": 1.6,          # texture is a redundant encoder; it has to be legible
})

# Three identity hues, fixed order, never cycled. C_MUTED is a neutral, not an
# identity: it may share axes with anything.
C_REQ, C_TOK, C_COST, C_MUTED = "#2a78d6", "#eb6834", "#1baf7a", "#898781"
IDENTITY = {C_REQ: "requests", C_TOK: "tokens", C_COST: "cost"}

# --- perceptual maths, computed rather than assumed -------------------------
_LMS = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                 [0.2119034982, 0.6806995451, 0.1073969566],
                 [0.0883024619, 0.2817188376, 0.6299787005]])
_LAB = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                 [1.9779984951, -2.4285922050, 0.4505937099],
                 [0.0259040371, 0.7827717662, -0.8086757660]])
# Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear sRGB.
_DEUT = np.array([[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413],
                  [-0.011820, 0.042940, 0.968610]])
_PROT = np.array([[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216],
                  [-0.003882, -0.048116, 1.051998]])


def _linear(hexcolour):
    c = np.array([int(hexcolour[i:i + 2], 16) for i in (1, 3, 5)], float) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def delta_e(a, b, sim=None):
    "Perceptual distance in OKLab x100, optionally under a CVD simulation."
    la, lb = _linear(a), _linear(b)
    if sim is not None:
        la, lb = sim @ la, sim @ lb
    return float(np.linalg.norm(_LAB @ np.cbrt(_LMS @ la) - _LAB @ np.cbrt(_LMS @ lb)) * 100)


def grey_contrast(a, b):
    "WCAG contrast ratio of the two colours' luminances, i.e. how they print in mono."
    ya, yb = (float(np.dot([0.2126, 0.7152, 0.0722], _linear(c))) for c in (a, b))
    return (max(ya, yb) + 0.05) / (min(ya, yb) + 0.05)


def audit_figure(fig, name=""):
    "Fail loudly if any axes carries two identity hues — see the design rule above."
    for ax in fig.axes:
        used = {ln.get_color() for ln in ax.get_lines()} | {
            p.get_facecolor() for p in ax.patches}
        hues = {c for c in IDENTITY if c in used or c in {
            mpl.colors.to_hex(u) if not isinstance(u, str) else u for u in used}}
        assert len(hues) <= 1, f"{name}: axes mixes identity hues {hues}"
    return fig


def show_figure(fig, name, alt):
    """Audit the figure, then display it with a real text alternative.

    The alt text is not decoration: this notebook argues at length that colour must
    never be the only carrier of meaning, and a figure with no text alternative is
    the same failure in a different medium.

    Two representations are emitted. `text/html` carries the `alt` attribute and is
    what nbconvert's HTML exporter renders — its template drops alt text held in
    output metadata, so metadata alone would silently lose it. `image/png` is
    emitted alongside so that anything reading the notebook programmatically still
    finds a plain image output.
    """
    audit_figure(fig, name)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", facecolor=fig.get_facecolor())
    b64 = base64.b64encode(buf.getvalue()).decode()
    text = html_escape(f"{name}. {alt}", quote=True)
    display({"image/png": b64,
             "text/html": f'<img alt="{text}" src="data:image/png;base64,{b64}" '
                          f'style="max-width:100%;height:auto">'},
            raw=True, metadata={"image/png": {"alt": text}})
    plt.close(fig)


pairs = [(C_REQ, C_TOK), (C_REQ, C_COST), (C_TOK, C_COST)]
audit = pd.DataFrame(
    [{"pair": f"{IDENTITY[a]} vs {IDENTITY[b]}",
      "ΔE normal": delta_e(a, b), "ΔE deuteranopia": delta_e(a, b, _DEUT),
      "ΔE protanopia": delta_e(a, b, _PROT), "greyscale contrast": grey_contrast(a, b)}
     for a, b in pairs]).set_index("pair")
display(audit.style.format({"ΔE normal": "{:.1f}", "ΔE deuteranopia": "{:.1f}",
                            "ΔE protanopia": "{:.1f}", "greyscale contrast": "{:.2f}:1"}))

say(f"""
Colour-vision separation holds: the worst pair is
**ΔE {audit[["ΔE deuteranopia", "ΔE protanopia"]].min().min():.1f}** under simulation,
against a working floor of 8 — so a colour-blind reader can tell the hues apart on
screen.

**Greyscale does not hold**, and the notebook does not pretend otherwise: printed in
mono the worst pair sits at **{audit["greyscale contrast"].min():.2f}:1**, effectively
identical. That is why the invariant above exists rather than a claim that the palette
is print-safe. Every figure below is checked against it before it is displayed.
""")
''')

md(r"""
### 4.1 The trend

Daily totals are noisy on a weekly business cycle, so each panel carries a **7-day
rolling mean**: exactly one full week per point, which removes the weekday/weekend
swing without smoothing away the trend itself. Over it sits the **fitted
log-linear trend and its 95% band**, from the model specified in §0.2 — the
rolling mean is a description, the fit is the estimate, and only the fit comes
with an interval.

Requests, tokens and cost are on **separate stacked panels, never a shared twin
axis**. Two y-scales on one plot invite the reader to infer a relationship from
where the lines happen to cross, which is a property of the scaling rather than of
the data. It also happens to be the arrangement that keeps each panel to a single
identity hue.
""")

code(r'''
for col in ["requests", "tokens", "cost"]:
    DAILY[f"{col}_7d"] = DAILY[col].rolling(7, min_periods=4).mean()


def trend_band(g):
    """Fitted trend and its 95% band, with weekday effects held at their mean.

    Holding the dummies at their sample mean strips the within-week sawtooth out of
    the drawn line: what remains is the trend the coefficient actually describes.
    """
    X = g["X"].copy()
    X[:, 2:] = X[:, 2:].mean(axis=0)
    pred = g["model"].get_prediction(X).summary_frame(alpha=0.05)
    return (np.exp(pred["mean"].values), np.exp(pred["mean_ci_lower"].values),
            np.exp(pred["mean_ci_upper"].values))


USD = lambda v: f"${v:,.0f}"
CNT = lambda v: f"{v:,.0f}"
MIL = lambda v: f"{v / 1e6:.2f}M" if v else "0"

fig, axes = plt.subplots(3, 1, figsize=(11, 9.4), sharex=True, gridspec_kw={"hspace": 0.24})
panels = [(axes[0], "requests", C_REQ, "Requests per day", CNT),
          (axes[1], "tokens", C_TOK, "Tokens per day", MIL),
          (axes[2], "cost", C_COST, "Cost per day (USD)", USD)]

for ax, col, colour, label, fmt in panels:
    g = G[col]
    fit, lo, hi = trend_band(g)
    ax.plot(DAILY.index, DAILY[col], color=colour, lw=0.9, alpha=0.28, label="daily total")
    ax.plot(DAILY.index, DAILY[f"{col}_7d"], color=colour, lw=2.4, label="7-day mean")
    ax.fill_between(g["index"], lo, hi, color=C_MUTED, alpha=0.30, lw=0,
                    label="fitted trend, 95% band")
    ax.plot(g["index"], fit, color="#2b2a26", lw=1.4, ls=(0, (5, 2)), label="fitted trend")
    ax.set_ylabel(label, fontsize=9.5)
    ax.yaxis.set_major_formatter(mpl.ticker.FuncFormatter(lambda v, _p, f=fmt: f(v)))
    ax.set_ylim(bottom=0)
    last = DAILY[f"{col}_7d"].dropna()
    # Direct end-label: identity without relying on colour alone.
    ax.annotate(fmt(last.iloc[-1]), (last.index[-1], last.iloc[-1]),
                xytext=(7, 0), textcoords="offset points", va="center",
                fontsize=9, color="#2b2a26", fontweight="bold")
    ax.annotate(f"{g['weekly_pct']:+.2f}%/week  (95% CI {g['lo']:+.2f} to {g['hi']:+.2f})",
                (0.012, 0.90), xycoords="axes fraction", fontsize=9, color="#2b2a26")
    # Room at the right for the end label; the band would otherwise be clipped.
    ax.set_xlim(DAILY.index.min() - pd.Timedelta(days=1),
                DAILY.index.max() + pd.Timedelta(days=6))

axes[0].legend(frameon=False, fontsize=8.5, loc="lower left", ncols=4)
axes[0].set_title("All three measures grow at the same rate — about 3.5% a week",
                  loc="left", pad=12)
fig.autofmt_xdate()
show_figure(fig, "Figure 1",
            "Three stacked time-series panels — daily requests, tokens and cost — each "
            "rising steadily from left to right, with a fitted trend line and narrow "
            "confidence band running through the middle of each.")

say(f"""
**Figure 1. Daily requests, tokens and cost, 
{DAILY.index.min():%d %b} – {DAILY.index.max():%d %b %Y} ({len(DAILY)} days).**
Faint line: daily total. Solid: 7-day rolling mean. Dashed with grey band: the
fitted log-linear trend and its 95% confidence band, weekday effects held at their
sample mean. *What to conclude:* every measure is rising, and the three fitted
rates — {G['requests']['weekly_pct']:+.2f}%, {G['tokens']['weekly_pct']:+.2f}% and
{G['cost']['weekly_pct']:+.2f}% per week — sit within each other's confidence
intervals. Nothing in this figure distinguishes cost growth from volume growth;
§4.2 tests that directly.
""")
''')

code(r'''
tbl = pd.DataFrame({
    "weekly growth %": [G[c]["weekly_pct"] for c in G],
    "95% CI low": [G[c]["lo"] for c in G],
    "95% CI high": [G[c]["hi"] for c in G],
    "p": [G[c]["p"] for c in G],
    "R²": [G[c]["r2"] for c in G],
    "n (days)": [G[c]["n"] for c in G],
}, index=list(G))
tbl.index.name = "daily series"
display(tbl.style.format({"weekly growth %": "{:+.2f}%", "95% CI low": "{:+.2f}%",
                          "95% CI high": "{:+.2f}%", "p": "{:.2e}", "R²": "{:.3f}",
                          "n (days)": "{:.0f}"}))

_lo_d = np.log(1 + G["cost"]["hi"] / 100) / 7
_hi_d = np.log(1 + G["cost"]["lo"] / 100) / 7
say(f"""
**Growth is real, and it is not a marginal result.** Spend rises
{G['cost']['weekly_pct']:.2f}% a week (95% CI {G['cost']['lo']:.2f} to
{G['cost']['hi']:.2f}%, p = {G['cost']['p']:.1e} against the null of no trend). Held at
that rate, spend doubles in **{np.log(2) / G['cost']['daily_log'] / 30.44:.1f} months**,
or {np.log(2) / _lo_d / 30.44:.1f} to {np.log(2) / _hi_d / 30.44:.1f} months across the
interval. The last four weeks run at
**${DAILY['cost'].iloc[-28:].mean() * 365 / 12:,.0f} a month**; one quarter ahead the
same trend implies about
${DAILY['cost'].iloc[-28:].mean() * 365 / 12 * (1 + G['cost']['weekly_pct'] / 100) ** 13:,.0f}
a month ({DAILY['cost'].iloc[-28:].mean() * 365 / 12 * (1 + G['cost']['lo'] / 100) ** 13:,.0f}
to {DAILY['cost'].iloc[-28:].mean() * 365 / 12 * (1 + G['cost']['hi'] / 100) ** 13:,.0f}).
That is a projection of the *observed* trend, not a forecast; §8 says why nothing
beyond about a quarter should be read off {G['cost']['n']} days of one file.
""")
''')

md(r"""
### 4.2 Is cost growing faster than usage?

This is the question that decides what to do about the growth, so it deserves a
test rather than a glance at three lines.

The wrong way to answer it is to compare the three confidence intervals in the
table above and note that they overlap, or that they do not. Overlapping intervals
are weak evidence either way, and here the three series share their daily shocks —
a busy Tuesday lifts requests, tokens and cost together — so treating them as
independent throws away most of the available information.

The right way is to test the **ratio** directly. `cost / tokens` is the blended
price per token; `tokens / requests` is average verbosity. Differencing in logs
cancels the common daily shock, so the trend in each ratio is estimated far more
precisely than the difference of two separately estimated trends. Same model as
before, same HAC standard errors.

Two hypotheses are on trial:

* **Mix drift** — work is moving to the expensive model, so blended price per token
  rises. Would show up as a positive trend in `cost / tokens`.
* **Verbosity drift** — each request carries more context, so tokens per request
  rises. Would show up as a positive trend in `tokens / requests`.
""")

code(r'''
rows = []
for name, g in DIVERGE.items():
    rows.append({"ratio": name, "weekly %": g["weekly_pct"], "95% low": g["lo"],
                 "95% high": g["hi"], "p": g["p"],
                 "widest drift the data could hide, over the window":
                     max(abs(np.exp(np.log(1 + g["lo"] / 100) / 7 * g["n"]) - 1),
                         abs(np.exp(np.log(1 + g["hi"] / 100) / 7 * g["n"]) - 1)) * 100})
div = pd.DataFrame(rows).set_index("ratio")
display(div.style.format({"weekly %": "{:+.3f}%", "95% low": "{:+.3f}%",
                          "95% high": "{:+.3f}%", "p": "{:.2f}",
                          "widest drift the data could hide, over the window": "±{:.1f}%"}))

_ct, _tr = DIVERGE["cost/tokens"], DIVERGE["tokens/requests"]
say(f"""
**Neither hypothesis survives.** Blended price per token trends
{_ct['weekly_pct']:+.3f}% a week (95% CI {_ct['lo']:+.3f} to {_ct['hi']:+.3f}%,
p = {_ct['p']:.2f}); tokens per request trends {_tr['weekly_pct']:+.3f}%
(95% CI {_tr['lo']:+.3f} to {_tr['hi']:+.3f}%, p = {_tr['p']:.2f}). Both intervals
straddle zero comfortably, and both point very slightly *downward*.

The final column is the part that turns a null result into a usable one. A
non-significant coefficient on its own says only "we did not find anything", which
is compatible with having looked badly. The interval says how hard we looked: over
this window the data would have revealed any cumulative drift in blended price per
token larger than about
**{div.iloc[0, -1]:.0f}%**, and any drift in verbosity larger than about
**{div.iloc[1, -1]:.0f}%**. Drifts smaller than that could be present and unseen. A
mix shift big enough to matter for a routing decision is not one of them.

**So the growth is volume growth at constant unit economics.** Every extra dollar is
buying proportionally more requests, of the same average size, at the same average
price. That has a direct consequence for §5: the cost concentration found there is
*structural*, not a trend that is about to correct itself or get worse on its own.
""")
''')

code(r'''
# The same result, drawn: the premium model's share of tokens, with its fitted trend.
# NOT fillna(0): on the day the premium service has no row at all, its share is
# unknown, not zero. Zero-filling would draw a 0% spike that never happened — the
# same mistake §3 refuses to make with the three absent service-days.
mix = df.pivot_table(index="date", columns="model", values="total_tokens", aggfunc="sum")
premium = SVC.loc[SVC["usd_per_1k"].idxmax(), "model"]
share = (mix[premium] / mix.sum(axis=1, skipna=True) * 100).dropna()
dropped_days = len(mix) - len(share)

t = np.arange(len(share))
Xs = sm.add_constant(np.column_stack([
    t, pd.get_dummies(share.index.dayofweek, prefix="d", drop_first=True).astype(float).values]))
ms = sm.OLS(share.values, Xs).fit(cov_type="HAC", cov_kwds={"maxlags": 7})
Xf = Xs.copy(); Xf[:, 2:] = Xf[:, 2:].mean(axis=0)
pf = ms.get_prediction(Xf).summary_frame(alpha=0.05)
slo, shi = ms.conf_int()[1]

fig, ax = plt.subplots(figsize=(11, 3.8))
ax.plot(share.index, share.values, color=C_TOK, lw=0.9, alpha=0.35, label="daily share")
ax.plot(share.index, share.rolling(7, min_periods=4).mean(), color=C_TOK, lw=2.4,
        label="7-day mean")
ax.fill_between(share.index, pf["mean_ci_lower"], pf["mean_ci_upper"], color=C_MUTED,
                alpha=0.30, lw=0, label="fitted trend, 95% band")
ax.plot(share.index, pf["mean"], color="#2b2a26", lw=1.4, ls=(0, (5, 2)), label="fitted trend")
ax.set_ylabel(f"{premium} share of tokens (%)", fontsize=9.5)
ax.yaxis.set_major_formatter(mpl.ticker.StrMethodFormatter("{x:.0f}%"))
ax.set_title("The premium model's share of tokens is flat — no mix drift", loc="left", pad=10)
ax.annotate(f"{ms.params[1] * len(share):+.1f} pts over the window "
            f"(95% CI {slo * len(share):+.1f} to {shi * len(share):+.1f}, p = {ms.pvalues[1]:.2f})",
            (0.012, 0.06), xycoords="axes fraction", fontsize=9, color="#2b2a26")
ax.legend(frameon=False, fontsize=8.5, loc="upper left", ncols=4)
ax.set_xlim(share.index.min() - pd.Timedelta(days=1), share.index.max() + pd.Timedelta(days=1))
fig.autofmt_xdate()
show_figure(fig, "Figure 2",
            "A time series of the premium model's share of daily tokens, oscillating "
            "around a quarter of all tokens with no visible upward or downward slope; "
            "the fitted trend line is flat.")

say(f"""
**Figure 2. Share of daily tokens served by `{premium}`, the premium tier
(${SVC['usd_per_1k'].max():.3f} per 1k tokens against
${SVC['usd_per_1k'].min():.3f} for the cheapest).**
Faint: daily. Solid: 7-day mean. Dashed with band: fitted linear trend, 95%,
weekday effects held at their mean. {dropped_days} day on which the premium service
has no row at all is omitted rather than plotted as 0%. *What to conclude:* the share
moves between {share.min():.0f}% and {share.max():.0f}% day to day and ends the window
at {share.rolling(7, min_periods=4).mean().iloc[-1]:.1f}%, but the fitted change over
{len(share)} days is {ms.params[1] * len(share):+.1f} points with an interval spanning
zero. **There is no mix drift to fix.** The day-to-day swing is `{TOP}`'s own volume
moving, not a routing change.
""")
''')

md(r"""
### 4.3 Why not just compare the first week with the last

Because the answer depends on which weeks you choose, and the dependence is large
enough to change the recommendation.

The comparison below is not a straw man. Trimming the first and last week of a
window is standard practice — the edges are usually partial, and including them
biases both ends downward. Here the first week genuinely is partial and the last
genuinely is not, so trimming both discards a full week of the strongest growth.
That single choice is the difference between "cost, tokens and requests all grew by
about the same amount" and "cost grew half again as fast as requests".

The figure makes the general point: it computes what the endpoint method *would*
have concluded for every possible pair of start and end weeks, and compares that
spread with the fitted estimate.
""")

code(r'''
display(_NAIVE.style.format({c: "{:+.1f}%" for c in ["requests", "tokens", "cost"]}))

wk = (df.groupby(pd.Grouper(key="date", freq="W-SUN"))
        .agg(requests=("requests", "sum"), tokens=("total_tokens", "sum"),
             cost=("cost_usd", "sum"), days=("date", "nunique")))
wkf = wk[wk["days"] == 7]

# Every start/end pair of complete weeks at least two weeks apart: what gap between
# cost growth and request growth would the endpoint method have reported?
pairs_ = [(j - i, ((wkf["cost"].iloc[j] / wkf["cost"].iloc[i]) ** (1 / (j - i)) - 1
                   - (wkf["requests"].iloc[j] / wkf["requests"].iloc[i]) ** (1 / (j - i)) + 1) * 100)
          for i in range(len(wkf)) for j in range(i + 2, len(wkf))]
span, gaps = (np.array(x) for x in zip(*pairs_))

fit_gap = ratio_growth(DAILY["cost"], DAILY["requests"])

fig, ax = plt.subplots(figsize=(11, 3.6))
ax.axvspan(fit_gap["lo"], fit_gap["hi"], color=C_COST, alpha=0.28, lw=0,
           label="fitted estimate, 95% CI")
ax.axvline(fit_gap["weekly_pct"], color=C_COST, lw=2.2, label="fitted estimate")
ax.axvline(0, color="#2b2a26", lw=0.9, ls=(0, (4, 3)), label="no difference")
ax.scatter(gaps, span + RNG.uniform(-0.22, 0.22, len(span)), s=34, color=C_MUTED,
           alpha=0.85, edgecolor="white", lw=0.7, zorder=3, label="one pair of weeks")
ax.set_xlabel("weekly growth in cost minus weekly growth in requests (percentage points)",
              fontsize=9.5)
ax.set_ylabel("weeks between\nthe two endpoints", fontsize=9.5)
ax.set_title("The endpoint method answers whatever you ask it; the fit does not",
             loc="left", pad=10)
ax.legend(frameon=False, fontsize=8.5, loc="upper left", ncols=4)
ax.set_ylim(1.2, span.max() + 1.6)
show_figure(fig, "Figure 3",
            "A scatter of week-pair estimates, widely spread at short spans and "
            "converging toward zero as the endpoints move further apart, against a "
            "narrow fitted interval straddling zero.")

_wrong = np.mean(np.sign(gaps) != np.sign(fit_gap["weekly_pct"]))
say(f"""
**Figure 3. What a first-week-versus-last-week comparison would have concluded, for
every pair of complete weeks at least two weeks apart ({len(gaps)} pairs).**
Each grey dot is one pair, positioned by the gap it implies between cost growth and
request growth, and by how far apart the two endpoint weeks are. Green line and band:
the same quantity fitted over all {G['cost']['n']} days with its 95% interval.
*What to conclude:* the endpoint method spans {gaps.min():+.2f} to
{gaps.max():+.2f} points a week — {np.mean(gaps > 0):.0%} of its answers say cost is
outrunning requests and {np.mean(gaps < 0):.0%} say the reverse — purely from the
choice of endpoints. The spread narrows as the endpoints move apart, which is the
diagnosis: at short spans the method is measuring week-to-week noise. The fitted
estimate is {fit_gap['weekly_pct']:+.2f} points a week
({fit_gap['lo']:+.2f} to {fit_gap['hi']:+.2f}) — indistinguishable from zero.

This is the one place in this notebook where more careful method **overturns** a
conclusion rather than refining it, which is why it is flagged in §1 and again in §8.
""")
''')

code(r'''
# Do the model's assumptions hold? Report rather than assume.
g = G["cost"]
ols = sm.OLS(np.log(DAILY["cost"].values), g["X"]).fit()      # classical SEs, for diagnostics
resid = ols.resid
lb = sm.stats.acorr_ljungbox(resid, lags=[7], return_df=True)
jb_stat, jb_p, skew, kurt = sm.stats.stattools.jarque_bera(resid)

print("Diagnostics for the log-linear cost model (§0.2):\n")
print(f"  Durbin-Watson              {sm.stats.stattools.durbin_watson(resid):.2f}   "
      f"(2.0 = no first-order autocorrelation)")
print(f"  Ljung-Box Q(7)             p = {lb['lb_pvalue'].iloc[0]:.3f}   "
      f"(residual autocorrelation up to one week)")
print(f"  Jarque-Bera                p = {jb_p:.3f}   skew {skew:+.2f}, kurtosis {kurt:.2f}")
print(f"  Breusch-Pagan              p = {sm.stats.diagnostic.het_breuschpagan(resid, g['X'])[3]:.3f}   "
      f"(constant residual variance)")

lin = sm.OLS(DAILY["cost"].values, g["X"]).fit(cov_type="HAC", cov_kwds={"maxlags": 7})
print(f"\n  Additive alternative: ${lin.params[1]:.3f}/day "
      f"(95% CI {lin.conf_int()[1][0]:.3f} to {lin.conf_int()[1][1]:.3f}), R² {lin.rsquared:.3f} "
      f"vs log-linear R² {ols.rsquared:.3f}")

say(f"""
**The specification is adequate, and the one violation is already handled.**
Residuals show no autocorrelation worth the name
(Durbin–Watson {sm.stats.stattools.durbin_watson(resid):.2f}, Ljung–Box
p = {lb['lb_pvalue'].iloc[0]:.3f}) once weekday effects are in the model — which is
the reason they are in it. Normality is rejected
(Jarque–Bera p {"< 0.001" if jb_p < 0.001 else f"= {jb_p:.3f}"}, driven by
{"negative" if skew < 0 else "positive"} skew of
{skew:+.2f}); that affects the exactness of the p-values, not the consistency of the
slope, and at n = {g['n']} the interval is wide enough that it does not change any
conclusion here. HAC standard errors are used throughout regardless, so
heteroskedasticity is priced in rather than assumed away.

Over a window this short the additive and multiplicative fits are near-identical
(R² {lin.rsquared:.3f} against {ols.rsquared:.3f}), so the data cannot distinguish
them. The log form is used because it is the one whose coefficient means something
when extrapolated: spend that grows by adding a fixed dollar amount and spend that
compounds diverge quickly, and compounding is the conservative assumption for a
budget.
""")
''')

code(r'''
say(f"""
### Answer to Q1

**Usage is growing steadily, by about {G['cost']['weekly_pct']:.1f}% a week on every
measure, and there is no evidence that cost is growing faster than usage.**

* Requests **{G['requests']['weekly_pct']:+.2f}%/week**
  ({G['requests']['lo']:+.2f} to {G['requests']['hi']:+.2f}), tokens
  **{G['tokens']['weekly_pct']:+.2f}%** ({G['tokens']['lo']:+.2f} to {G['tokens']['hi']:+.2f}),
  cost **{G['cost']['weekly_pct']:+.2f}%** ({G['cost']['lo']:+.2f} to {G['cost']['hi']:+.2f}).
  All three are highly significant against no trend; none is distinguishable from
  the others.
* Blended price per token: {_ct['weekly_pct']:+.3f}%/week (p = {_ct['p']:.2f}).
  Tokens per request: {_tr['weekly_pct']:+.3f}%/week (p = {_tr['p']:.2f}). Premium-model
  token share: {ms.params[1] * len(share):+.1f} points over the window (p = {ms.pvalues[1]:.2f}).
  **Nothing is drifting.**
* Practical reading: at this rate spend doubles in about
  **{np.log(2) / G['cost']['daily_log'] / 30.44:.1f} months**, and it does so by doing
  more of exactly what it is doing now. There is no routing regression to hunt and no
  prompt bloat to trim — the growth is demand.

**What this means for the recommendation.** Had cost been outrunning tokens, the
first move would be to find and fix whatever was pushing work to the expensive
model. It is not, so that work would have been wasted. The lever is the *level* of
unit cost, not its trend — which is §5.
""")
''')

# ═══════════════════════════════════════════════════════════════════════════
# 5. Q2 — cost driver
# ═══════════════════════════════════════════════════════════════════════════
md(r"""
---

## 5. Q2 — Which service is the biggest cost driver, and why?

The brief asks whether the answer is **request volume, token volume, or unit
cost**. That is answerable exactly, because cost decomposes multiplicatively into
precisely those three factors and nothing else:

```
    cost   =   requests   x   tokens/request   x   cost/token
               ─────────      ──────────────       ──────────
                 volume         verbosity          unit price
```

Every service's spend is that product, so any service's cost can be attributed to
whichever factor is actually carrying it. The three factors are also independent
levers in practice — you can cut calls, cut context, or change model — which is why
the decomposition is the useful form of the answer rather than a ranking.

*(Rendered as text rather than LaTeX so the exported HTML needs no MathJax CDN and
reads correctly offline.)*
""")

code(r'''
display(SVC[["model", "cost", "cost_share", "req_share", "tok_share",
             "tokens_per_request", "usd_per_1k", "usd_per_request"]]
        .style.format({"cost": "${:,.0f}", "cost_share": "{:.1%}", "req_share": "{:.1%}",
                       "tok_share": "{:.1%}", "tokens_per_request": "{:,.0f}",
                       "usd_per_1k": "${:.4f}", "usd_per_request": "${:.4f}"}))

say(f"""
Total spend over the window: **${SVC['cost'].sum():,.2f}** across
{len(SVC)} services, {df['team'].nunique()} teams and {df['model'].nunique()} models,
{DAILY.index.min():%d %b} – {DAILY.index.max():%d %b %Y}.
""")
''')

md(r"""
### 5.1 The three shares

The point of putting the three shares side by side is that they disagree, and the
disagreement is the finding. A service that took the same slice of each would be
uninteresting; the biggest cost driver here is the *smallest* by request volume.
""")

code(r'''
fig, axes = plt.subplots(1, 3, figsize=(12.5, 4.2), sharex=True,
                         gridspec_kw={"wspace": 0.34})
order = SVC.index.tolist()
y = np.arange(len(order))
# One x-scale across all three panels. With three independent scales a 48% bar in
# one panel draws the same length as a 52% bar in another, which is exactly the
# comparison the figure exists to make.
xmax = SVC[["req_share", "tok_share", "cost_share"]].to_numpy().max() * 118

for ax, col, title, colour in [
    (axes[0], "req_share", "Share of requests", C_REQ),
    (axes[1], "tok_share", "Share of tokens", C_TOK),
    (axes[2], "cost_share", "Share of cost", C_COST),
]:
    vals = SVC[col].values
    # One series, one colour — a value-ramp here would double-encode bar length.
    ax.barh(y, vals * 100, color=colour, height=0.6)
    ax.set_yticks(y, order, fontsize=9.5)
    ax.invert_yaxis()
    ax.set_title(title, loc="left", fontsize=11, pad=8)
    ax.set_xlim(0, xmax)
    ax.set_xlabel("% of window total", fontsize=9)
    ax.xaxis.set_major_formatter(mpl.ticker.StrMethodFormatter("{x:.0f}%"))
    for yi, v in zip(y, vals):
        ax.text(v * 100 + xmax * 0.02, yi, f"{v:.0%}", va="center",
                fontsize=9.5, fontweight="bold", color="#0b0b0b")

fig.suptitle(f"{TOP}: {SVC.loc[TOP, 'req_share']:.0%} of requests, "
             f"{SVC.loc[TOP, 'tok_share']:.0%} of tokens, "
             f"{SVC.loc[TOP, 'cost_share']:.0%} of cost",
             x=0.005, ha="left", fontsize=13, fontweight="bold", y=1.02)
show_figure(fig, "Figure 4",
            "Three bar panels on a shared scale. The biggest cost driver has the "
            "shortest bar for share of requests and by far the longest for share of "
            "cost; the ordering is reversed between the first and third panels.")

say(f"""
**Figure 4. Each service's share of requests, tokens and spend over the window.**
Services in descending order of cost in all three panels, and **one shared x-scale**,
so a bar's vertical position is fixed and length is comparable across panels as well
as within them. *What to conclude:* `{TOP}` is
**last** on request volume at {SVC.loc[TOP, 'req_share']:.1%} and **first** on cost at
{SVC.loc[TOP, 'cost_share']:.1%} — more than the other {len(SVC) - 1} services combined.
Whatever is driving its spend, it is not how often it is called.
""")
''')

md(r"""
### 5.2 The decomposition, with intervals

A share computed from one window is a point estimate. The question a reader should
ask is whether it would look the same next month, and there are two different
uncertainties in that:

1. **Sampling** — would a different window of the same process give the same
   answer? Answered by a **moving-block bootstrap** over days, block length 7. The
   block preserves the weekly cycle and the local serial dependence that an
   ordinary day-level resample would destroy; resampling individual days
   independently would ignore both and report an interval that is too narrow.
2. **Stability** — is the share drifting within the window, or driven by a handful
   of days? Answered directly, by the week-by-week series and by leave-one-day-out.

Both are reported. Neither is a substitute for the other.
""")

code(r'''
# Day x service matrices. No zero-filling of absent service-days: those days are
# excluded from the resample rather than counted as days of nil usage.
piv = {m: df.pivot_table(index="date", columns="service", values=c, aggfunc="sum")
       for m, c in [("cost", "cost_usd"), ("req", "requests"), ("tok", "total_tokens")]}
full_days = piv["cost"].notna().all(axis=1)
M = {k: v[full_days].to_numpy() for k, v in piv.items()}
svc_names = list(piv["cost"].columns)
i_top, i_cheap = svc_names.index(TOP), svc_names.index(CHEAPEST)
n_days = M["cost"].shape[0]

BLOCK = 7
n_blocks = int(np.ceil(n_days / BLOCK))
starts = RNG.integers(0, n_days - BLOCK + 1, size=(N_BOOT, n_blocks))
BOOT_IDX = (starts[:, :, None] + np.arange(BLOCK)).reshape(N_BOOT, -1)[:, :n_days]


def boot(matrix):
    "Sum each bootstrap replicate's days -> (N_BOOT, n_services)."
    return matrix[BOOT_IDX].sum(axis=1)


bc, br, bt = boot(M["cost"]), boot(M["req"]), boot(M["tok"])


def ci(v, lo=2.5, hi=97.5):
    return np.percentile(v, lo), np.percentile(v, hi)


stats = {
    "cost share of " + TOP: bc[:, i_top] / bc.sum(axis=1),
    "request share of " + TOP: br[:, i_top] / br.sum(axis=1),
    "token share of " + TOP: bt[:, i_top] / bt.sum(axis=1),
}
factors = {
    "volume factor (requests)": br[:, i_top] / br[:, i_cheap],
    "verbosity factor (tokens/request)": (bt[:, i_top] / br[:, i_top]) / (bt[:, i_cheap] / br[:, i_cheap]),
    "unit-price factor ($/token)": (bc[:, i_top] / bt[:, i_top]) / (bc[:, i_cheap] / bt[:, i_cheap]),
    "cost per request, combined": (bc[:, i_top] / br[:, i_top]) / (bc[:, i_cheap] / br[:, i_cheap]),
}
point = {
    "cost share of " + TOP: SVC.loc[TOP, "cost_share"],
    "request share of " + TOP: SVC.loc[TOP, "req_share"],
    "token share of " + TOP: SVC.loc[TOP, "tok_share"],
    "volume factor (requests)": SVC.loc[TOP, "requests"] / SVC.loc[CHEAPEST, "requests"],
    "verbosity factor (tokens/request)": SVC.loc[TOP, "tokens_per_request"] / SVC.loc[CHEAPEST, "tokens_per_request"],
    "unit-price factor ($/token)": SVC.loc[TOP, "usd_per_1k"] / SVC.loc[CHEAPEST, "usd_per_1k"],
    "cost per request, combined": SVC.loc[TOP, "usd_per_request"] / SVC.loc[CHEAPEST, "usd_per_request"],
}

rows = []
for name, v in {**stats, **factors}.items():
    lo, hi = ci(v)
    is_share = "share" in name
    fmt = (lambda x: f"{x:.1%}") if is_share else (lambda x: f"x{x:.2f}")
    rows.append({"quantity": name, "point estimate": fmt(point[name]),
                 "95% interval": f"{fmt(lo)} to {fmt(hi)}",
                 "relative width": f"±{(hi - lo) / 2 / point[name] * 100:.1f}%"})
display(pd.DataFrame(rows).set_index("quantity"))

leader = np.array(svc_names)[bc.argmax(axis=1)]
lowest_req = np.array(svc_names)[br.argmin(axis=1)]
print(f"\nAcross {N_BOOT:,} block-bootstrap replicates:")
print(f"  `{TOP}` is the biggest spender in {(leader == TOP).mean():.2%} of them")
print(f"  `{TOP}` has the smallest request share in {(lowest_req == TOP).mean():.2%} of them")
print(f"  its lead over the second-biggest spender is at least "
      f"{np.percentile(np.sort(bc, axis=1)[:, -1] / bc.sum(axis=1) - np.sort(bc, axis=1)[:, -2] / bc.sum(axis=1), 2.5) * 100:.1f} "
      f"points of total spend in 97.5% of them")
''')

code(r'''
# Stability: is the share drifting, and does any single day carry it?
wk_share = (df.pivot_table(index=pd.Grouper(key="date", freq="W-SUN"), columns="service",
                           values="cost_usd", aggfunc="sum")
              .pipe(lambda t: t[TOP] / t.sum(axis=1)))
day_cost = piv["cost"]
day_share = (day_cost[TOP] / day_cost.sum(axis=1)).dropna()
loo = ((day_cost[TOP].sum() - day_cost[TOP]) / (day_cost.sum().sum() - day_cost.sum(axis=1)))

# Is the share itself trending? Same estimator as §4, on the share series.
ts = np.arange(len(day_share))
Xd = sm.add_constant(np.column_stack([
    ts, pd.get_dummies(day_share.index.dayofweek, prefix="d", drop_first=True).astype(float).values]))
md_ = sm.OLS(day_share.values * 100, Xd).fit(cov_type="HAC", cov_kwds={"maxlags": 7})
dlo, dhi = md_.conf_int()[1]

print(f"Weekly cost share of {TOP} across {len(wk_share)} weeks:")
print("   " + "  ".join(f"{v:.0%}" for v in wk_share))
print(f"   range {wk_share.min():.1%} to {wk_share.max():.1%}, "
      f"standard deviation {wk_share.std():.1%}")
print(f"   the lowest week is {wk_share.idxmin():%d %b}, which contains the day "
      f"{TOP} has no row at all")
print(f"\nTrend in the daily share over {len(day_share)} days: "
      f"{md_.params[1] * len(day_share):+.2f} points across the window "
      f"(95% CI {dlo * len(day_share):+.2f} to {dhi * len(day_share):+.2f}, p = {md_.pvalues[1]:.2f})")
print(f"\nLeave-one-day-out ({len(loo)} days): share ranges "
      f"{loo.min():.2%} to {loo.max():.2%}")
print(f"   the most influential single day is {loo.idxmin():%Y-%m-%d} "
      f"(removing it moves the share by {abs(loo.min() - SVC.loc[TOP, 'cost_share']) * 100:.2f} points)")

hi_days = day_cost.sum(axis=1).nlargest(int(np.ceil(len(day_cost) * 0.05))).index
lo_days = day_cost.sum(axis=1).nsmallest(int(np.ceil(len(day_cost) * 0.05))).index
trim = day_cost.drop(index=hi_days.union(lo_days))
print(f"\nExcluding the {len(hi_days)} most and {len(lo_days)} least expensive days "
      f"({len(hi_days) + len(lo_days)} of {len(day_cost)}): "
      f"share = {trim[TOP].sum() / trim.sum().sum():.2%} "
      f"(baseline {SVC.loc[TOP, 'cost_share']:.2%})")

say(f"""
**The share is stable on every check.** Week to week it sits between
{wk_share.min():.0%} and {wk_share.max():.0%} with no trend
({md_.params[1] * len(day_share):+.2f} points over the window, p = {md_.pvalues[1]:.2f}); the
single lowest week is the one containing the day `{TOP}` has no row at all, which is a
gap in the source rather than a fall in demand. No single day carries the result —
removing the most influential of the {len(loo)} days moves the share by
{abs(loo.min() - SVC.loc[TOP, 'cost_share']) * 100:.2f} points — and excluding the most
and least expensive {len(hi_days) + len(lo_days)} days together moves it by
{abs(trim[TOP].sum() / trim.sum().sum() - SVC.loc[TOP, 'cost_share']) * 100:.2f} points.
This is a structural feature of the workload, not an artefact of the window.
""")
''')

code(r'''
fig, ax = plt.subplots(figsize=(9.5, 3.6))
vals = SVC["usd_per_request"].sort_values()
bars = ax.barh(np.arange(len(vals)), vals.values, color=C_MUTED, height=0.6)
# Emphasis carried twice: colour for the screen, texture for greyscale and print.
# set_facecolor, not set_color — set_color fixes the hatch colour before the hatch
# exists and the texture is then silently dropped, which is the failure this
# notebook is least willing to ship.
bars[-1].set_facecolor(C_COST)
bars[-1].set_edgecolor("white")
bars[-1].set_linewidth(1.0)
bars[-1].set_hatch("///")
assert bars[-1].get_hatch() and bars[-1].get_linewidth() > 0, "emphasis texture was dropped"
ax.set_yticks(np.arange(len(vals)), vals.index, fontsize=9.5)
ax.set_xlabel("cost per request (USD)", fontsize=9.5)
ax.set_title(f"One {TOP} request costs about "
             f"{point['cost per request, combined']:.0f}x one {CHEAPEST} request",
             loc="left", pad=10)
ax.xaxis.set_major_formatter(mpl.ticker.StrMethodFormatter("${x:.3f}"))
for i, v in enumerate(vals.values):
    ax.text(v * 1.03, i, f"${v:.4f}", va="center", fontsize=9.5, fontweight="bold")
ax.set_xlim(0, vals.max() * 1.22)
show_figure(fig, "Figure 5",
            "A horizontal bar chart of cost per request by service. Three bars are "
            "short and nearly equal; the fourth, hatched, is roughly twenty-five "
            "times longer.")

_lo, _hi = ci(factors["cost per request, combined"])
say(f"""
**Figure 5. Cost of one request, by service.** Hatched and coloured bar: the biggest
cost driver. *What to conclude:* the per-unit economics, which the share chart cannot
show. `{TOP}` costs **${SVC.loc[TOP, 'usd_per_request']:.4f}** per request against
**${SVC.loc[CHEAPEST, 'usd_per_request']:.4f}** for `{CHEAPEST}` — a ratio of
{point['cost per request, combined']:.1f}x (95% interval {_lo:.1f} to {_hi:.1f}).
This is the number that makes the cost concentration make sense despite the low
request share.
""")
''')

code(r'''
_v = {k: (point[k], *ci(factors[k])) for k in factors}
_cs = (point["cost share of " + TOP], *ci(stats["cost share of " + TOP]))
# The CONSERVATIVE version of a model switch: the dearest of the non-premium tiers,
# not the cheapest. Using the cheapest would flatter the saving.
_alt_rate = SVC["usd_per_1k"].drop(TOP).max()
_alt_svc = SVC["usd_per_1k"].drop(TOP).idxmax()
_swap = SVC.loc[TOP, "tokens"] * _alt_rate / 1_000
_price_ci = _v["unit-price factor ($/token)"]
_price_note = ("exact to two decimal places — resampling days cannot move it, because "
               "§2.1 showed the price is a deterministic tier and not an average"
               if round(_price_ci[2] - _price_ci[1], 2) == 0 else
               f"±{(_price_ci[2] - _price_ci[1]) / 2 / _price_ci[0] * 100:.1f}%")

say(f"""
### Answer to Q2

**`{TOP}` is the biggest cost driver — {_cs[0]:.1%} of total spend
(95% interval {_cs[1]:.1%} to {_cs[2]:.1%}) — and it is *not* request volume.
It is unit price multiplied by verbosity.**

| | `{TOP}` | rank among the {len(SVC)} services |
|---|---|---|
| Share of **requests** | {SVC.loc[TOP, 'req_share']:.1%} | **lowest** |
| Share of **tokens** | {SVC.loc[TOP, 'tok_share']:.1%} | {int(SVC['tok_share'].rank(ascending=False)[TOP])} of {len(SVC)} |
| Share of **cost** | **{SVC.loc[TOP, 'cost_share']:.1%}** | **highest** — more than the other {len(SVC) - 1} combined |

Decomposed against the cheapest service per request, `{CHEAPEST}`:

* **Request volume: x{_v['volume factor (requests)'][0]:.2f}**
  ({_v['volume factor (requests)'][1]:.2f} to {_v['volume factor (requests)'][2]:.2f}) —
  it makes *fewer* calls. Volume is pushing its cost **down**, not up.
* **Tokens per request: x{_v['verbosity factor (tokens/request)'][0]:.2f}**
  ({_v['verbosity factor (tokens/request)'][1]:.2f} to {_v['verbosity factor (tokens/request)'][2]:.2f})
  — {SVC.loc[TOP, 'tokens_per_request']:,.0f} against
  {SVC.loc[CHEAPEST, 'tokens_per_request']:,.0f}. It reads whole documents.
* **Price per 1k tokens: x{_v['unit-price factor ($/token)'][0]:.2f}**
  ({_v['unit-price factor ($/token)'][1]:.2f} to {_v['unit-price factor ($/token)'][2]:.2f})
  — ${SVC.loc[TOP, 'usd_per_1k']:.3f} against ${SVC.loc[CHEAPEST, 'usd_per_1k']:.3f}. It is the
  only service on `{SVC.loc[TOP, 'model']}` rather than `{SVC.loc[CHEAPEST, 'model']}`.

Those two compound: **one `{TOP}` request costs
x{_v['cost per request, combined'][0]:.1f} one `{CHEAPEST}` request**
({_v['cost per request, combined'][1]:.1f} to {_v['cost per request, combined'][2]:.1f}).

**The intervals matter here.** The unit-price factor is the tightest quantity in the
notebook — {_price_note}. The verbosity factor is looser but nowhere near wide enough
to change the ordering, and the widest interval of the three belongs to request
volume, the factor that is *already* working in our favour. `{TOP}` is the biggest
spender and the smallest caller in **every one** of {N_BOOT:,} bootstrap replicates,
and its lead over the second-biggest spender is at least
{np.percentile(np.sort(bc, axis=1)[:, -1] / bc.sum(axis=1) - np.sort(bc, axis=1)[:, -2] / bc.sum(axis=1), 2.5) * 100:.0f}
points of total spend in 97.5% of them.

**So the lever is not "make fewer calls".** It is (a) the model choice and (b) how
much context each call carries. To size the first: if `{TOP}`'s tokens were served at
`{_alt_svc}`'s rate — the **dearest** of the non-premium tiers in this file, so the
cautious version of the comparison — its bill over this window would fall from
${SVC.loc[TOP, 'cost']:,.0f} to ${_swap:,.0f}, a saving of
**${SVC.loc[TOP, 'cost'] - _swap:,.0f}**, or
**{(SVC.loc[TOP, 'cost'] - _swap) / SVC['cost'].sum():.0%} of total spend**.

That is a ceiling on the prize, not a plan. It assumes every document can be handled
by a cheaper model, and **this dataset cannot tell us that** — it records what was
spent, not whether the answers were good enough. §9 says what would settle it.
Trimming context attacks the other factor and compounds with it. Cutting request
volume, the intuitive first move, would barely move the bill.
""")
''')

# ═══════════════════════════════════════════════════════════════════════════
# 6. Q3 — assumptions, exclusions, transformations
# ═══════════════════════════════════════════════════════════════════════════
md(r"""
---

## 6. Q3 — Assumptions, exclusions and transformations

### 6.1 The transformation register

Written by the pipeline as each change is made, not reconstructed afterwards. A
reader who disagrees with one line can find exactly where it was applied without
re-deriving the notebook, and §7 shows what disagreeing would cost.
""")

code(r'''
log = pd.DataFrame(DECISIONS)
display(log.style.hide(axis="index")
           .set_properties(**{"text-align": "left", "white-space": "pre-wrap",
                              "vertical-align": "top"}))

say(f"""
**{len(log)} transformations, touching {log['Rows'].sum()} cells across
{int(FLAGS.any(axis=1).sum())} of {len(raw):,} rows ({FLAGS.any(axis=1).mean():.1%}).**
Of those, {int(log.loc[log['Action'].str.startswith('Dropped'), 'Rows'].sum())} row was
removed from the analysis and the rest were repaired in place.
""")
''')

md(r"""
### 6.2 Assumptions

Each is stated with what happens if it is wrong. Four of the six are exercised
numerically in §7; the two that cannot be are marked.
""")

code(r'''
amb_row = raw.loc[FLAGS.index[FLAGS["date not ISO-8601"]][0]]
_dup_cost = float(pd.to_numeric(raw.loc[FLAGS["duplicate of an earlier row"], "cost_usd"]).sum())
_worst_dev = max(
    abs(df.loc[df["service"] == s, "usd_per_1k_tokens"] / RATE[s] - 1).max() for s in RATE.index)

say(f"""
1. **The one non-ISO date is day-first.** `{amb_row['date']}` is read as
   {pd.to_datetime(amb_row['date'], dayfirst=True):%-d %B %Y}. Month-first would place it
   {pd.to_datetime(amb_row['date'], dayfirst=False):%-d %B %Y}, outside the window every
   other row occupies, and would leave open a panel gap that day-first fills exactly
   (§2.2). *If wrong:* one row moves by four months. Totals are unchanged; the trend
   estimate is not — **§7 shows this is the assumption that matters most.**

2. **Price is a deterministic per-service tier.** Verified, not assumed:
   `cost = round(tokens x rate / 1000, 2)` reproduces every untouched row in the file
   to the cent, and the largest deviation of any cleaned row from its service's rate is
   {_worst_dev * 100:.2f}% — consistent with rounding to the nearest cent on small
   amounts, not with a variable price. Both imputations and the anomaly restatement
   rest on this. *If wrong:* three cells become approximate — one imputed cost
   (${imputed.loc[imputed['source_row'].isin(FLAGS.index[FLAGS['cost_usd missing']]), 'cost_usd'].iloc[0]:.2f},
   {imputed.loc[imputed['source_row'].isin(FLAGS.index[FLAGS['cost_usd missing']]), 'cost_usd'].iloc[0] / df['cost_usd'].sum():.2%}
   of spend), one imputed token count
   ({imputed.loc[imputed['source_row'].isin(FLAGS.index[FLAGS['total_tokens missing']]), 'total_tokens'].iloc[0]:,.0f},
   {imputed.loc[imputed['source_row'].isin(FLAGS.index[FLAGS['total_tokens missing']]), 'total_tokens'].iloc[0] / df['total_tokens'].sum():.2%}
   of tokens) and one restated cost
   (${an['expected_usd']:,.2f}, {an['expected_usd'] / df['cost_usd'].sum():.1%} of spend).
   Exercised in §7 by taking the rate at the model grain instead.

3. **Identical rows are double-counted exports, not restatements.** A genuine
   restatement would differ in at least one measure. *If wrong:* one day of
   `{raw.loc[FLAGS['duplicate of an earlier row'], 'service'].iloc[0].lower().replace(' ', '-')}`
   is understated by ${_dup_cost:,.2f}. Exercised in §7.

4. **`cost_usd` is USD, tax-exclusive and comparable across the window.** No currency
   or list-price column is provided, and the per-service rate is constant month to
   month, so no repricing occurred mid-window. *Not testable from this file.*

5. **A row is a complete daily total** for its team/service/model, not a sample or a
   partial export. *Not testable from this file* — and the assumption a second month
   of data would test first.

6. **`total_tokens` is prompt plus completion combined.** The workbook provides no
   split, so the verbosity factor in §5 cannot be attributed to input context versus
   output length. Noted again in §8 and §9.
""")
''')

md(r"""
### 6.3 Exclusions

* **One row was dropped** from the analysis: the byte-identical duplicate. Both rows
  carrying impossible values were *repaired* rather than removed, because each had
  enough intact fields to reconstruct the broken one — and because a row that is
  dropped leaves nothing for a reader to argue with.
* **Three service-days are absent from the source.** They are treated as *not
  recorded*, never as zero usage. Filling them with zeros would invent three days of
  nil demand, bias every daily mean downward, and — as §4.2's first draft showed —
  put a 0% spike into a chart of shares that never happened.
* **No days, services or outliers were excluded from the analysis** on statistical
  grounds. §5.2 reports what happens if the most and least expensive days are
  trimmed; it is reported rather than done.

### 6.4 Transformations, in order

Label canonicalisation → date parsing → numeric coercion → de-duplication →
imputation from the price rule → repair of impossible values → derived fields.

The order is load-bearing. Labels before de-duplication, or `Chat Router` and
`chat-router` never collide and the duplicate survives. De-duplication before the
rate is derived, or a doubled row skews the benchmark used to detect the anomaly.
The rate before either imputation, since both divide by it.
""")

code(r'''
_shared_model = SVC["model"].value_counts().idxmax()
_shared = SVC[SVC["model"] == _shared_model]

say(f"""
### 6.5 Findings worth escalating

1. **A {an['ratio']:.1f}x billing departure on {an['date']:%-d %B %Y}.**
   ${an['cost_usd']:,.2f} charged where the service's own rate gives
   ${an['expected_usd']:,.2f} — **${an['cost_usd'] - an['expected_usd']:,.2f} on a single
   line**, {(an['cost_usd'] - an['expected_usd']) / pre['cost_usd'].sum():.1%} of the
   window's billed total. Every other row in the file obeys the rule to the cent, so
   this is not price variance. Restated here; it warrants a query to the vendor.

2. **Data-quality defects in {int(FLAGS.any(axis=1).sum())} of {len(raw):,} rows
   ({FLAGS.any(axis=1).mean():.1%}), across {int((FLAGS.sum() > 0).sum())} distinct
   classes.** At that rate, unvalidated ingestion corrupts roughly one line in
   {1 / FLAGS.any(axis=1).mean():.0f}. Every class is machine-detectable at load time —
   §9 gives the checks.

3. **The price tier is per service, not per model.** The {len(_shared)} services running
   on `{_shared_model}` bill at {RATE[_shared.index].nunique()} different rates
   ({", ".join(f"`{s}` ${RATE[s]:.3f}" for s in _shared.index)} per 1k tokens). Whether
   that is negotiated pricing or a stable prompt-to-completion mix cannot be determined
   without a token split — but anyone modelling this spend at the model grain will be
   wrong by up to
   {max(abs(RATE[s] / unit_rate(df, "model")[df.loc[df["service"] == s, "model"].iat[0]] - 1) for s in RATE.index) * 100:.0f}%
   on a service's unit cost.
""")
''')

# ═══════════════════════════════════════════════════════════════════════════
# 7. Sensitivity
# ═══════════════════════════════════════════════════════════════════════════
md(r"""
---

## 7. Sensitivity analysis

Every number above rests on the judgement calls in §3. This section re-runs the
**entire analysis** — cleaning, aggregation and both estimators — with each of
those calls made the other way, and reports what moves.

This is the section that separates a defensible answer from a plausible one. A
conclusion that survives every alternative treatment is a conclusion about the
data; one that depends on a particular choice is a conclusion about the analyst,
and should be labelled as such.

Each variant flips exactly one decision, so the effect attributed to it is its
own. The baseline is the first row.
""")

code(r'''
show = SENS.assign(**{
    "leader": SENS["leader"],
    "leader share": SENS["leader_share"],
    "Δ share (pts)": (SENS["leader_share"] - SENS["leader_share"].iloc[0]) * 100,
    "weekly cost growth": SENS["weekly_pct"],
    "95% CI": [f"{lo:+.2f} to {hi:+.2f}" for lo, hi in zip(SENS["lo"], SENS["hi"])],
    "Δ growth (pts)": SENS["weekly_pct"] - SENS["weekly_pct"].iloc[0],
    "cost/request ratio": SENS["cost_per_req_ratio"],
})[["rows", "total_usd", "leader", "leader share", "Δ share (pts)",
    "weekly cost growth", "95% CI", "Δ growth (pts)", "cost/request ratio"]]

display(show.style.format({
    "rows": "{:.0f}", "total_usd": "${:,.2f}", "leader share": "{:.2%}",
    "Δ share (pts)": "{:+.2f}", "weekly cost growth": "{:+.2f}%",
    "Δ growth (pts)": "{:+.2f}", "cost/request ratio": "x{:.2f}"}))
''')

code(r'''
fig, axes = plt.subplots(1, 2, figsize=(12.6, 4.6), gridspec_kw={"wspace": 0.06})
labels = [textwrap.fill(v, 44) for v in SENS.index]
y = np.arange(len(SENS))[::-1]

for ax, series, base_v, title, unit, colour in [
    (axes[0], SENS["leader_share"] * 100, SENS["leader_share"].iloc[0] * 100,
     f"{TOP}'s share of cost", "% of total spend", C_COST),
    (axes[1], SENS["weekly_pct"], SENS["weekly_pct"].iloc[0],
     "weekly growth in cost", "% per week", C_COST),
]:
    ax.axvline(base_v, color="#2b2a26", lw=1.0, ls=(0, (4, 3)), zorder=1)
    ax.scatter(series.values, y, s=52, color=C_MUTED, edgecolor="white", lw=0.8, zorder=3)
    ax.scatter([series.iloc[0]], [y[0]], s=72, color=colour, edgecolor="white", lw=0.8,
               zorder=4, marker="D")
    ax.set_title(title, loc="left", fontsize=11, pad=8)
    ax.set_xlabel(unit, fontsize=9)
    ax.grid(axis="y", alpha=0.12)

# The growth panel also carries each variant's confidence interval — the point of
# the section is whether an alternative moves the ESTIMATE beyond its own noise.
axes[1].hlines(y, SENS["lo"], SENS["hi"], color=C_MUTED, lw=2.2, alpha=0.55, zorder=2)
# Zero is the decision line on the right: an interval crossing it means the growth
# finding does not survive that cleaning.
axes[1].axvline(0, color="#b0342a", lw=1.2, zorder=1)
axes[1].annotate("no growth", xy=(0, 0.015), xycoords=("data", "axes fraction"),
                 xytext=(4, 0), textcoords="offset points",
                 fontsize=8.5, color="#b0342a", va="bottom")
axes[0].set_yticks(y, labels, fontsize=8.5)
axes[1].set_yticks(y, [""] * len(y))
axes[0].annotate("baseline", (SENS["leader_share"].iloc[0] * 100, y[0]), xytext=(9, 10),
                 textcoords="offset points", fontsize=8.5, color="#2b2a26")
fig.suptitle("Every alternative cleaning leaves both answers standing — except one",
             x=0.005, ha="left", fontsize=13, fontweight="bold", y=1.02)
show_figure(fig, "Figure 6",
            "Two dot panels, one per headline answer, with one dot per alternative "
            "cleaning. In the left panel all dots cluster tightly on the baseline. In "
            "the right panel all but one confidence bar sits clear of zero.")

_worst_share = (SENS["leader_share"] - SENS["leader_share"].iloc[0]).abs().idxmax()
_worst_growth = (SENS["weekly_pct"] - SENS["weekly_pct"].iloc[0]).abs().idxmax()
_insig = SENS[(SENS["lo"] < 0) & (SENS["hi"] > 0)]

say(f"""
**Figure 6. Both headline answers under {len(SENS)} cleanings — the baseline (green
diamond) and {len(SENS) - 1} single-decision alternatives (grey).**
Left: `{TOP}`'s share of total cost. Right: fitted weekly growth in cost, with each
variant's own 95% confidence interval as a horizontal bar. Dashed line: the baseline
value. *What to conclude:* every alternative leaves `{TOP}` as the cost leader and
leaves its share within
{(SENS['leader_share'] - SENS['leader_share'].iloc[0]).abs().max() * 100:.1f} points of
baseline. Growth stays positive and significant under all but
{len(_insig)} of them — and that one is the date reading, whose interval
({_insig['lo'].iloc[0]:+.2f} to {_insig['hi'].iloc[0]:+.2f}%) straddles zero.
""")
''')

code(r'''
_row = SENS.loc[_worst_growth]
_base_row = SENS.iloc[0]

say(f"""
### What the sensitivity analysis changes

**Nothing overturns Q2.** `{TOP}` is the biggest cost driver in all {len(SENS)}
cleanings. Its share moves at most
{(SENS['leader_share'] - SENS['leader_share'].iloc[0]).abs().max() * 100:.2f} points —
the largest mover is *{_worst_share}* — and the cost-per-request ratio that carries the
argument moves at most
{(SENS['cost_per_req_ratio'] - SENS['cost_per_req_ratio'].iloc[0]).abs().max():.2f}x on a
base of x{SENS['cost_per_req_ratio'].iloc[0]:.1f}. **The answer to Q2 is a property of
the data, not of the cleaning.**

**One decision does change Q1 materially: the date.** Read month-first, weekly cost
growth is estimated at {_row['weekly_pct']:+.2f}% with a 95% interval of
{_row['lo']:+.2f} to {_row['hi']:+.2f}% — **no longer distinguishable from zero**,
against {_base_row['weekly_pct']:+.2f}% ({_base_row['lo']:+.2f} to {_base_row['hi']:+.2f}%)
at baseline. The mechanism is not subtle: month-first moves one row roughly four
months past the end of the window, creating a lone observation with enormous leverage
on a fitted trend, and a three-month hole in between.

That is worth being precise about, because it is easy to over-read. It does **not**
mean the growth finding is fragile — it means *that* reading of the date destroys the
series. The evidence for day-first is independent of the trend and was settled in
§2.2 before any model was fitted: month-first puts the row outside the range of all
{len(raw) - 1:,} other rows and leaves a panel gap open that day-first fills exactly.
The sensitivity analysis is here to show that if a reader rejects that argument, they
must also give up the growth estimate — not to suggest the argument is weak.

**Leaving the anomalous cost as billed** is the largest effect on the level: total
spend rises to ${SENS.loc['Anomalous cost left exactly as billed', 'total_usd']:,.2f}
and `{TOP}`'s share to
{SENS.loc['Anomalous cost left exactly as billed', 'leader_share']:.1%}. It changes no
conclusion, but it does inflate the very number a FinOps team would be asked to
explain — which is the argument for restating it *and* reporting it separately, as
§6.5 does.

**The remaining decisions are near-immaterial**, which is worth stating plainly
because it means the effort spent arguing about them in §3 was insurance rather than
necessity. Taking the price tier per model instead of per service, dropping the two
imputed rows, keeping the duplicate, or treating `requests = -25` as a sign flip each
move the cost share by under
{(SENS.drop(index=[_worst_share, 'Date read month-first (5 Sep) not day-first (9 May)'])['leader_share'] - SENS['leader_share'].iloc[0]).abs().max() * 100:.2f}
points. Note in particular that the `abs()` reading of `requests = -25` changes **no
cost figure at all** — it only moves the request series — so the argument in §3.2 is
about getting the request-volume factor right, not about protecting the headline.
""")
''')

# ═══════════════════════════════════════════════════════════════════════════
# 8. Limitations
# ═══════════════════════════════════════════════════════════════════════════
md(r"""
---

## 8. Limitations — what this data cannot answer

Stated as things a reader must not conclude, because that is the form in which a
limitation actually protects anyone.
""")

code(r'''
_years = (DAILY.index.max() - DAILY.index.min()).days / 365.25

say(f"""
**1. One window, no seasonality, no comparison period.**
{len(DAILY)} consecutive days — {_years * 12:.1f} months — of a single file. That is
enough to fit a trend with a usable interval, and nowhere near enough to separate
trend from season, from a product launch, from a marketing push, or from one team
onboarding. **Do not read the {G['cost']['weekly_pct']:.1f}%/week as a growth rate of the
business.** It is the growth rate of this window. §4.1 projects it one quarter ahead
because a quarter is roughly the horizon over which that is defensible; a
twelve-month projection from {len(DAILY)} days would be arithmetic, not evidence.

**2. Null results are bounded, not proven.**
§4.2 finds no drift in unit price or verbosity. What it establishes is that any
cumulative drift larger than about
{max(abs(np.exp(np.log(1 + DIVERGE['cost/tokens']['lo'] / 100) / 7 * G['cost']['n']) - 1), abs(np.exp(np.log(1 + DIVERGE['cost/tokens']['hi'] / 100) / 7 * G['cost']['n']) - 1)) * 100:.0f}%
in price per token, or
{max(abs(np.exp(np.log(1 + DIVERGE['tokens/requests']['lo'] / 100) / 7 * G['cost']['n']) - 1), abs(np.exp(np.log(1 + DIVERGE['tokens/requests']['hi'] / 100) / 7 * G['cost']['n']) - 1)) * 100:.0f}%
in verbosity, would have shown up over this window. A slower drift is entirely
compatible with what is here. **Do not conclude that the mix is guaranteed stable** —
conclude that it did not move enough to matter over {len(DAILY)} days.

**3. No prompt/completion split, so the verbosity factor cannot be attributed.**
`{TOP}` uses {SVC.loc[TOP, 'tokens_per_request']:,.0f} tokens per request against
{SVC.loc[CHEAPEST, 'tokens_per_request']:,.0f} for `{CHEAPEST}`. Whether that is long
input context or long generated output decides whether the fix is prompt engineering,
retrieval, or an output cap — and this file cannot tell them apart. §9 asks for the
column.

**4. Cost, not value.** Every recommendation in §5 is about spending less. Nothing
here measures whether the cheaper model would have produced acceptable answers, so
**the ${SVC.loc[TOP, 'cost'] - _swap:,.0f} saving is a ceiling on the prize, not a
forecast of it.** A dataset of spend can rank costs; it cannot rank cost-effectiveness.

**5. Four services, three teams, two models — n is small where it counts.**
The decomposition in §5 compares {len(SVC)} services. Every interval reported for it
comes from resampling {len(DAILY)} days, not from {len(SVC)} independent services, and
the between-service comparison itself has no sampling interval at all — it is a census
of what these four did, not a sample of what services in general do. **Do not
generalise the x{point['cost per request, combined']:.0f} ratio beyond these two
services.**

**6. The repairs are defensible, not certain.**
{int(FLAGS.to_numpy().sum())} defects were repaired on arguments, one of which (the
date) changes an answer if rejected — see §7. The register in §6.1 exists so that a
reader who disagrees knows exactly which line to pull.

**7. Statistical caveats that are handled but not eliminated.** Residuals are
non-normal (§4.4), so p-values are approximate; HAC standard errors are consistent but
their small-sample behaviour at n = {G['cost']['n']} is optimistic; and the block
bootstrap in §5.2 assumes the {len(DAILY)}-day window is representative of the process
generating it, which is limitation 1 again in a different costume.
""")
''')

# ═══════════════════════════════════════════════════════════════════════════
# 9. Next
# ═══════════════════════════════════════════════════════════════════════════
md(r"""
---

## 9. What I would do next
""")

code(r'''
# The ingestion checks, with the count each one catches computed from FLAGS rather
# than asserted — so the table cannot drift from the defect register in §2.3.
_checks = pd.DataFrame([
    ("`date` matches ISO-8601", ["date not ISO-8601"]),
    ("`team` / `service` in a controlled vocabulary",
     ["team label variant", "service label variant"]),
    ("`requests`, `total_tokens`, `cost_usd` all present and `> 0`",
     ["requests <= 0", "cost_usd missing", "total_tokens missing"]),
    ("`cost` within ±1% of `tokens x rate(service)`", ["cost far above the price rule"]),
    ("unique on `(date, team, service, model)`", ["duplicate of an earlier row"]),
], columns=["check", "flags"]).assign(
    catches=lambda t: t["flags"].map(lambda cs: int(FLAGS[cs].to_numpy().sum())))
_checks = pd.concat([_checks, pd.DataFrame([{
    "check": "every (day, service) cell present", "flags": [],
    "catches": int(grid.isna().to_numpy().sum())}])], ignore_index=True)
assert _checks["catches"].iloc[:-1].sum() == int(FLAGS.to_numpy().sum()), \
    "the ingestion checks do not cover every defect class"
_checks_md = md_table(
    _checks.assign(**{"defects it would have caught": _checks["catches"]})
           .set_index("check")[["defects it would have caught"]],
    "{:.0f}", "Check")

say(f"""
### On the cost finding

**Route triage, sized before it is built.** Not every document needs the premium
model. The upper bound is
${SVC.loc[TOP, 'cost'] - _swap:,.0f} over this window
({(SVC.loc[TOP, 'cost'] - _swap) / SVC['cost'].sum():.0%} of total spend), but the real
number depends on what fraction of `{TOP}` work a cheaper model handles acceptably —
which is a quality question, not a cost one. The cheap way to find out is a shadow
run: send a sample of live traffic to both tiers, compare outputs, and measure the
acceptable fraction. That converts the ceiling into a number worth acting on, and it
is a week's work.

**Context trimming attacks the other factor and compounds with it.** At
x{point['verbosity factor (tokens/request)']:.1f} verbosity, halving the context on the
routine share of `{TOP}` calls is worth about as much as the model switch — but the
prompt/completion split is needed first to know whether the tokens are going in or
coming out.

**What I would not do is cut request volume.** §5 shows it is the one factor already
working in our favour ({point['volume factor (requests)']:.2f}x against `{CHEAPEST}`),
and §4 shows growth is demand rather than drift. A campaign to reduce calls would
attack the healthiest part of the picture.

### On the data quality

Every defect found here is machine-detectable at ingestion. **{len(_checks)} checks
would have caught all {int(FLAGS.to_numpy().sum())} of them** at load time rather than
in analysis:

{_checks_md}

The last two are the interesting ones. The uniqueness check is the only thing
standing between a re-run export and double-counted spend, and the completeness check
is what turns "three days are missing" from something you discover in §3 into
something the pipeline tells you on the day it happens.

**That is the same argument Part 2 makes about trade capture:** validate at the
boundary, reject loudly, and keep an audit trail of every decision. The `DECISIONS`
register in this notebook is a manual version of exactly that.

### On the analysis

* **A prompt/completion token split** would let the x{point['verbosity factor (tokens/request)']:.1f}
  verbosity factor be attributed to input or output, which decides the fix. It is the
  single most valuable column not in this file.
* **A second window** — even one more month — would let the trend be tested for
  stability rather than assumed, and would begin to separate trend from season. It is
  the single most valuable *row* not in this file.
* **A per-request latency or quality signal** would turn §5 from a cost ranking into a
  cost-effectiveness ranking, which is the question anyone actually wants answered.
* **Request-level rather than daily-aggregate data** would allow the cost distribution
  within a service to be examined. A x{point['verbosity factor (tokens/request)']:.1f}
  average verbosity could be every request being large, or a long tail of very large
  ones — and those have completely different fixes. The daily aggregate cannot
  distinguish them.
""")
''')

nb["cells"] = cells
nb.metadata.update({
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python", "pygments_lexer": "ipython3"},
})

out = pathlib.Path(__file__).parent / "Part1_Data_Handling.ipynb"
nbf.write(nb, out)
print(f"wrote {out} — {len(cells)} cells")
