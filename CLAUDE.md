# CLAUDE.md

AlphaEngine — a FastAPI risk gateway, a Next.js desk workspace, and a stateless
research service, sharing one append-only audit log. British spelling
throughout, in prose and in identifiers.

`SETUP.md` is the running instructions. This file is the things an agent
otherwise gets wrong.

## Four facts that cost an hour each

**1. The virtualenv must be named `venv`, at `Part2_Infrastructure/venv`.**
`web/package.json`'s `dev:gateway` runs `cd .. && ./venv/bin/python`, and
`web/scripts/start-dev-all.mjs` spawns `resolve(rootDir, "venv/bin/python")`
with no existence check and no `error` handler on the child process. A `.venv`,
a conda env or a uv env produces an unhandled `ENOENT` that looks nothing like
"wrong Python path". Never rename it, never add a second one.

**2. The web app has no `lint` script.** `web/package.json` has exactly `dev`,
`dev:gateway`, `dev:all`, `prebuild`, `build`, `catalog:refresh`, `start`,
`typecheck`, `test`, `counts:refresh`. `npm run lint` there fails as a missing
script — it is not a broken linter. Linting is Python-side: `ruff check .` from
`Part2_Infrastructure`, configured in `pyproject.toml`, installed only by
`requirements-dev.txt`.

**3. The venv must be Python 3.12, and a newer one silently loses a test.**
CI pins 3.12 — the only version the gateway (3.11–3.14) and the OpenBB service
(`>=3.12,<3.15`) both accept. A 3.14 venv looks fine, one test lighter: the
extra skip is `tests/test_backtester.py`, "vectorbt not installed", because
numba has no 3.14 wheel — so the vectorbt engine goes untested and the summary
line still reads green.

**Count the skips, not the passes.** On 3.12 it is **1,717 passed and exactly
one skipped** (run on 2026-08-22; `web/lib/test-counts.generated.ts` carries
the current figure). That one skip is expected and is *not* the vectorbt one —
it is `tests/test_data_ops_postgrest.py`, which reports honestly that no
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` was in the environment so the
Postgres backend never ran. On an environment without the optional
research extras (`requirements-rerank.txt`, `requirements-genai.txt`,
`requirements-graph.txt` — CI is one), their guarded suites add skips that each
NAME the missing package; those are designed. The wrong-Python signal is
specifically the vectorbt skip from `tests/test_backtester.py` appearing. Build it with `python3.12 -m venv venv` explicitly; the
default `python3` on a current macOS/Homebrew is 3.14. Two more things the
1,717 needs:
`requirements-native.txt` and a built native decision core
(`python native/decision_core/setup.py build_ext --inplace --build-temp
build/native`) — `tests/test_decision_core_native.py` and
`tests/test_core_self_measure.py` *fail*, not skip, when `modules/_decision_core`
is missing, unless `DECISION_CORE=python` was set on purpose.

**4. `npm run build` runs two gates before Next.js starts.** The `prebuild`
hook is `scripts/check-gateway-openapi-digest.mjs && scripts/generate-codebase-manifest.mjs --check`.
The first canonicalises `tools/openapi.json`, SHA-256s it, and compares against
the digest committed in `lib/gateway-openapi-digest.generated.ts`. A mismatch
exits 1 with `Gateway OpenAPI digest is stale`. That is the contract between two
separately deployed units asserting itself, not a build failure. If you changed
a gateway route, regenerate the snapshot (`python tools/export_openapi.py`) and
update the digest module deliberately. The second refuses to build if the
committed repository manifest (`lib/repository-manifest.generated.json`) no longer
matches the tree — `npm run catalog:refresh` regenerates it, and CI's
"Committed test counts match the suite" step (`scripts/check-test-counts.mjs`) checks
`lib/test-counts.generated.ts` against the run it just made (`npm run counts:refresh` regenerates it).

## House rules

These are enforced by tests, not by convention — `web/tests/house-rules.test.ts`,
`motion.test.ts`, `forced-colors.test.ts`, `type-scale.test.ts`,
`accent-budget.test.ts`, `null-honesty.test.ts`, `live-motion.test.ts`,
`interaction.test.ts`, `dead-css.test.ts`, `header-ladder.test.ts`,
`decision-latency.test.ts`, `middle-dot.test.ts`. Breaking one turns the suite red.

- **No new npm dependencies.** The workspace ships on Next, React,
  `lucide-react`, `@supabase/supabase-js` and `oracledb`. Everything else is
  written here. Reach for a package and you are changing the argument the
  project makes about itself.
- **No emoji in UI.** Not in components, not in `app/`. The status vocabulary is
  typographic marks — `● ▲ ✕ ○ ◌ ✓ ✗ →` — which inherit the text colour and
  render in the app's own font. Coloured geometric shapes (🟢🔴🟡) count as emoji
  and are banned for exactly the reason they are tempting: they encode state in
  a vendor's picture.
- **No colour-only meaning.** Anything a colour says, a mark, a label or a
  border must also say. `forced-colors.test.ts` holds the line for Windows High
  Contrast.
- **Null is never coerced to zero.** A missing measurement renders as a dash and
  says why it is missing. `?? 0` on a nullable metric is the defect this
  codebase is most alert to: it turns "we do not know" into "it is fine", and it
  passes every type check on the way through.
- **`prefers-reduced-motion` is respected everywhere.** One reduce block, one
  motion ladder in `:root`, no hardcoded transition durations, and components
  that animate in JS (`NumberTicker`) check the query themselves.
- **Empty results are reported, not hidden.** A panel with nothing to show says
  so; it does not render as though it were still loading.
- **Type reads the ladder, never a literal.** Sizes are the `--fs-*` rungs in
  `globals.css` (rem × `--type-step`, fluid), reached from components as
  `text-fs-*` utilities or `var(--fs-*)`; the header uses the fixed
  `--fs-chrome-*` tokens and its priority ladder is re-measured with
  `web/scripts/header-ladder-measure.mjs` whenever they change.
- **The middle dot is not a word.** Never on a heading, kicker, `<summary>`,
  label, section note, button, pill or aria-label; notes and captions are prose
  (comma list for peer facts, semicolon for a qualifier, words for a two-part
  label — "23 of 25 left today", not "23 · day"). It survives only between
  same-kind measurements in tabular mono type, and only through `metricRow` in
  `web/lib/format.ts`; `middle-dot.test.ts` holds the raw-literal count at zero.

## Layout

```
Part2_Infrastructure/
  main.py, config.py, modules/   FastAPI risk gateway (port 8000)
  native/decision_core/          the C++ (pybind11) decision core; built into
                                 modules/_decision_core*.so, DECISION_CORE=auto|native|python
  tools/                         fixture generators, OpenAPI export, probes, bench_decision.py
  tests/                         gateway pytest suite
  web/                           Next.js desk workspace (port 3000)
  OpenBB_Service/                stateless research service, own pyproject
  developer-console/             separate Cloudflare/vinext app, needs Node >=22.13
oracle/, supabase/               schema DDL for the optional backends
docs/                            feature tour, runbook, latency budget
```

## Working here

- Node 22 (`.nvmrc`), Python 3.12 for anything that must match CI. npm, not
  yarn or pnpm — `package-lock.json` and `npm ci` are what CI uses.
- Run the full check before claiming something works:
  `venv/bin/python -m pytest`, `npm test`, `npm run typecheck`,
  `venv/bin/python -m ruff check .`. `/verify` does all of it and reports real
  numbers.
- Never quote a test count from memory or from a README. Run the suite and read
  the number off the output. The counts in prose here have drifted before.
- The gateway's maths exists twice — Python for the server and the Telegram
  companion, TypeScript for the browser, because neither runtime can call the
  other. Python is the reference. Change a formula on one side and the parity
  fixtures make the other side fail; that is the design, so regenerate the
  fixture deliberately rather than loosening the tolerance.
- The pre-trade arithmetic exists a third time, in C++
  (`native/decision_core/decision_core.cpp`), and there the standard is
  bit-exact, not tolerance: `tests/test_decision_core_native.py` and
  `tests/test_gate_parity.py` pin both engines to the same twenty-scenario
  fixture (`web/tests/fixtures/gate-parity.json`). Python remains the reference.
- Three latency planes, never blended: the whole decision in µs
  (`RiskDecision.latency_ms`, the µs histogram), the compiled core in ns
  (timed inside the engine; the gateway self-measures it at startup so the
  figure exists before the first order), and the network to the venue in ms.
  A doc or a tile that puts a ns figure under a µs label is the defect.
- Telegram §6 of `Part2_Infrastructure/README.md` is generated:
  `venv/bin/python tools/telegram_catalogue.py --write` from
  `Part2_Infrastructure`, then `--check`. Never edit the tables by hand.
