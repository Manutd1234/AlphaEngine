# Setup

Everything you need to get AlphaEngine running, in the order you need it.
`README.md` explains what it is and why; this file only gets it on screen.

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

That is the whole first run. If you have ten minutes rather than two, the
[full local stack](#the-full-local-stack) adds the Python gateway and turns the
generated data into live data.

### Why it works with nothing set

Three mechanisms, each deliberate:

| Missing thing | What happens instead | Where |
|---|---|---|
| `ALPHAENGINE_GATEWAY_URL` | Falls back to `http://127.0.0.1:8000`, but **only** when `NODE_ENV=development`. In production an unset URL reports the gateway as absent rather than fetching itself. | `gatewayState()` in `web/lib/gateway.ts` |
| `NEXT_PUBLIC_SUPABASE_*` | `authConfigured()` is false, so the edge middleware mints a guest desk pass instead of bouncing you to a form that cannot sign you in. | `authConfigured()` and the guest branch in `web/proxy.ts` |
| A gateway that never answers | After the first probe fails with no cached payload, the book enters a deterministic browser-generated sandbox — clearly tagged as generated, with writes disabled in every tier but `live`, so you cannot act on numbers that are not real. | the `setSandboxState` effect in `web/lib/use-book.ts` |

The sandbox is a last resort, not the default path: a cached payload is always
preferred over a generated one, and an explicit human choice is preferred over
both.

---

## Prerequisites

| | Version | Why that one |
|---|---|---|
| **Node** | **22** | `web/package.json` says `>=20.9.0 <27`; CI runs 22; Vercel runs 24; `developer-console` needs `>=22.13`. 22 is the one version that satisfies all four. `.nvmrc` at the repo root pins it — `nvm use` from anywhere in the tree. |
| **npm** | bundled | `package-lock.json` is committed and CI runs `npm ci`. Do not substitute yarn or pnpm. |
| **Python** | **3.12** | Only needed for the gateway. The gateway itself supports 3.11–3.14, but `OpenBB_Service` requires `>=3.12,<3.15` and CI pins 3.12, so 3.12 is the version that works everywhere. |

Nothing else. No Docker, no Redis, no database server — DuckDB is a file and
the job queue runs in-process unless you set `REDIS_URL`.

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

**Use `requirements-core.txt`, not `requirements.txt`.** Core is the lean,
tested path — FastAPI, uvicorn, pandas, numpy, DuckDB, pytest. The full
`requirements.txt` pulls vectorbt and numba, which frequently fail to build from
source and buy you only a faster backtest engine; without them the backtester
falls back to its built-in NumPy engine and every number is identical. CI itself
installs `requirements-dev.txt`, which is core plus `ruff`.

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

On a fresh clone the gateway is **open** — `REQUIRE_AUTH` defaults to off
(`config.py:292`), so `/api/portfolio`, `/api/risk/limits` and `/metrics` all
answer unauthenticated on localhost. Verified: all four return 200 with no
header.

The trap is copying `.env.example` to `.env` as a reflex. That file ships
`REQUIRE_AUTH=1` — correct for anything public, and it will break your local
setup, because the web app has no `ALPHAENGINE_GATEWAY_TOKEN` to send. The
gateway then returns 401, the web app treats it as an outage and drops into the
sandbox, and you spend an afternoon debugging a gateway that is working
perfectly. Verified: with `REQUIRE_AUTH=1`, `/api/portfolio` is 401 without a
bearer token and 200 with one, while `/health` stays open either way.

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

Every command below was run against this tree. Run them yourself rather than
trusting the counts — they drift, and a number nobody re-measured is a number
nobody should quote.

```bash
# Gateway suite — 662 passed, 1 skipped
cd Part2_Infrastructure && venv/bin/python -m pytest

# Web suite — 1975 passed across 502 suites, no browser needed
cd Part2_Infrastructure/web && npm test

# Research service — 13 passed
cd Part2_Infrastructure && venv/bin/python -m pytest OpenBB_Service/tests

# Types, lint, production build
cd Part2_Infrastructure/web && npm run typecheck
cd Part2_Infrastructure && venv/bin/python -m ruff check .
cd Part2_Infrastructure/web && npm run build

# End-to-end over the money path: book -> cost -> risk gate -> audit
cd Part2_Infrastructure && venv/bin/python tools/synthetic_probe.py
```

The probe prints six named steps and a total; a healthy run ends `6/6 steps
passed`. It needs no network — market data falls back to simulation.

**There is no `lint` script for the web app.** `npm run lint` in `web/` fails as
a missing script; that is not a broken linter. Linting is Python-side, via
`ruff`, which is in `requirements-dev.txt` only.

**`npm run build` runs a gate before Next.js starts.** The `prebuild` hook is
`scripts/check-gateway-openapi-digest.mjs`. It canonicalises `tools/openapi.json`,
SHA-256s it, and compares the result against a digest committed in
`web/lib/gateway-openapi-digest.generated.ts`. On a match it prints
`Gateway OpenAPI digest verified: <hash>`. On drift it exits 1 with
`Gateway OpenAPI digest is stale`. That is an intentional contract assertion
between two separately deployed units, not a broken build — regenerate the
snapshot with `python tools/export_openapi.py` and update the digest module
deliberately.

### Advanced: the desk sweep

`web/scripts/desk-sweep.mjs` drives all 43 rail sections across all 8 tabs under
six backend fault profiles, using Chrome DevTools Protocol fault injection, and
asserts no surface can dead-end. It is a browser harness with real
prerequisites, so it is not part of the verify block above.

```bash
# terminal 1 — note the port: 3100, not 3000
cd Part2_Infrastructure/web && PORT=3100 npm run dev

# terminal 2
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new --remote-debugging-port=9222 --disable-gpu about:blank

# terminal 3
cd Part2_Infrastructure/web && node scripts/desk-sweep.mjs
```

Flags use `--name=value` form only — `--profile=gateway-hang --tab=portfolio`.
A space-separated `--profile gateway-hang` is not parsed.

*Not run during the writing of this file — the prerequisites above are stated
from the script's own header and argument parser.*

---

## Environment variables

Both `.env.example` files are the reference and are heavily commented. Read
those rather than any list here, which would go stale:

- `Part2_Infrastructure/.env.example` — gateway: risk limits, market data,
  Telegram, Supabase mirror.
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
token and a different process on a different host verifies it. Unset is
fail-closed: the control renders a refusal naming the missing secret rather than
a link that cannot complete. Never rename it to `NEXT_PUBLIC_TELEGRAM_LINK_SECRET`
— that would inline it into the browser bundle and let anyone forge a binding.

The bot token itself (`TELEGRAM_BOT_TOKEN`) lives in the gateway's `.env` and
nowhere else. Leave it empty and the gateway and web workspace run unchanged;
Telegram is an independent notification companion, never an auth provider.

---

## Live deployment

| | |
|---|---|
| Desk workspace | https://alphaengine-workspace.vercel.app |
| Risk gateway | http://149.118.48.255:8000 |

The gateway deploys itself from `main` via `.github/workflows/deploy.yml` — build,
push to GHCR, SSH, pull, swap, verify, roll back on failure. The web workspace
and the OpenBB service are Vercel projects that deploy from git on their own.

---

## Troubleshooting

**`ENOENT` / `spawn venv/bin/python` from `npm run dev:all`.** The virtualenv is
missing or has the wrong name. It must be `Part2_Infrastructure/venv`. See the
warning above.

**`npm run lint` — "Missing script".** Correct. There is no web lint script; use
`ruff check .` from `Part2_Infrastructure`.

**`Gateway OpenAPI digest is stale`, build exits 1.** The committed API contract
and its digest disagree. Intentional gate, not a broken build.

**Every panel says the data is generated.** The gateway is not running or not
reachable. The workspace is in its sandbox tier — start the gateway, or accept
it: the desk is fully navigable there, just read-only outside `live`.

**Gateway 401 and the desk falls back to the sandbox.** You have a `.env` with
`REQUIRE_AUTH=1` and no matching `ALPHAENGINE_GATEWAY_TOKEN` on the web side.
Set both, or delete the `.env`.

**Port 3000 is taken.** `PORT=3100 npm run dev`. The gateway's dev-mode fallback
targets `127.0.0.1:8000` regardless of which port the web app is on.

**A pip install of `requirements.txt` fails building numba or vectorbt.** Use
`requirements-core.txt`. It is the tested path and the numbers are identical.
