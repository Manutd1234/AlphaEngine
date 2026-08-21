"""Research parameters and fitted models — the sweep grid, the friction model, one run's capsule."""

from __future__ import annotations

from typing import Any

from config import settings
from modules.telegram.format import _finite, _number, esc, text_card
from modules.telegram.keyboards import _choice_row, cb, kb
from modules.telegram_charts import generate_scatter_png, generate_status_grid_png

#: Characters of a digest a reader can compare at a glance — the width the
#: desk's own capsule uses, so one hash reads identically in both.
_DIGEST = 12

# The reasons a capsule field is withheld. One wording per cause: two
# explanations of the same null is how a desk ends up with two stories about one
# missing measurement.
_NO_SEED = "The corpus returned no seed, which its own schema forbids. Treat this run as irreproducible."
_NO_SHA = "Fitted by a build with no git tree, so the code cannot be named. The dataset hash still pins the bars."
_NO_HASH = "The corpus filed no dataset hash, so this run cannot be shown to have seen the same bars as any other."
_NO_FEATURES = ("The feature spec hash lives on the run detail record, <code>GET /api/research/ml/runs/{run_id}</code>."
                " Two runs are comparable only once their spec hashes are.")
_NO_PURGE = ("Purge and embargo sit per fold on the run detail record. An out-of-sample Sharpe from an unpurged fold "
             "is not out of sample — it is the number a leak produces, and it looks exactly as good.")
_NO_FEATURE_RECORD = ("the run detail was read and carries no feature record, so this run cannot be compared to "
                      "another by feature set.")
_NO_FOLD_RECORD = ("the run detail was read and carries no folds, so no purge or embargo was recorded. That is a run "
                   "with no fold evidence, not a run that purged nothing.")
_PBO_UNSTATED = ("No PBO is filed, and the corpus records the null without its cause. PBO ranks a selected "
                 "configuration against the alternatives it was selected from, so either this run fitted one, or too "
                 "few folds ranked to compute it.")
_GAPS_MEANING = ("Bars dropped from the end of each training window because their labels reach into the test window "
                 "(purge), and from the start of the next (embargo). A range means the folds disagreed. Zero is a "
                 "claim, not an absence.")
_ENGINE_MEANING = {
    "numpy": ("the hand-rolled engine, used when the scikit-learn extra was absent — a different run from an sklearn "
              "one, so do not rank them together"),
    "sklearn": "the scikit-learn extra fitted this run",
}

#: Every field a capsule carries, named so an unread corpus reports each one by
#: name instead of quietly shrinking to a shorter card.
_CAPSULE_FIELDS = ("seed", "build sha", "engine", "dataset hash", "feature spec hash", "purge bars",
                   "embargo bars", "OOS Sharpe", "deflated Sharpe", "PBO")

#: The four microstructure knobs the setup panel offers, with its own bounds.
#: This gateway has no field for any, hence absent rather than zero.
_FRICTIONS = (("Impact k", "0", "0 – 1"), ("Order size", "0", "0 – 1e10 USD"),
              ("Funding bps/8h", "0", "-50 – +50"), ("Borrow bps/yr", "0", "0 – 5000"))


def _bounds(field: dict[str, Any]) -> str:
    """The schema's own published range for one tunable, or a dash when it has none."""
    low, high = field.get("minimum"), field.get("maximum")
    return "—" if low is None or high is None else f"{low:g}–{high:g}"


def _gaps(values: list[int]) -> str:
    """`12` when every fold agreed, `12–20` when they did not."""
    low, high = min(values), max(values)
    return str(low) if low == high else f"{low}–{high}"


def _figure(value: Any, places: int = 2) -> str:
    """A measurement, or the words the corpus stores for its absence — never an
    em dash, because a missing figure is not a small one."""
    rendered = _number(value, places)
    return f"<code>{rendered}</code>" if rendered != "—" else "<i>not computed</i>"


# --- Research parameters: the grid this gateway would walk ------------------ #
def _setup_lines(request: Any, schema: dict[str, Any]) -> list[str]:
    """Instrument, window and fold layout, read off the request schema itself."""
    return [
        "<b>Experiment</b>",
        f"Instrument   <code>{esc(request.symbol)}</code> at <code>{esc(request.interval)}</code> · <code>{esc(request.direction)}</code>",
        f"History      <code>{request.bars:,}</code> bars (schema {_bounds(schema['bars'])}) — fewer than ~500 makes walk-forward folds too short to read.",
        f"Walk-forward <code>{'on' if request.walk_forward else 'off'}</code> · <code>{request.folds}</code> folds ({_bounds(schema['folds'])})",
        f"Embargo      <code>{request.embargo_bars}</code> bars ({_bounds(schema['embargo_bars'])}) — bars discarded between each training window and its test window.",
        "<i>An embargo of 0 is a claim that the folds are adjacent, not a missing setting.</i>",
        "",
    ]


def _axis_line(low: Any, high: Any, step: Any, free: Any, bounds: str) -> str:
    """One axis, said in the units it is actually swept in."""
    if free is not None:
        return f"registry axis <code>{free[0]:g} → {free[1]:g}</code> step <code>{free[2]:g}</code>"
    return f"<code>{low} → {high}</code> step <code>{step}</code> (bounds {bounds})"


def _grid_lines(request: Any, schema: dict[str, Any], fasts: list[Any], slows: list[Any],
                combos: list[tuple[float, float]], free_fast: Any, free_slow: Any) -> list[str]:
    """The two axes, the pair count, and which rule removed the difference."""
    pairs = len(fasts) * len(slows)
    lines = [
        "<b>Parameter sweep</b>",
        f"First axis   {_axis_line(request.fast_min, request.fast_max, request.fast_step, free_fast, _bounds(schema['fast_min']))} · <code>{len(fasts)}</code> values",
        f"Second axis  {_axis_line(request.slow_min, request.slow_max, request.slow_step, free_slow, _bounds(schema['slow_min']))} · <code>{len(slows)}</code> values",
        f"Grid         <code>{pairs}</code> pairs on the axes → <code>{len(combos)}</code> tested",
    ]
    if len(combos) >= settings.backtest_max_combos:
        lines.append(f"<i>Thinned to the BACKTEST_MAX_COMBOS cap of {settings.backtest_max_combos}; the run files the "
                     "warning \"grid truncated to N combinations\" on its own result. A wider search also raises the "
                     "multiple-testing hurdle the deflated Sharpe pays.</i>")
    elif len(combos) < pairs:
        lines.append("<i>Pairs where fast ≥ slow are discarded: both axes are lookback periods, and a fast window "
                     "longer than the slow one is not a faster signal.</i>")
    if free_slow is not None:
        lines.append("<i>The slow_min/max/step fields are IGNORED for this strategy. Its second axis is a level in its "
                     "own units — a sigma multiple, an ATR multiple, an oscillator threshold, a residual-error "
                     "multiple — supplied by the sweep "
                     "registry, and the fast &lt; slow ordering does not apply because the two numbers are not "
                     "comparable quantities.</i>")
    if free_fast is not None:
        lines.append("<i>The fast_min/max/step fields are ignored too: this strategy's first axis is a training window "
                     "the registry sets, because a 5-bar window cannot fit a four-coefficient regression.</i>")
    return [*lines, ""]


def _cost_lines(request: Any, schema: dict[str, Any]) -> list[str]:
    """What the reference engine charges, and the one warning the schema carries."""
    return [
        "<b>Costs this gateway charges</b>",
        f"Fee          <code>{request.fee_bps:.2f}</code> bps per side, on notional turnover ({_bounds(schema['fee_bps'])})",
        f"Slippage     <code>{request.slippage_bps:.2f}</code> bps per side ({_bounds(schema['slippage_bps'])})",
        "Charged as   <code>(fee + slippage) ÷ 1e4 × turnover</code>, on every bar the position changes.",
        "<i>Setting both cost fields to 0 produces a frictionless result that will not survive live.</i>",
        "",
    ]


def _friction_lines() -> list[str]:
    """The four knobs that exist in the setup panel and in no field of this schema."""
    lines = ["<b>Microstructure frictions — not modelled here</b>",
             "<i>At all zeros the run matches this gateway's reference engine exactly; any non-zero value makes it a "
             "model of your own assumptions.</i>"]
    lines += [f"{esc(label):<15}<code>—</code> · panel default <code>{esc(default)}</code> · range <code>{esc(span)}</code>"
              for label, default, span in _FRICTIONS]
    lines += [
        "<i>Those dashes are NOT zeros. This gateway's BacktestRequest carries no impact, funding or borrow field at "
        "all, so the value is an absent field rather than an unread measurement — flat bps only.</i>",
        "Square-root impact: <code>k·√(order ÷ ADV)</code>. Doubling size costs about 1.41×, not 2×; both k and order "
        "size must be non-zero for impact to apply.",
        "Funding is charged on absolute exposure every bar; borrow only on short exposure, so it is inert in a "
        "long-only run.",
    ]
    return lines


# --- Fitted models: the reproducibility capsule ----------------------------- #
def _withheld_evidence(reason: str) -> dict[str, Any]:
    """A detail record that could not be read, carrying why rather than blanks."""
    return {"reason": reason, "spec_hash": None, "feature_count": None, "label": None,
            "horizon": None, "folds": 0, "purge": [], "embargo": []}


def _read_evidence(detail: dict[str, Any]) -> dict[str, Any]:
    """The two evidence-bearing halves of a run detail: its features and its fold gaps."""
    features = detail.get("features") or {}
    folds = detail.get("folds") or []
    return {
        "reason": None,
        "spec_hash": features.get("spec_hash"),
        "feature_count": features.get("feature_count"),
        "label": features.get("label"),
        "horizon": features.get("label_horizon_bars"),
        "folds": len(folds),
        "purge": sorted({int(row["purge_bars"]) for row in folds if isinstance(row.get("purge_bars"), (int, float))}),
        "embargo": sorted({int(row["embargo_bars"]) for row in folds if isinstance(row.get("embargo_bars"), (int, float))}),
    }


def _identity_lines(run: dict[str, Any]) -> list[str]:
    """Model, bars, seed and build — four of the five things a re-run needs."""
    digest, seed, sha = str(run.get("data_hash") or ""), run.get("seed"), run.get("git_sha")
    engine = str(run.get("engine") or "")
    return [
        "<b>Reproducibility capsule</b> — a fitted model is its seed, its code and its bars.",
        f"Run          <code>{esc(str(run.get('id') or '')[:8] or '—')}</code> · <code>{esc(run.get('status') or 'unknown')}</code>",
        f"Model        <code>{esc(run.get('model') or '—')}</code>",
        f"Instrument   <code>{esc(run.get('symbol') or '—')}</code> at <code>{esc(run.get('interval') or '—')}</code>",
        (f"Dataset      <code>{esc(digest[:_DIGEST])}</code> — the exact bars the run saw, the same meaning as a "
         "sweep's dataset hash." if digest else f"Dataset      <code>—</code> · {_NO_HASH}"),
        f"Seed         <code>{esc(seed)}</code>" if seed is not None else f"Seed         <code>—</code> · {_NO_SEED}",
        f"Build        <code>{esc(str(sha)[:_DIGEST])}</code>" if sha else f"Build        <code>—</code> · {_NO_SHA}",
        (f"Engine       <code>{esc(engine or '—')}</code>"
         + (f" — {_ENGINE_MEANING[engine]}" if engine in _ENGINE_MEANING else "")),
    ]


def _evidence_lines(run: dict[str, Any], evidence: dict[str, Any]) -> list[str]:
    """Feature set, fold gaps and PBO — and, for each, the reason it is not there."""
    unread = evidence["reason"]
    withheld = f"<code>—</code> · {unread}. " if unread else "<code>—</code> · "
    if evidence["spec_hash"]:
        features = (f"<code>{esc(str(evidence['spec_hash'])[:_DIGEST])}</code> · <code>{esc(evidence['feature_count'])}"
                    f"</code> features · label <code>{esc(evidence['label'])}</code> over "
                    f"<code>{esc(evidence['horizon'])}</code> bars")
    else:
        features = withheld + (_NO_FEATURES if unread else _NO_FEATURE_RECORD)
    if evidence["purge"] and evidence["embargo"]:
        gaps = (f"<code>{_gaps(evidence['purge'])}</code> purged, <code>{_gaps(evidence['embargo'])}</code> embargoed "
                f"across <code>{evidence['folds']}</code> folds")
    else:
        gaps = withheld + (_NO_PURGE if unread else _NO_FOLD_RECORD)
    pbo = f"<code>{_number(run.get('pbo'))}</code>" if run.get("pbo") is not None else f"<code>—</code> · {_PBO_UNSTATED}"
    return [
        f"Features     {features}",
        f"Purge        {gaps}",
        f"PBO          {pbo}",
        f"OOS Sharpe   {_figure(run.get('oos_sharpe'))} · DSR {_figure(run.get('deflated_sharpe'))}",
        f"<i>{_GAPS_MEANING}</i>",
        "<i>Re-running this model takes the seed, build, engine and dataset hash above.</i>",
        "",
    ]


def _corpus_lines(runs: list[dict[str, Any]]) -> list[str]:
    """The three headline facts the panel leads with, and the null each one refuses."""
    succeeded = [row for row in runs if row.get("status") == "succeeded"]
    deflated = [value for value in (_finite(row.get("deflated_sharpe")) for row in succeeded) if value is not None]
    engines = sorted({str(row.get("engine") or "unknown") for row in succeeded}) or ["—"]
    best = (f"<code>{_number(max(deflated))}</code> — after paying for the search" if deflated
            else "<code>—</code> — no succeeded run scored one. Runs without the figure are dropped from the maximum, "
                 "and a maximum over nothing is dashed rather than reported as 0.00.")
    return [
        f"Runs read    <code>{len(runs)}</code> · <code>{len(succeeded)}</code> succeeded",
        f"Best DSR     {best}",
        f"Engines      <code>{esc(', '.join(engines))}</code> — a fallback run is a different run.",
        "",
    ]


def _run_rows(runs: list[dict[str, Any]]) -> list[str]:
    """The run table, newest first and bounded, with every figure's absence spelt out."""
    icons = {"succeeded": "✅", "failed": "❌", "running": "⚙️"}
    lines = [f"<b>Runs</b> · showing <code>{min(len(runs), 8)}</code> of <code>{len(runs)}</code>, newest first"]
    for row in runs[:8]:
        pbo = f"<code>{_number(row.get('pbo'))}</code>" if row.get("pbo") is not None else "<i>none filed</i>"
        lines.append(
            f"{icons.get(str(row.get('status')), '•')} <code>{esc(str(row.get('id') or '')[:8])}</code> "
            f"{esc(row.get('model') or '—')} · {esc(row.get('symbol') or '—')} {esc(row.get('interval') or '—')} · "
            f"{esc(row.get('engine') or '—')} · OOS {_figure(row.get('oos_sharpe'))} · "
            f"DSR {_figure(row.get('deflated_sharpe'))} · PBO {pbo} · "
            f"data <code>{esc(str(row.get('data_hash') or '')[:8] or '—')}</code>")
        if row.get("status") == "failed" and row.get("error"):
            lines.append(f"   <i>{esc(str(row['error'])[:160])}</i>")
    lines.append("<i>Every figure here is out of sample. Send /fitted ID for one run's capsule.</i>")
    return lines


def _capsule_grid(run: dict[str, Any], evidence: dict[str, Any]) -> list[tuple[str, str, str, str]]:
    """The capsule as a status board: one tile per field, filed or withheld."""
    def tile(plane: str, name: str, value: Any, absent: str) -> tuple[str, str, str, str]:
        return (plane, name, "ok", str(value)) if value else (plane, name, "unknown", absent)

    instrument = f"{run.get('symbol')} {run.get('interval')}" if run.get("symbol") else ""
    return [
        tile("Identity", "Model", run.get("model"), "not filed"),
        tile("Identity", "Bars", instrument, "not filed"),
        tile("Identity", "Dataset", str(run.get("data_hash") or "")[:_DIGEST], "no hash"),
        tile("Re-run", "Seed", "" if run.get("seed") is None else str(run.get("seed")), "not filed"),
        tile("Re-run", "Build", str(run.get("git_sha") or "")[:_DIGEST], "no git tree"),
        tile("Re-run", "Engine", run.get("engine"), "not filed"),
        tile("Evidence", "Features", str(evidence["spec_hash"] or "")[:_DIGEST], "on run detail"),
        tile("Evidence", "Purge", f"{_gaps(evidence['purge'])} bars" if evidence["purge"] else "", "on run detail"),
        tile("Evidence", "PBO", "" if run.get("pbo") is None else _number(run.get("pbo")), "none filed"),
    ]


def _pick_run(runs: list[dict[str, Any]], args: list[str]) -> tuple[dict[str, Any] | None, str | None]:
    """The run the capsule describes: an id or id prefix, else the newest."""
    if not args:
        return runs[0], None
    wanted = args[0].strip().lower()
    matches = [row for row in runs if str(row.get("id") or "").lower().startswith(wanted)]
    if len(matches) == 1:
        return matches[0], None
    if not matches:
        return None, f"No run among the <code>{len(runs)}</code> read starts with <code>{esc(wanted)}</code>."
    return None, f"<code>{esc(wanted)}</code> matches <code>{len(matches)}</code> runs — send more of the id."


def _unread_lines(reason: str, consequence: str) -> list[str]:
    """A corpus that answered nothing, with every withheld field named."""
    return [
        reason, consequence,
        f"Withheld, and none of them zero: <code>{esc(', '.join(_CAPSULE_FIELDS))}</code>.",
        "<i>Each is unread rather than absent — this card cannot tell a purge of 0 from a purge nobody recorded, and "
        "only one of those is safe.</i>",
    ]


class ResearchDetailMixin:
    async def _cmd_parameters(self, args, chat_id, actor) -> None:
        """The sweep grid this gateway would walk, and the frictions it does not charge."""
        from typing import get_args

        from modules.backtester.grid import _axis, param_grid
        from modules.backtester.indicators import FREE_FIRST_AXIS, FREE_SECOND_AXIS
        from modules.schemas import BacktestRequest

        field = BacktestRequest.model_fields["strategy"]
        known = [str(value) for value in get_args(field.annotation)]
        requested = args[0].lower() if args else str(field.default)
        if requested not in known:
            await self.send_message(chat_id, text_card(
                "🎛 Experiment setup", "UNKNOWN STRATEGY",
                [f"<code>{esc(requested)}</code> is not one of the {len(known)} the sweep schema accepts.",
                 "Send <code>/strategies</code> for the catalogue."],
                source="Backtest request schema", next_commands="/strategies · /parameters"))
            return

        request = BacktestRequest(strategy=requested)
        schema = BacktestRequest.model_json_schema()["properties"]
        free_fast, free_slow = FREE_FIRST_AXIS.get(requested), FREE_SECOND_AXIS.get(requested)
        # `_axis` is the grid module's own inclusive-range builder, imported rather than
        # recomputed so the axis shown and the axis swept cannot drift by a rounding rule.
        fasts = _axis(*free_fast) if free_fast is not None else _axis(request.fast_min, request.fast_max, request.fast_step)
        slows = _axis(*free_slow) if free_slow is not None else _axis(request.slow_min, request.slow_max, request.slow_step)
        combos = param_grid(request)
        lines = (_setup_lines(request, schema)
                 + _grid_lines(request, schema, fasts, slows, combos, free_fast, free_slow)
                 + _cost_lines(request, schema) + _friction_lines())
        chart = generate_scatter_png(
            f"{requested} · the {len(combos)} combinations this sweep would walk",
            [float(fast) for fast, _ in combos], [float(slow) for _, slow in combos], "First axis", "Second axis")
        if chart is None:
            lines.append("<i>No grid chart: fewer than five combinations survive, and five points is the floor below "
                         "which a scatter shows a shape the grid has not earned.</i>")
        choices = [(name, name) for name in ("ma_cross", "bollinger_breakout", "linreg_forecast") if name in known]
        footer = kb([_choice_row("parameters", choices, requested),
                     [("↻ Refresh", cb("parameters", requested)), ("⌂ Menu", cb("menu"))]])
        await self.send_media_group(chat_id, [("parameters", chart)] if chart else [], caption=text_card(
            f"🎛 Experiment setup · {esc(requested)}", f"{len(combos)} COMBOS", lines,
            source="Backtest request schema + sweep grid",
            next_commands="/stability BTCUSDT · /strategies · /fitted"), reply_markup=footer)

    async def _cmd_fitted(self, args, chat_id, actor) -> None:
        """One supervised run's reproducibility capsule: seed, code, bars, features, purge, PBO."""
        from modules.ml.store import UNREADABLE, get_ml_store

        footer = kb([[("↻ Refresh", cb("fitted")), ("⌂ Menu", cb("menu"))]])
        store = get_ml_store()
        if not store.enabled:
            await self.send_message(chat_id, text_card(
                "🧬 Fitted models", "NO CORPUS", _unread_lines(
                    "No research corpus is configured on this deployment, so supervised runs still execute and "
                    "nothing is filed.",
                    "Nothing was asked of the store, which is why the fields below are unread rather than empty."),
                source="ML run corpus", next_commands="/backtests · /overfit BTCUSDT"), reply_markup=footer)
            return
        runs = await store.list_runs(limit=25)
        if runs is None:
            await self.send_message(chat_id, text_card(
                "🧬 Fitted models", "UNREADABLE", _unread_lines(
                    "A configured research corpus could not be read — a rejected key, a missing table, a stale schema "
                    "cache.",
                    "This says nothing about the desk: not an empty corpus, and not a desk that has fitted nothing."),
                source="ML run corpus", next_commands="/backtests · /providers"), reply_markup=footer)
            return
        if not runs:
            await self.send_message(chat_id, text_card(
                "🧬 Fitted models", "EMPTY CORPUS",
                ["The corpus is reachable and holds no supervised runs yet.",
                 "<i>Read, empty and reported — not hidden, and not the same fact as a corpus that could not be "
                 "read.</i>"],
                source="ML run corpus", next_commands="/backtests · /overfit BTCUSDT"), reply_markup=footer)
            return

        chosen, complaint = _pick_run(runs, args)
        if chosen is None:
            await self.send_message(chat_id, text_card(
                "🧬 Fitted models", "NOT FOUND", [complaint or "", *_run_rows(runs)],
                source="ML run corpus", next_commands="/fitted · /backtests"), reply_markup=footer)
            return

        detail = await store.get_run(str(chosen.get("id") or ""))
        if detail is UNREADABLE:
            evidence = _withheld_evidence("the run detail read failed")
        elif detail is None:
            evidence = _withheld_evidence("the corpus has no detail record for this run")
        else:
            evidence = _read_evidence(detail)
        lines = _corpus_lines(runs) + _identity_lines(chosen) + _evidence_lines(chosen, evidence) + _run_rows(runs)
        chart = generate_status_grid_png(
            f"Capsule · run {str(chosen.get('id') or '')[:8]}", _capsule_grid(chosen, evidence))
        await self.send_media_group(chat_id, [("capsule", chart)] if chart else [], caption=text_card(
            "🧬 Fitted models", f"{len(runs)} RUN{'S' if len(runs) != 1 else ''}", lines,
            source="ML run corpus", next_commands="/parameters · /overfit BTCUSDT · /walkforward BTCUSDT"),
            reply_markup=footer)
