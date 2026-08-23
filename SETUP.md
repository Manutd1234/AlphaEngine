# Setup

Everything you need to get AlphaEngine running, in the order you need it.
`README.md` explains what it is and why; this file only gets it on screen.
Every command here was re-run against the tree on 2026-08-22 and the counts
below are what those runs printed. They are AHEAD of
`Part2_Infrastructure/web/lib/test-counts.generated.ts`, which the desk displays
and which `npm run counts:refresh` is owed to bring up to date; `CLAUDE.md` §3
and §4 hold the reconciliation and the list of what else needs regenerating.

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
the workspace**. Click it and you are on the full eight-tab desk.

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
| **Python** | **3.12** | Only needed for the gateway. The gateway itself supports 3.11–3.14, but `OpenBB_Service` requires `>=3.12,<3.15` and CI pins 3.12, so 3.12 is the version that works everywhere. |

Nothing else — no Docker, no Redis, no database server. DuckDB is a file and the
job queue runs in-process unless `REDIS_URL` is set.

---

## The full local stack

Adds the FastAPI risk gateway, so the Portfolio, Risk, Execution and Reliability
tabs read a real book instead of the sandbox.

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

**Use `requirements-core.txt`, not `requirements.txt`.** Core is the lean tested
path — FastAPI, uvicorn, pandas, numpy, DuckDB, pytest. The full
`requirements.txt` pulls vectorbt and numba, which often fail to build from
source and buy only a faster backtest engine; without them the backtester
falls back to its built-in NumPy engine and every number is identical. CI itself
installs `requirements-dev.txt`: core plus `ruff`, `requirements-communities.txt`
(networkx and scipy — 45 research tests skip without them), the build-time
`requirements-native.txt`, and, so the job that gates the push runs what the
suite tests rather than skipping it, `requirements-ml.txt`, vectorbt and the
`httpx2` transport starlette's test client is built on.

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

That drops `modules/_decision_core.cpython-312-darwin.so` (or the matching ABI tag) beside the Python modules; the
Docker image builds the same thing in its builder stage so the runtime image
carries the `.so` and no compiler. `DECISION_CORE=native` refuses to start
without it (the setting for a deploy that must not degrade quietly);
`DECISION_CORE=python` pins the reference.

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
to `False` — so `/health`, `/api/portfolio`, `/api/risk/limits` and `/metrics`
all answer unauthenticated on localhost. Verified: all four return 200 with no
header.

The trap is copying `.env.example` to `.env` as a reflex. That file ships
`REQUIRE_AUTH=1` — correct for anything public, and it breaks a local setup,
because the web app has no `ALPHAENGINE_GATEWAY_TOKEN` to send. The gateway
returns 401, the web app reads that as an outage and drops into the sandbox, and
you debug a gateway that is working perfectly. Verified: with `REQUIRE_AUTH=1`,
`/api/portfolio` is 401 without a bearer token and 200 with one, while `/health`
stays open either way.

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

Every command below was run against this tree on 2026-08-22. Re-run them rather
than trusting the counts: a number nobody re-measured is not a measurement.

```bash
# Gateway suite — 2,141 passed, 2 skipped (native core built, Python 3.12,
# no .env in Part2_Infrastructure). The two skips are test_data_ops_postgrest.py
# (no Supabase creds) and test_research_rerank_real.py (no seeded re-ranker
# weights). Both NAME what was not exercised; read the reasons with -rs, never
# the count alone.

cd Part2_Infrastructure && venv/bin/python -m pytest

# Web suite — 4,436 passed, 2 skipped, 4,438 across 974 suites; no browser
cd Part2_Infrastructure/web && npm test

# Research service — 14 passed
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
80 route tests then fail with 401 without saying why (`CLAUDE.md` §5). Pass one
variable per run:

```bash
cd Part2_Infrastructure
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  venv/bin/python -m pytest tests/test_data_ops_postgrest.py   # 11 passed, 0 skipped
```

**Turning the other skip into passes.** `tests/test_research_rerank_real.py`
skips at MODULE level, so its eight tests are not collected at all until weights
exist. Seed them once — about 1.05 GiB, fetched from a third-party hub — and the
run becomes 2,149 passed, 1 skipped:

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
directory prints 2,149 / 1 with nothing exported. Force the CI shape with
`RERANK_TEST_MODEL_PATH= venv/bin/python -m pytest`. Only the **web** line of
`web/lib/test-counts.generated.ts` is checked in CI
(`node scripts/check-test-counts.mjs web <log>`), so its gateway line is a dated
record rather than a gate.

**There is no `lint` script for the web app.** `npm run lint` in `web/` fails as
a missing script; that is not a broken linter. Linting is Python-side, via
`ruff`, which is in `requirements-dev.txt` only.

**`npm run build` runs two gates before Next.js starts.** The `prebuild` hook is
`node scripts/check-gateway-openapi-digest.mjs && node scripts/generate-codebase-manifest.mjs --check`.
The first canonicalises `tools/openapi.json`, SHA-256s it and compares it with
`web/lib/gateway-openapi-digest.generated.ts`, printing
`Gateway OpenAPI digest verified: <hash>` on a match and exiting 1 with
`Gateway OpenAPI digest is stale` on drift — a contract assertion between two
separately deployed units, not a broken build. It verified on 2026-08-22. The
second refuses to build if `web/lib/repository-manifest.generated.json` no
longer matches the tree, and **on 2026-08-22 it does not**: 32 files added, so
`npm run build` stops there until `npm run catalog:refresh` runs. A third
generated file, `web/lib/test-counts.generated.ts`, is stale the same way and is
refreshed by `npm run counts:refresh`; `CLAUDE.md` §4 tabulates all four.

### Advanced: the desk sweep

`web/scripts/desk-sweep.mjs` drives all 47 rail sections across all 8 tabs under
six backend fault profiles, using Chrome DevTools Protocol fault injection, and
asserts no surface can dead-end. It is the only check in the repository that
puts a browser in front of the desk — `npm test` is plain Node with no DOM and
no layout engine — and it has real prerequisites, so it is not in the verify
block above.

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
space-separated `--profile gateway-hang` is not parsed.

*Not run while this file was written; the prerequisites are read off the
script's own header and argument parser.*

### Advanced: build the whitepaper

`docs/whitepaper/` is Typst source — `main.typ`, six chapters under `sections/`,
one `template.typ`. No PDF is committed, `typst` is in no requirements file and
no CI job compiles it, so nothing reports a broken chapter until you run:

```bash
typst compile docs/whitepaper/main.typ AlphaEngine_Institutional_Whitepaper.pdf
```

Install Typst first (`brew install typst`, or a release binary). Re-run on
2026-08-22: it completed with no warnings and produced 83 A4 pages. The one trap
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
  Supabase mirror.
- `Part2_Infrastructure/web/.env.example` — web: provider keys, gateway
  connection, Oracle, Supabase, operator token.

They fall into three groups.

**1. Required to run: none.** Not one. That is the point of the first section of
this file.

**2. Unlocks a provider or a feature.** Each one you set lights up more
capability and nothing else changes; each one you leave unset produces an honest
"not configured" rather than a blank panel or a zero.

- Market data: `FMP_API_KEY`, `TIINGO_API_KEY`, `MASSIVE_API_KEY`,
  `ALPHAVANTAGE_API_KEY`, `FIRECRAWL_API_KEY`. Crypto quotes, bars and depth
  work through Binance's public endpoints with none of them. `GET /api/providers`
  reports which are live and how much free-tier quota the instance has spent.
- Gateway link: `ALPHAENGINE_GATEWAY_URL`, `ALPHAENGINE_GATEWAY_TOKEN`.
- Operator writes: `ALPHAENGINE_OPERATOR_TOKEN`. Read-only telemetry never needs
  it; unset means the write path is open outside production and refused (503) in
  production.
- Realtime tape and optional sign-in: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Oracle vector search and in-database VaR: `ORACLE_CONN_STRING`,
  `ORACLE_PASSWORD`, `ORACLE_USER`.
- Research service: `OPENBB_API_URL`, `OPENBB_API_TOKEN`.
- The retrieval plane: `RESEARCH_RAG_ENABLED` (off by default), `GEMINI_API_KEY`
  (unset means every answer reports `verdict=refused` with the reason;
  retrieval is unaffected), `NEO4J_*` for the graph arm, `RERANK_MODEL_PATH` for
  the local cross-encoder. Four modules read further knobs straight from
  `os.environ` rather than through `config.py`, none yet in `.env.example`:
  `RESEARCH_ASK_RATE_PER_S` / `RESEARCH_ASK_BURST` /
  `RESEARCH_ASK_SPEND_CEILING_USD` (`modules/research_quota.py`),
  `RESEARCH_SCOPE_TO_DESK` (`modules/research_quota_scope.py`),
  `RESEARCH_VISION_TIMEOUT_MS` (default 45000, `modules/research_generate_vision.py`)
  and `RESEARCH_IMAGE_MODEL_PATH` (`modules/research_image.py`). Each has a
  working default; read the module header for what it costs to change.
- Data-ops cadence: `WEB_WORKSPACE_URL`, `DATA_SCHEDULES`. The quality ledger,
  the persisted work queue and the replay/backfill routes all work with neither
  set — a schedule is the only thing that needs one, and a replay says which
  variable is missing rather than failing quietly.
- Telegram: see below.

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
unchanged. Telegram is a notification companion, never an auth provider.

---

## Live deployment

| | |
|---|---|
| Desk workspace | https://alphaengine-workspace.vercel.app |
| Risk gateway | http://149.118.48.255:8000 — and `https://149.118.48.255:8443` behind the Caddy sidecar's pinned internal CA (`docs/engineering/TLS_FLIP.md`); both answered `/health` on 2026-08-17 |

The gateway deploys itself from `main` via `.github/workflows/deploy.yml` — the
suite runs first (with the native core built), then build, push to GHCR, SSH,
pull, swap, verify, roll back on failure. The verify step also reads which
decision engine the container came up on and emits a workflow warning if it
fell back to Python. The web workspace and the OpenBB service are Vercel
projects that deploy from git on their own; `.github/workflows/openbb-keepalive.yml`
pings the OpenBB service's `/healthz` every ten minutes so a research quote
rarely meets a cold import.

---

## Troubleshooting

**`ENOENT` / `spawn venv/bin/python` from `npm run dev:all`.** The virtualenv is
missing or has the wrong name. It must be `Part2_Infrastructure/venv`. See the
warning above.

**`npm run lint` — "Missing script".** Correct. There is no web lint script; use
`ruff check .` from `Part2_Infrastructure`.

**`Gateway OpenAPI digest is stale`, build exits 1.** The committed API contract
and its digest disagree. Intentional gate, not a broken build.

**`Repository manifest is stale (N added…)`, build exits 1.** Same shape, one
gate later: `npm run catalog:refresh`. Expect it on this commit — 32 files.

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

**`test_migration_bundle.py` fails after a new migration lands.**
`supabase/apply_all.generated.sql` is behind `supabase/migrations/`. Regenerate
it with `python3 tools/bundle_migrations.py` from the repository root; never
hand-edit the bundle.
