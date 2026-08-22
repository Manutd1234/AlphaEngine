# CLAUDE.md

AlphaEngine — a FastAPI risk gateway, a Next.js desk workspace, and a stateless
research service, sharing one append-only audit log. British spelling
throughout, in prose and in identifiers.

`SETUP.md` is the running instructions. This file is the things an agent
otherwise gets wrong.

## Six facts that cost an hour each

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

**Count the skips, not the passes — and know which of the two runs you are
reading.** This section is the authoritative arithmetic; `README.md` and
`SETUP.md` quote the headline and link back here. There are two green gateway
numbers and both are correct, because two files in the suite are opt-ins that
skip with a named reason rather than pretending they ran. Re-measured
2026-08-22 on this tree, after the research plane's five stages, the vision
arm and the image-retrieval arm landed:

| Run | Passed | Skipped |
|---|---|---|
| CI, and any fresh 3.12 venv with no `.env` | 2,091 | 2 |
| With re-ranker weights seeded | 2,099 | 1 |

The eight-pass gap is not tests appearing from nowhere. It is the arithmetic of
a MODULE-level skip:

1. `tests/test_data_ops_postgrest.py` — a `@pytest.mark.skipif` on one test, so
   it is collected either way and reported as a skip when there is no
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. The Postgres backend never ran.
2. `tests/test_research_rerank_real.py` — `pytest.skip(..., allow_module_level=True)`,
   so when `RERANK_TEST_MODEL_PATH` is unset its **eight** tests are never
   collected at all and the file contributes exactly one skip. Seed the weights
   (`python tools/bench_rerank.py --seed --model-path DIR`, ~1.05 GiB) and give
   the variable to the run, and you gain 8 passes and lose 1 skip:
   2,091 + 8 = 2,099, 2 − 1 = 1. CI's opt-in `rerank-real` job does exactly that
   in a setup step, and it runs on `workflow_dispatch` or a `rerank` label, not
   on every push.

**A `.env` in `Part2_Infrastructure/` flips that opt-in silently, and this is
the reason two people re-measure the same tree and print different numbers.**
`tests/conftest.py` blanks `GEMINI_API_KEY` and `RERANK_MODEL_PATH` by
ASSIGNMENT and defaults `SUPABASE_*` / `NEO4J_*` with `setdefault` — but it does
not touch `RERANK_TEST_MODEL_PATH` at all, deliberately, because that variable
IS the opt-in. `config.py` calls `env_coerce.load_dotenv_if_present()` at
import, which hands `Part2_Infrastructure/.env` to python-dotenv without
`override`, filling any variable not already set — so a developer whose `.env`
carries
`RERANK_TEST_MODEL_PATH=/path/to/weights` gets the 2,099 / 1 shape with nothing
exported and no flag passed. Measured today: this machine's `.env` line 41 is
what produced it. Before reporting a gateway count, check whether that file
names the variable — `grep RERANK_TEST_MODEL_PATH Part2_Infrastructure/.env` —
or force the CI shape with `RERANK_TEST_MODEL_PATH= venv/bin/python -m pytest`,
which is one variable on one command line and therefore still obeys fact 5.

Both opt-ins are verified rather than theoretical, not merely designed. With
real Supabase credentials, all 11 tests in `tests/test_data_ops_postgrest.py`
run green — ten of them already do without credentials, and the eleventh,
`TestAgainstTheRealProject`, is the one the skip names. With seeded weights,
`tests/test_research_rerank_real.py` runs its 8 green, offline, against the
local ONNX directory.

`web/lib/test-counts.generated.ts` is the desk's copy of all three figures, and
**as this is written it is BEHIND the tree and has to be refreshed before the
next push.** It reads gateway 2,037 / 2,036 / 1 and web 4,008 across 871 suites;
the tree today prints gateway 2,099 / 1 seeded and web **4,124 tests across 899
suites** (4,122 passed, 2 skipped, measured 2026-08-22), because the work that
landed this week added test files faster than anyone re-ran
`npm run counts:refresh`. That is not cosmetic: CI's web job runs
`node scripts/check-test-counts.mjs web <log>` immediately after `npm test` and
fails the push on the mismatch. Two other generated artefacts are in the same
state — see fact 4.

Read one thing off that file carefully even when it is fresh: CI checks only its
WEB figure — `.github/workflows/ci.yml` runs `check-test-counts.mjs web <log>`
and nothing else — so the gateway line in it is a dated record, not a gated one,
and it can legitimately differ from what CI prints. The service line is 14
(measured today: 14 passed).

If you are reading a second skip as the wrong-Python alarm, that heuristic
moved: the wrong-Python signal is specifically the vectorbt skip from
`tests/test_backtester.py` appearing, whatever the total — read the skip
REASONS (`pytest -rs`), never the count alone.

Three optional research extras
(`requirements-rerank.txt`, `requirements-genai.txt`, `requirements-graph.txt`)
add NO skips beyond the one above — their suites install fakes at the seam
(`research_rerank._import_cross_encoder`, `research_generate._sdk`) and run
without the package. A fourth one does not, and it is the one people forget:
**`requirements-communities.txt` (networkx, scipy)**. Four suites carry a
`networkx_required = pytest.mark.skipif(find_spec("networkx") is None, ...)`
and 45 test functions sit behind it — `test_research_communities.py` (19),
`test_research_community_projection.py` (11), `test_research_graph_reads.py`
(9), `test_research_graph_read_model.py` (6), counted off the decorators
2026-08-22. Louvain and PageRank run in process over the edge list, so there is
no fake to install; the alternative was a stub that would have proved nothing
about the partition. scikit-learn (`requirements-ml.txt`: five adapter tests)
and vectorbt (the backtester's parity test) skip the same way; measured
2026-08-22, a venv built from `requirements-dev.txt` WITHOUT the last two read 7
skipped. Both are now in `requirements-dev.txt`, so CI and a 3.12 venv built
from it print the same line. Build it with `python3.12 -m venv venv`
explicitly; the default `python3` on a current macOS/Homebrew is 3.14. Two more
things the 2,091 needs: `requirements-native.txt` and a built native decision
core (`python native/decision_core/setup.py build_ext --inplace --build-temp
build/native`) — `tests/test_decision_core_native.py` and
`tests/test_core_self_measure.py` *fail*, not skip, when `modules/_decision_core`
is missing, unless `DECISION_CORE=python` was set on purpose.

**4. `npm run build` runs two gates before Next.js starts.** The `prebuild`
hook is `node scripts/check-gateway-openapi-digest.mjs && node scripts/generate-codebase-manifest.mjs --check`.
The first canonicalises `tools/openapi.json`, SHA-256s it, and compares against
the digest committed in `lib/gateway-openapi-digest.generated.ts`. A mismatch
exits 1 with `Gateway OpenAPI digest is stale`. That is the contract between two
separately deployed units asserting itself, not a build failure. If you changed
a gateway route, regenerate the snapshot (`python tools/export_openapi.py`) and
update the digest module deliberately. The second refuses to build if the
committed repository manifest (`lib/repository-manifest.generated.json`) no longer
matches the tree — `npm run catalog:refresh` regenerates it. Separately, CI's
"Committed test counts match the suite" step runs
`node scripts/check-test-counts.mjs web <log>` — note the `web`: it checks ONLY
the web line of `lib/test-counts.generated.ts` against the run it just made. The
gateway and service lines in that file are regenerated by
`npm run counts:refresh` and gated by nothing.

**Two of the four generated artefacts are owed a refresh on this tree right
now, and both of those are gates.** Measured 2026-08-22 by running the checkers
themselves rather than by reading them:

| Artefact | State | Regenerator |
|---|---|---|
| `web/lib/repository-manifest.generated.json` | STALE — `generate-codebase-manifest.mjs --check` reports 32 added, 0 removed, so `npm run build` stops in `prebuild` | `npm run catalog:refresh` |
| `web/lib/test-counts.generated.ts` | STALE — carries web 4,008 across 871 suites against a suite that now prints 4,124 across 899, so CI's count step fails the push | `npm run counts:refresh` |
| `supabase/apply_all.generated.sql` | regenerated today, and it is green now; it had been missing `20260822110000_research_chart_images.sql`, which failed two tests in `tests/test_migration_bundle.py` | `python3 tools/bundle_migrations.py`, repo root |
| `web/lib/gateway-openapi-digest.generated.ts` | current — the checker verified `9409bdda…` against `tools/openapi.json` today | `python tools/export_openapi.py` |

None of that is a code defect; it is the cost of a week in which the tree grew
faster than the indexes that describe it. Run the two refreshes before the next
push, and never hand-edit any of the four to make a checker quiet.

**5. Never source `.env` into the shell before running the suite.**
`set -a && . ./.env` is the reflex and it costs an afternoon. That file carries
`REQUIRE_AUTH=1`, and `tests/conftest.py` sets its defence with
`os.environ.setdefault("REQUIRE_AUTH", "0")` — `setdefault` beats a `.env` file
and loses to an **exported** variable, so around 80 route tests then fail with
401 and none of them says why. The credentials in `.env` are real
(`SUPABASE_*`, `NEO4J_*`, `GEMINI_API_KEY`, `RERANK_MODEL_PATH`), so pass ONE
variable per run instead:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... venv/bin/python -m pytest tests/test_data_ops_postgrest.py
```

Two lines in that conftest are ASSIGNED rather than defaulted, for the same
reason in reverse, and must not be weakened: `os.environ["GEMINI_API_KEY"] = ""`
and `os.environ["RERANK_MODEL_PATH"] = ""`. Assignment is what stops an exported
key on a developer's machine from spending live quota, or from loading ~110M
parameters into an unrelated suite. `RESEARCH_IMAGE_MODEL_PATH` is NOT blanked
there yet — the CLIP arm's own suite blanks it in an autouse fixture instead,
which is a hole conftest should close.

**6. The web suite has no browser, no DOM and no layout engine, so no test in
it has ever seen a pixel.** `npm test` is `node --import tsx --test tests/*.test.ts`
— plain Node, no jsdom, no Playwright, no Puppeteer, and none of those may be
added (see the no-new-dependencies rule below). Of the 279 suites, 135 read
component source with `readFileSync` and assert against the text; the rest
import modules and assert on their values. Nothing calls `render()`; nothing
imports `react-dom/server`.

What follows from that is the thing to hold on to: **every geometric claim in
this repository is derived, not observed.** An SVG's viewBox, a grid's row
arithmetic, "the labels sit inside their boxes", "the eight-column matrix
scrolls inside its own `.table-wrap` rather than pushing the page sideways" —
each of those is checked by reading numbers out of the source and doing the sum,
which catches a wrong number and cannot catch a layout that is legal and ugly.
Three surfaces that landed on 2026-08-22 are in exactly that state and their
authors said so: the Reliability blast-radius map (560×266, seven store boxes at
a 6px vertical gap), the Numerics custody chain in Developer → API & Schema
(where 64 hex characters wrap is argued from a ch-derived width), and the
Developer topology card, whose alignment rests on `grid-template-rows: subgrid`
in `app/globals/14i-density-developer.css` — supported in Chrome/Edge 117+,
Safari 16+, Firefox 71+, and where it is not, the declaration is dropped and the
card degrades to the plain five-row auto grid it used to be, which is the old
layout rather than a broken one.

So: do not write "verified in the browser" when what happened was a test pass,
and if you have a viewport in front of you, the three surfaces above are the
ones worth a look. The browser-level check that does exist is
`web/scripts/desk-sweep.mjs`, which drives all 47 rail sections over Chrome
DevTools Protocol under six fault profiles — a real harness with real
prerequisites (a dev server on port 3100, a headless Chrome on 9222), not part
of any suite and not run by CI.

## House rules

These are enforced by tests, not by convention — `web/tests/house-rules.test.ts`,
`motion.test.ts`, `forced-colors.test.ts`, `type-scale.test.ts`,
`accent-budget.test.ts`, `null-honesty.test.ts`, `live-motion.test.ts`,
`interaction.test.ts`, `dead-css.test.ts`, `header-ladder.test.ts`,
`decision-latency.test.ts`, `middle-dot.test.ts`, `file-size.test.ts`. Breaking
one turns the suite red.

Sixteen more are per-tab copy guards — `summarised-<tab>.test.ts` and
`disclosure-<tab>.test.ts`, one pair for each of the eight tabs. They pin
rendered sentences byte for byte, both that the new wording is present and that
the old wording is gone, because a fluent rewrite can drop a number, a negation
or the reason a measurement is missing while every line still looks present in
the diff. You may ADD an assertion to one; never weaken one to let a change
through.

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
- **400 lines is the file ceiling, on both sides, and the ratchet only turns one
  way.** Two tests of the same shape: `web/tests/file-size.test.ts` over the
  web's `app/`, `components/`, `lib/`, `scripts/`, `tests/` for
  `.ts`/`.tsx`/`.mjs`/`.css` (skipping `*.generated.*`), and
  `tests/test_file_size.py` over the gateway's `modules/`, `tools/`, `tests/`
  plus `main.py`, `config.py`, `celery_tasks.py`, `worker.py`. Both measure
  `len(text.split("\n"))`, both carry an `OVER_CEILING` allow-list, and both
  enforce the same three rules: a file not on the list may not cross 400, a
  file on it may not get longer, and an entry that has dropped under the ceiling
  must be REMOVED from the list — that is how the list empties. Split rather than
  trim, and when a split is blocked because another suite pins the path, say so
  instead of shaving prose to buy a line. `config.py` is the documented
  un-splittable file (407, one flat `Settings` dataclass read as `settings.x`
  across the tree), so a new gateway tunable goes in its own module reading
  `os.environ`, with the reason written beside it. `modules/research_quota.py`
  is the worked example to copy: the rate and spend bound on
  `/api/research/rag/ask` reads `RESEARCH_ASK_RATE_PER_S`, `RESEARCH_ASK_BURST`,
  `RESEARCH_ASK_SPEND_WINDOW_S`, `RESEARCH_ASK_SPEND_CEILING_USD` and two
  price-per-Mtok knobs at import, and `modules/research_quota_scope.py` does the
  same for `RESEARCH_SCOPE_TO_DESK`. Not one of them is a `Settings` field.
- **The middle dot is not a word.** Never on a heading, kicker, `<summary>`,
  label, section note, button, pill or aria-label; notes and captions are prose
  (comma list for peer facts, semicolon for a qualifier, words for a two-part
  label — "23 of 25 left today", not "23 · day"). It survives only between
  same-kind measurements in tabular mono type, and only through `metricRow` in
  `web/lib/format.ts`; `middle-dot.test.ts` holds the raw-literal count at zero.

## Layout

```
Part2_Infrastructure/
  main.py, config.py, modules/   FastAPI risk gateway (port 8000). The gate
                                 battery is modules/risk_proxy/ — a PACKAGE, not
                                 risk_proxy.py; gates.py declares GATE_ORDER and
                                 decision.py evaluates it. The audit log is
                                 modules/audit/, likewise a package. Routes are
                                 eight routers under modules/api/, not main.py.
  native/decision_core/          the C++ (pybind11) decision core; built into
                                 modules/_decision_core*.so, DECISION_CORE=auto|native|python
  tools/                         fixture generators, OpenAPI export, probes,
                                 bench_decision.py, bench_rerank.py,
                                 bench_image_retrieval.py
  tests/                         gateway pytest suite (130 files)
  web/                           Next.js desk workspace (port 3000), 279 test files
  OpenBB_Service/                stateless research service, own pyproject
  developer-console/             separate Cloudflare/vinext app, needs Node >=22.13
oracle/, supabase/               schema DDL for the optional backends; 35
                                 migrations, bundled into
                                 supabase/apply_all.generated.sql
tools/bundle_migrations.py       regenerates that bundle — repo root, not
                                 Part2_Infrastructure/tools/
docs/                            architecture · engineering · planning ·
                                 product · testing · whitepaper (see below)
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
  `Part2_Infrastructure`, then `--check`. Never edit the tables by hand. It is
  the only authority on the command count — **135 commands**, 6 of them gated
  controls, 99 pushed to Telegram's `/` menu (the API caps that list at 100).
- Section ids in `web/lib/sections.ts` are public deep links and never change;
  the PANE ids inside a section are component state and are not addressable.
  Renaming a pane breaks no URL, and the hash whitelist and "Copy link to this
  view" never see one — but prose in other tabs can still point at one. Five
  such pointers exist today, all reading "Enter the operator token in
  Reliability → Remediation" (`components/systems/FailoverGraph.tsx`, two in
  `components/data/ReplayBackfillPanel.tsx` plus its aria text, and
  `components/data/DataQualityLedger.tsx`). Remediation now opens on five panes
  — `mutations`, `scope`, `session`, `recovery`, `history` — and those five
  sentences are accurate only because `mutations` is the default landing pane
  and holds the token field. Move the default and they all need "→ Mutations".
- Never hand-edit a `*.generated.*` file, `tools/openapi.json`, or
  `supabase/apply_all.generated.sql`. Each has a regenerator:
  `npm run counts:refresh`, `npm run catalog:refresh`,
  `python tools/export_openapi.py`, `python3 tools/bundle_migrations.py` (repo
  root). `tests/test_migration_bundle.py` fails when the bundle is behind
  `supabase/migrations/`, and the fix is to regenerate, never to edit the SQL.
- The institutional whitepaper is Typst source at `docs/whitepaper/` — six
  chapter files under `sections/`, one shell (`main.typ`) and one
  `template.typ`. Compile it with
  `typst compile docs/whitepaper/main.typ out.pdf`; measured 2026-08-22 it
  builds clean to **83 A4 pages**. NOT BUILT: no PDF is committed, `typst` is in
  no requirements file, and no CI job compiles it — so a broken chapter is
  caught by whoever next runs the command, not by a gate. One Typst trap worth
  knowing before editing a chapter: `#include` evaluates a file in its own
  scope, so `main.typ`'s `#import "template.typ": *` does NOT reach section
  files. Every chapter that uses `#measured`, `#illustrative` or `#note` carries
  its own `#import "../template.typ": ...` line, and omitting it fails with
  "unknown variable".
