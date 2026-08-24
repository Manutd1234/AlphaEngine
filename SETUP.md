# Setup

Everything you need to get AlphaEngine running, in the order you need it.
`README.md` explains what it is and why; this file only gets it on screen.
Every command here was re-read against the tree on 2026-08-24, and the suite
counts are what the three runners printed that day. They are AHEAD of the
gateway line in `Part2_Infrastructure/web/lib/test-counts.generated.ts`, which
the desk displays and which `npm run counts:refresh` is owed to bring up to
date; `CLAUDE.md` holds the reconciliation and the list of what else needs
regenerating.

---

## The short version

**It runs with zero configuration.** No Python, no API keys, no database, no
`.env` file.

```bash
cd Part2_Infrastructure/web
npm install
npm run dev
```

Open **http://localhost:3000**. You land on a sign-in page that tells you
accounts are not configured in this deployment and offers one button — **Open
the workspace**. Click it and you are on the full **ten-tab** desk: Overview,
Research, Execution, Portfolio, Risk, Data, Reliability, Developer, Prices and
Proofs. The last two are the Kalshi engine; their URL ids are `#markets` and
`#coherence`, which is older than their labels and deliberately unchanged.

That is the whole first run. With ten minutes rather than two, the
[full local stack](#the-full-local-stack) adds the gateway and real data.

### Why it works with nothing set

Three mechanisms, each deliberate:

| Missing thing | What happens instead | Where |
|---|---|---|
| `ALPHAENGINE_GATEWAY_URL` | Falls back to `http://127.0.0.1:8000`, but **only** when `NODE_ENV=development`. In production an unset URL reports the gateway as absent rather than fetching itself. | `gatewayState()` in `web/lib/gateway.ts` |
| `NEXT_PUBLIC_SUPABASE_*` | `authConfigured()` is false, so the edge middleware mints a guest desk pass instead of bouncing you to a form that cannot sign you in. | `authConfigured()` and the guest branch in `web/proxy.ts` |
| A gateway that never answers | After the first probe fails with no cached payload, the book enters a deterministic browser-generated sandbox — clearly tagged as generated, with writes disabled in every tier but `live`, so you cannot act on numbers that are not real. | the `setSandboxState` effect in `web/lib/use-book.ts` |

The sandbox is a last resort, never the default path: a cached payload beats a
generated one, and an explicit human choice beats both.

---

## Prerequisites

| | Version | Why that one |
|---|---|---|
| **Node** | **22** | `web/package.json` says `>=20.9.0 <27`; CI runs 22; Vercel runs 24; `developer-console` needs `>=22.13`. 22 is the one version that satisfies all four. `.nvmrc` at the repo root pins it — `nvm use` from anywhere in the tree. |
| **npm** | bundled | `package-lock.json` is committed and CI runs `npm ci`. Do not substitute yarn or pnpm. |
| **Python** | **3.12** | Only needed for the gateway. The gateway itself supports 3.11–3.14, but `OpenBB_Service` requires `>=3.12,<3.15` and `.github/workflows/ci.yml` pins `PYTHON_VERSION: "3.12"`, so 3.12 is the version that works everywhere. |

Nothing else — no Docker, no Redis, no database server. DuckDB is a file and the
job queue runs in-process unless `REDIS_URL` is set.

---

## The full local stack

Adds the FastAPI risk gateway, so the Portfolio, Risk, Execution, Reliability
and the Prices/Proofs pair read real state instead of the sandbox.

### ⚠ Read this before you create the virtualenv

**It must be named `venv`, and it must live at `Part2_Infrastructure/venv`.**

This is the single most likely way to lose an hour on this repo.
`web/package.json`'s `dev:gateway` and `dev:all` hard-code that path:

```jsonc
"dev:gateway": "cd .. && ./venv/bin/python -m uvicorn main:app --reload --port 8000",
```

and `web/scripts/start-dev-all.mjs` spawns `resolve(rootDir, "venv/bin/python")`
with **no existence check and no `error` handler on the child process**. So a
`.venv`, a conda environment, a `uv` environment or a virtualenv one directory
up does not produce a helpful message. It produces an unhandled `ENOENT` that
reads like a crash in Node.

Create it exactly like this:

```bash
cd Part2_Infrastructure
python3.12 -m venv venv          # the name is load-bearing — not .venv
venv/bin/python -m pip install --upgrade pip
venv/bin/python -m pip install -r requirements-core.txt
```

Name `python3.12` explicitly. The default `python3` on a current
macOS/Homebrew is 3.14, and a 3.14 venv looks fine while running one test
*fewer*: numba publishes no 3.14 wheel, so vectorbt does not install and
`tests/test_backtester.py` **skips** rather than fails. The summary line still
reads green while the vectorbt engine goes entirely untested. Read the skip
reasons with `-rs`, never the total.

### Which requirements file, and what each one unlocks

There are **twelve** of them in `Part2_Infrastructure/`. That is not sprawl —
each one is a capability whose absence is a *named refusal* rather than a crash,
and splitting them is what lets the container ship the lean set and CI install
the tested one.

| File | Installs | What it unlocks — and what happens without it |
|---|---|---|
| **`requirements-core.txt`** | fastapi, uvicorn, pydantic, jinja2, python-dotenv, httpx, websockets, duckdb, numpy, pandas, matplotlib, pytest, pytest-asyncio | **The gateway itself, and what the container installs.** This is the tested local path. |
| `requirements.txt` | core **plus** vectorbt, celery, redis | The full local runtime: the vectorbt backtest engine and the Celery worker. Without it the backtester falls back to its NumPy engine and **every number is identical** — `/health` reports which engine is live. |
| **`requirements-dev.txt`** | `-r core`, `-r native`, ruff, `-r communities`, `-r ml`, vectorbt, `-r coherence`, httpx2 | **What CI installs**, and what a pre-push run needs. Deliberately excludes `requirements-rerank.txt`: the cross-encoder's default suite drives a fake scorer and runs in full with nothing installed, so installing fastembed would buy zero coverage — the *weights* are what differ, and hanging 1.05 GiB off the push gate would let a busy hub turn a good PR red. |
| `requirements-ml.txt` | `scikit-learn>=1.5,!=1.8.0,<2.0` | The `modules/ml/` model families that do not solve in closed form. Absent → the hand-rolled NumPy ridge and logistic run instead, and **the run says so**: the engine is recorded on `ml_runs.engine`, reported on `/health` and named in the strategy's unavailability message. A run that fell back is a different run. |
| `requirements-graph.txt` | `neo4j>=5.20` | The Neo4j projection sweep **and** reading its labels back on the two graph report routes. Absent → those routes answer from the corpus and mark `source: "corpus"` with a named reason. Nothing else changes: no request path depends on the graph. |
| `requirements-communities.txt` | `networkx>=3.2`, `scipy>=1.11` | In-process Louvain and PageRank — the algorithms Aura Free's missing GDS library cannot run. **This is the extra that costs skips if you forget it:** four suites sit behind a `find_spec("networkx")` guard. It is in `requirements-dev.txt` for that reason. |
| `requirements-genai.txt` | `google-genai>=1.0` | Grounded generation. Absent (or no `GEMINI_API_KEY`) → the plane still retrieves and reports `verdict=refused` with the reason. |
| `requirements-rerank.txt` | `fastembed>=0.4,<0.8`, `onnxruntime>=1.17` | The `BAAI/bge-reranker-base` cross-encoder **and**, reused with no separate file, the optional CLIP image arm. Absent → the RRF order passes through untouched with `reranked: False` and a named reason. Weights are seeded at image-build time, never on the request path. |
| `requirements-coherence.txt` | `scipy>=1.11`, `cryptography>=42` | The coherence solver and the certificate signer. Without `cryptography` four signing tests skip — including the only one that signs a real vector and verifies it. |
| `requirements-native.txt` | `setuptools>=70`, `pybind11>=2.13` | The build toolchain for `modules/_decision_core*.so`. A **dev** dependency, never a runtime one: the runtime image copies the finished `.so` and carries no compiler. |
| `requirements-recall.txt` | `httpx>=0.27` | `tools/graph_recall.py`, the standalone terminal reader. It writes nothing and nothing in `modules/` imports it. |
| `requirements-openbb.txt` | `openbb==4.7.2`, `openbb-yfinance==1.6.3` | The gateway's optional **in-process** OpenBB bridge. Imported lazily; absence is a reported state on `/api/research/openbb/health`, never an `ImportError` at boot. |

Separately, `OpenBB_Service/requirements.txt` pins the **deployed** service
exactly — `fastapi==0.136.3`, `openbb-core==1.6.13`, `openbb-yfinance==1.6.3`,
`uvicorn[standard]==0.40.0`, `yfinance==1.5.2` — because that unit is a vendor
integration and a floating pin there is a silent behaviour change.

**Start with `requirements-core.txt`, not `requirements.txt`.** The full file
pulls vectorbt and numba, which often fail to build from source and buy only a
faster backtest engine. When you want to run the suite the way CI does, install
`requirements-dev.txt` instead.

### The native decision core (optional to run, required for the full suite)

The gateway's pre-trade arithmetic exists twice — the Python reference in
`modules/risk_proxy/` (`gates.py` declares the seventeen-name `GATE_ORDER`,
`decision.py` evaluates it) and a C++ core in `native/decision_core/` — and
`DECISION_CORE=auto` (the default) uses the compiled one when it imports and the
Python one otherwise, publishing which on `/health`. Nothing needs it to *run*;
`tests/test_decision_core_native.py` and `tests/test_core_self_measure.py` need
it to *pass*, and fail rather than skip when `modules/_decision_core` is absent,
because a broken build has to turn CI red. A compiler and ten seconds:

```bash
cd Part2_Infrastructure
venv/bin/python -m pip install -r requirements-native.txt      # setuptools + pybind11
venv/bin/python native/decision_core/setup.py build_ext --inplace --build-temp build/native
```

That drops `modules/_decision_core.cpython-312-darwin.so` (or the matching ABI
tag) beside the Python modules; the Docker image builds the same thing in its
builder stage so the runtime image carries the `.so` and no compiler.
`DECISION_CORE=native` refuses to start without it — the setting for a deploy
that must not degrade quietly; `DECISION_CORE=python` pins the reference.

### Run both processes

From `Part2_Infrastructure/web`:

```bash
npm run dev:all        # gateway on :8000 and Next.js on :3000, one terminal
```

Or in two terminals, which is easier to read when something breaks:

```bash
cd Part2_Infrastructure && venv/bin/python -m uvicorn main:app --reload --port 8000
cd Part2_Infrastructure/web && npm run dev
```

Run the gateway with `Part2_Infrastructure` as the working directory — `main.py`
is the entrypoint and it resolves the DuckDB audit log relative to itself.

| Service | URL |
|---|---|
| Desk workspace | http://localhost:3000 |
| Gateway API | http://127.0.0.1:8000 |
| Gateway console | http://127.0.0.1:8000/app |
| OpenAPI docs | http://127.0.0.1:8000/docs |

The web app finds the gateway with no configuration at all, because of the
development-only fallback in the table above.

### One caveat, and it is the opposite of the obvious one

On a fresh clone the gateway is **open** — `config.py` defaults `require_auth`
to `False` (`config.py:331`) — so `/health`, `/api/portfolio`, `/api/risk/limits`
and `/metrics` all answer unauthenticated on localhost.

The trap is copying `.env.example` to `.env` as a reflex. That file ships
`REQUIRE_AUTH=1` — correct for anything public, and it breaks a local setup,
because the web app has no `ALPHAENGINE_GATEWAY_TOKEN` to send. The gateway
returns 401, the web app reads that as an outage and drops into the sandbox, and
you debug a gateway that is working perfectly.

If you do want auth on locally, set both sides:

```bash
# Part2_Infrastructure/.env
REQUIRE_AUTH=1
WEB_API_TOKEN=<a long random value>

# Part2_Infrastructure/web/.env.local
ALPHAENGINE_GATEWAY_TOKEN=<the same value>
```

---

## Verify it

The counts below are what the runners printed on 2026-08-24. Re-run them rather
than trusting the numbers: a figure nobody re-measured is not a measurement.

```bash
# Gateway suite — 3,039 passed, 1 skipped, with the cross-encoder weights
# seeded (native core built, Python 3.12, no .env in Part2_Infrastructure).
# CI seeds nothing and prints a smaller total with two skips instead of one.
# Both are green. Read the skip REASONS with -rs, never the count alone.

cd Part2_Infrastructure && venv/bin/python -m pytest

# Web suite — 4,728 passed, 2 skipped, across 1,028 suites; no browser
cd Part2_Infrastructure/web && npm test

# Research service — 24 passed
cd Part2_Infrastructure && venv/bin/python -m pytest OpenBB_Service/tests

# Types, lint, production build
cd Part2_Infrastructure/web && npm run typecheck
cd Part2_Infrastructure && venv/bin/python -m ruff check .
cd Part2_Infrastructure/web && npm run build

# End-to-end over the money path: book -> cost -> risk gate -> audit
cd Part2_Infrastructure && venv/bin/python tools/synthetic_probe.py
```

The probe prints six named steps — gateway health, metrics exposition, order
book, execution cost (TCA), risk gate rejects, audit trail — and a total; a
healthy run ends `6/6 steps passed`, with no network: market data simulates.

**Never source `.env` before running any of this.** `set -a && . ./.env` EXPORTS
`REQUIRE_AUTH=1`, which beats the `setdefault` in `tests/conftest.py`, and about
80 route tests then fail with 401 without saying why. Pass one variable per run:

```bash
cd Part2_Infrastructure
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  venv/bin/python -m pytest tests/test_data_ops_postgrest.py   # 11 tests, 0 skipped
```

**Turning the other skip into passes.** `tests/test_research_rerank_real.py`
skips at MODULE level, so its tests are not collected at all until weights
exist. Seed them once — about 1.05 GiB, fetched from a third-party hub:

```bash
cd Part2_Infrastructure
venv/bin/python -m pip install -r requirements-rerank.txt
venv/bin/python tools/bench_rerank.py --seed --model-path .rerank-weights
RERANK_TEST_MODEL_PATH=.rerank-weights venv/bin/python -m pytest tests/test_research_rerank_real.py
```

That is what CI's opt-in `rerank-real` job does. **A `.env` does it too, and
that surprises people:** `conftest.py` deliberately does not blank
`RERANK_TEST_MODEL_PATH`, and python-dotenv fills it from
`Part2_Infrastructure/.env`, so a machine whose deployment file names a weights
directory gets the seeded shape with nothing exported. Force the CI shape with
`RERANK_TEST_MODEL_PATH= venv/bin/python -m pytest`. Only the **web** line of
`web/lib/test-counts.generated.ts` is checked in CI
(`node scripts/check-test-counts.mjs web <log>`), so its gateway line is a dated
record rather than a gate. Refreshed 2026-08-24 in the CI shape to 3,033
(3,031 passed, 2 skipped); a weights-seeded run of the same suite prints 3,040
(3,039 passed, 1 skipped). If those two disagree with each other, that is the
shape, not a failure — check which one you are in before calling it stale.

**There is no `lint` script for the web app.** `npm run lint` in `web/` fails as
a missing script; that is not a broken linter. `package.json` has exactly `dev`,
`dev:gateway`, `dev:all`, `prebuild`, `build`, `catalog:refresh`, `start`,
`typecheck`, `test` and `counts:refresh`. Linting is Python-side, via `ruff`,
which is in `requirements-dev.txt` only.

**`npm run build` runs two gates before Next.js starts.** The `prebuild` hook is
`node scripts/check-gateway-openapi-digest.mjs && node scripts/generate-codebase-manifest.mjs --check`.

1. The first reads `../../tools/openapi.json`, canonicalises it (**sorted keys —
   this is a canonical-JSON SHA-256, not a file hash**) and compares it with the
   64-hex literal in `web/lib/gateway-openapi-digest.generated.ts`. It prints
   `Gateway OpenAPI digest verified: <hash>` on a match and exits 1 with
   `Gateway OpenAPI digest is stale` on drift — a contract assertion between two
   separately deployed units, not a broken build. Verified on 2026-08-24 at
   `3379dbca…`.
2. The second refuses to build if `web/lib/repository-manifest.generated.json`
   no longer lists the same files `git ls-files --cached --others
   --exclude-standard` does — **only the file list**, because `generatedAt` and
   `commit` change every commit and gating on those would fail every push. It
   skips cleanly when git is unavailable, so a tarball build still works. Expect
   it to be red whenever a file has landed since the last refresh — run on
   2026-08-24 it reported `Repository manifest is stale (3 added, 1 removed)`,
   naming the three `components/coherence/` files added this session and the deleted
   `PendingPane.tsx`. The fix is `npm run catalog:refresh`, never an edit to the
   JSON.

A third generated file, `web/lib/test-counts.generated.ts`, goes stale the same
way and is refreshed by `npm run counts:refresh` — but it is checked in CI
rather than at `prebuild`, and only its web line.

**Adding a field to a schema cascades to three committed artefacts, in order.**
Regenerate them in this sequence or the second one fails on the first one's
output:

```bash
cd Part2_Infrastructure
venv/bin/python tools/export_openapi.py                  # 1. tools/openapi.json
cd web && node scripts/check-gateway-openapi-digest.mjs  # 2. tells you the new digest to commit
node --import tsx scripts/generate-gateway-client.ts     # 3. lib/gateway-contract.generated.ts
```

### Advanced: the desk sweep

`web/scripts/desk-sweep.mjs` drives **all 57 rail sections across all 10 tabs**
under six backend fault profiles, using Chrome DevTools Protocol fault
injection, and asserts no surface can dead-end. It is the only check in the
repository that puts a browser in front of the desk — `npm test` is plain Node
with no DOM and no layout engine — and it has real prerequisites, so it is not
in the verify block above.

```bash
# terminal 1 — note the port: 3100, not 3000
cd Part2_Infrastructure/web && PORT=3100 npm run dev

# terminal 2
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new --remote-debugging-port=9222 --disable-gpu about:blank

# terminal 3
cd Part2_Infrastructure/web && node scripts/desk-sweep.mjs
```

Flags are `--name=value` only — `--profile=gateway-hang --tab=portfolio`; a
space-separated `--profile gateway-hang` is not parsed. The counts above are
`EXPECTED_SECTIONS = 57` and the ten-key `TABS` map in
`web/scripts/desk-sweep-plan.mjs`, which is what the script actually executes.
Two stale figures live nearby and neither is what runs: `desk-sweep.mjs`'s own
header comment still says "47 rail sections across all 8 tabs", and the sweep
walks 57 cells rather than the 65 the 2026-08-24 promotion pass briefly made
addressable — eight subjects on the Kalshi engine are in-pane views again, and a
view is not a section the sweep can reach.

*Not run while this file was written; the prerequisites are read off the
script's own header and argument parser.*

### Advanced: build the whitepaper

`docs/whitepaper/` is Typst source — `main.typ`, six chapters under `sections/`,
one `template.typ`. `.gitignore` excludes `*.pdf`, so no PDF is committed;
`typst` is in no requirements file and no CI job compiles it, so nothing reports
a broken chapter until you run:

```bash
typst compile docs/whitepaper/main.typ AlphaEngine_Institutional_Whitepaper.pdf
```

Install Typst first (`brew install typst`, or a release binary). Run on
2026-08-22 it completed with no warnings and produced 83 A4 pages. The one trap
to know before editing a chapter — `#include` evaluates a file in its own scope,
so `main.typ`'s imports do not reach the sections — is in `CLAUDE.md`.

---

## Claude Code skills

`.claude/skills/` holds three skills — one directory each, one `SKILL.md`
apiece. They travel with the clone, so there is nothing to install; in Claude
Code they are slash commands. `/start-alpha-engine` boots the desk and the
gateway, creating the virtualenv at the one path the dev scripts accept;
`/tour` walks the architecture; `/verify` runs every check in *Verify it* above
and reports only numbers it has just measured. They restate this file and
`CLAUDE.md` in a form an agent follows rather than reads.

---

## Environment variables

Both `.env.example` files are the reference and are heavily commented. Read
those rather than any list here, which would go stale:

- `Part2_Infrastructure/.env.example` — gateway: risk limits, market data,
  Telegram, data ops (the quality ledger, the work queue, replay and backfill),
  Supabase mirror, the research plane.
- `Part2_Infrastructure/web/.env.example` — web: provider keys, gateway
  connection, Oracle, Supabase, operator token.

`config.py` resolves **100** distinct environment names through its `_env*`
helpers — `grep -oE '_env[a-z_]*\("[A-Z][A-Z0-9_]+"' config.py | sort -u | wc -l`,
2026-08-24 — and the modules listed at the end of this section read a further
set straight from `os.environ`. The groups below name the ones you would
actually set.

**1. Required to run: none.** Not one. That is the point of the first section of
this file.

**2. Unlocks a provider or a feature.** Each one you set lights up more
capability and nothing else changes; each one you leave unset produces an honest
"not configured" rather than a blank panel or a zero.

- **Market data:** `FMP_API_KEY`, `TIINGO_API_KEY`, `MASSIVE_API_KEY`,
  `ALPHAVANTAGE_API_KEY`, `FIRECRAWL_API_KEY`. Crypto quotes, bars and depth
  work through Binance's public endpoints with none of them. `GET /api/providers`
  reports which are live and how much free-tier quota the instance has spent.
- **Gateway link:** `ALPHAENGINE_GATEWAY_URL`, `ALPHAENGINE_GATEWAY_TOKEN`
  (the token must equal the gateway's `WEB_API_TOKEN`).
- **Operator writes:** `ALPHAENGINE_OPERATOR_TOKEN`. Read-only telemetry never
  needs it; unset means the write path is open outside production and refused
  (503) in production.
- **Realtime tape and optional sign-in:** `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Public by design — RLS scopes the anon key to
  gateway-decided, unowned rows on the demo desk and nothing else.
- **Supabase mirror and the research corpus (gateway side):** `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MIRROR_ENABLED` (default off),
  `SUPABASE_DESK_ID`, `SUPABASE_TIMEOUT_S` (5.0),
  `SUPABASE_MIRROR_QUEUE_MAX` (1000).
- **Oracle in-database VaR and vector search:** `ORACLE_CONN_STRING`,
  `ORACLE_USER`, `ORACLE_PASSWORD`, and for a wallet deployment
  `ORACLE_WALLET_PEM_B64` and `ORACLE_WALLET_PASSWORD`. All five are read on the
  **web** side (`web/lib/oracle/`); unset is a typed `oracle_not_configured`,
  never a thrown error and never a credential in the message.
- **Research service:** `OPENBB_API_URL`, `OPENBB_API_TOKEN`.
- **The retrieval plane:** `RESEARCH_RAG_ENABLED` (off by default),
  `GEMINI_API_KEY` / `GEMINI_MODEL` (unset means every answer reports
  `verdict=refused` with the reason; retrieval is unaffected),
  `RERANK_MODEL_PATH` for the local cross-encoder, and
  `NEO4J_URI` / `NEO4J_USERNAME` (or `NEO4J_USER`) / `NEO4J_PASSWORD` /
  `NEO4J_DATABASE` for the graph read model. Paste an Aura credentials file
  verbatim: current-generation instances use the instance id, not `neo4j`, for
  username and database. All four Neo4j names are read by `config.py`; the
  driver itself comes from `requirements-graph.txt`.
- **The engine selectors:** `DECISION_CORE` (`auto` | `native` | `python`) and
  `ML_ENGINE` (`auto` | `sklearn` | `numpy`). Both are validated at import and
  both publish which engine is live rather than degrading quietly.
- **The Coherence recorder:** `COHERENCE_SERIES` **and** `COHERENCE_POLL_S` —
  the tape stays off unless **both** are set (`POLL_SECONDS = 0` keeps it off),
  plus `COHERENCE_DB_PATH`, `COHERENCE_MAX_EVENTS` (2),
  `COHERENCE_READ_TOKENS_PER_S`, `COHERENCE_REQUEST_TIMEOUT_S` and the fee
  knobs. The exchange's public endpoints need no key; `KALSHI_DEMO_KEY_ID` and
  `KALSHI_DEMO_PRIVATE_KEY_PATH` are only for the signed private-channel reads.
- **Data-ops cadence:** `WEB_WORKSPACE_URL`, `DATA_SCHEDULES`. The quality
  ledger, the persisted work queue and the replay/backfill routes all work with
  neither set — a schedule is the only thing that needs one, and a replay says
  which variable is missing rather than failing quietly.
- **Telegram:** see below.

**Tunables read straight from `os.environ`, not through `config.py`.** `config.py`
sits at its own recorded line ceiling (`tests/test_file_size.py`), so a new
`Settings` field cannot be added without pushing it over. These live as
module-level constants in the module that reads them, each with a working
default, and are named here rather than left to be found by reading source:

| Group | Variables | Read in |
|---|---|---|
| `/ask` bounds | `RESEARCH_ASK_RATE_PER_S`, `RESEARCH_ASK_BURST`, `RESEARCH_ASK_SPEND_WINDOW_S`, `RESEARCH_ASK_SPEND_CEILING_USD`, `RESEARCH_ASK_PRICE_INPUT_USD_PER_MTOK`, `RESEARCH_ASK_PRICE_OUTPUT_USD_PER_MTOK` | `modules/research_quota.py` |
| Tenant scope | `RESEARCH_SCOPE_TO_DESK` | `modules/research_quota_scope.py` |
| Retrieval widths | `RESEARCH_WIDEN_FACTOR`, `RESEARCH_MAX_CANDIDATES` | `modules/research_stages.py` |
| Corpus delivery | `RESEARCH_INGEST_ATTEMPTS`, `RESEARCH_INGEST_BACKOFF_BASE_S`, `RESEARCH_INGEST_BACKOFF_CEILING_S`, `RESEARCH_DEAD_LETTER_MAX` | `modules/research_ingest_delivery.py` |
| Multimodal budgets | `RESEARCH_VISION_TIMEOUT_MS` (45000, against 20000 for text), `RESEARCH_VISION_MAX_IMAGES`, `RESEARCH_VISION_MAX_IMAGE_BYTES` | `modules/research_generate_vision.py` |
| Stored chart pixels | `RESEARCH_CHART_IMAGE_FETCH_TIMEOUT_MS` (1200; `0` disables the fetch), `RESEARCH_CHART_IMAGE_CACHE_MAX` | `modules/research_image_store.py` |
| The CLIP arm | `RESEARCH_IMAGE_MODEL_PATH`, `RESEARCH_IMAGE_MIN_SIMILARITY` | `modules/research_image.py` |
| The diffusion study | `DIFFUSION_SEED`, `DIFFUSION_MARKET_SYMBOL`, `DIFFUSION_STAGE_TERMINAL_MIN`, `DIFFUSION_BOOTSTRAP_DRAWS` and the FOMC calendar knobs | `modules/coherence/diffusion/` |

Unparseable and out-of-range values fall back to the default **and log**, rather
than clamping a typo into a plausible number.

**3. Deployment only.** `VERCEL_*`, `ALPHAENGINE_ARTIFACT_SIGNING_KEY`. Never
needed locally.

Two rules worth stating out loud, because both have bitten:

- **`NEXT_PUBLIC_*` is inlined at build time.** Changing one in the Vercel
  dashboard does nothing until the next deployment. Server-side variables have
  no such problem.
- **The Supabase service-role key belongs only in the gateway's `.env`.** Never
  on Vercel, never in the browser, never with a `NEXT_PUBLIC_` prefix.

### Telegram

The header's **Connect** button links a web account — or a guest session — to
`@alpha_engine_nussif_bot`. It needs `TELEGRAM_LINK_SECRET` set to the **same
value** on the gateway and on Vercel, because one process mints the one-time
token and another host verifies it. Unset is fail-closed: the control renders a
refusal naming the missing secret. Never rename it to
`NEXT_PUBLIC_TELEGRAM_LINK_SECRET` — that inlines it into the browser bundle and
lets anyone forge a binding. The bot token (`TELEGRAM_BOT_TOKEN`) lives in the
gateway's `.env` and nowhere else; leave it empty and everything else runs
unchanged. Read access is `TELEGRAM_ALLOWED_USER_IDS`; the six commands that can
change what the desk is allowed to do need `TELEGRAM_CONTROL_USER_IDS`, a
**second, narrower** allow-list that is empty unless somebody sets it. Telegram
is a notification companion, never an auth provider.

---

## Live deployment

| | |
|---|---|
| Desk workspace | https://alphaengine-workspace.vercel.app |
| Risk gateway | http://149.118.48.255:8000 — and `https://149.118.48.255:8443` behind the Caddy sidecar's pinned internal CA (`docs/engineering/TLS_FLIP.md`); both answered `/health` on 2026-08-17 |

The gateway deploys itself from `main` via `.github/workflows/deploy.yml`, on
pushes that touch `Part2_Infrastructure/**` but **not** `web/**` or
`OpenBB_Service/**` — the suite runs first (with the native core built), then
build, push to GHCR, SSH, pull, swap with the audit volume intact, verify, roll
back on failure. The verify step also reads which decision engine the container
came up on and emits a workflow warning if it fell back to Python. The web
workspace and the OpenBB service are Vercel projects that deploy from git on
their own, which is exactly why they are not in that workflow: putting them
there would deploy them twice.
`.github/workflows/openbb-keepalive.yml` pings the OpenBB service's `/healthz`
every ten minutes so a research quote rarely meets a cold import, and
`oracle-keepalive.yml` opens one thin-mode connection daily at 02:17 because a
free Autonomous Database stops itself after seven consecutive idle days.

---

## Troubleshooting

**`ENOENT` / `spawn venv/bin/python` from `npm run dev:all`.** The virtualenv is
missing or has the wrong name. It must be `Part2_Infrastructure/venv`. See the
warning above.

**`npm run lint` — "Missing script".** Correct. There is no web lint script; use
`ruff check .` from `Part2_Infrastructure`.

**`Gateway OpenAPI digest is stale`, build exits 1.** The committed API contract
and its digest disagree. Intentional gate, not a broken build: regenerate
`tools/openapi.json`, then the digest module.

**`Repository manifest is stale (N added…)`, build exits 1.** Same shape, one
gate later: `npm run catalog:refresh`. Expect this on any commit that adds a
file — it is the reason the manifest is a *gate* rather than a *count*.

**Every panel says the data is generated.** The gateway is not running or not
reachable. The workspace is in its sandbox tier — start the gateway, or accept
it: the desk is fully navigable there, just read-only outside `live`.

**Gateway 401 and the desk falls back to the sandbox.** You have a `.env` with
`REQUIRE_AUTH=1` and no matching `ALPHAENGINE_GATEWAY_TOKEN` on the web side.
Set both, or delete the `.env`.

**Port 3000 is taken.** `PORT=3100 npm run dev`; the gateway's dev-mode fallback
still targets `127.0.0.1:8000`.

**A pip install of `requirements.txt` fails building numba or vectorbt.** Use
`requirements-core.txt`. It is the tested path and the numbers are identical.

**About 80 pytest tests fail with 401 and none of them says why.** You exported
the environment before running the suite — `set -a && . ./.env`, or the same
thing inside a shell profile. `REQUIRE_AUTH=1` from that file beats
`conftest.py`'s `setdefault`. Start a clean shell and pass one variable per run.
See *Verify it* above.

**An extra skip appears and the total still looks green.** Read the reason
(`pytest -rs`). A `vectorbt not installed` skip means the venv is on the wrong
Python — rebuild it with `python3.12` explicitly. A `networkx` skip means
`requirements-communities.txt` is missing, which `requirements-dev.txt` would
have installed.

**`test_migration_bundle.py` fails after a new migration lands.**
`supabase/apply_all.generated.sql` is behind `supabase/migrations/`. Regenerate
it with `python3 tools/bundle_migrations.py` from the repository root; never
hand-edit the bundle.
