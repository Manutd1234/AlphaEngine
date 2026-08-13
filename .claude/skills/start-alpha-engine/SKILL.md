---
name: start-alpha-engine
description: Start AlphaEngine locally — boot the desk workspace and the FastAPI risk gateway, then report the URLs. Use whenever the user says start, run, boot, launch, spin up, serve, "get it running", "npm run dev", "start the app", "start the server", "start the gateway", "run the desk", "run it locally", "how do I see it", or asks why localhost:3000 is empty, why the gateway is not connecting, or why a venv spawn fails with ENOENT. Creates the virtualenv at the one path the dev scripts accept, installs the tested dependency set, and states exactly what works without any API keys.
---

# Start AlphaEngine

The workspace runs with **zero configuration**. Do not ask the user for API
keys, a database, or a `.env` file before starting — none are required.

## Decide the scope first

Ask, or infer from the request:

- **Web only** (default; ~2 minutes). Full eight-tab desk on generated data.
  Everything is navigable; writes are disabled outside the `live` tier.
- **Full stack** (~10 minutes). Adds the Python gateway, so Portfolio, Risk,
  Execution and Reliability read a real book.

If the user just said "start it", do web only, tell them the data is generated,
and offer the gateway as a next step.

## Web only

```bash
cd Part2_Infrastructure/web
npm install          # npm, not yarn or pnpm — package-lock.json is committed
npm run dev
```

Node 22 (`.nvmrc` at the repo root; `nvm use` if nvm is present). If port 3000
is taken, use `PORT=3100 npm run dev` and report the port you actually used.

Report to the user:

- **http://localhost:3000**
- They land on a sign-in page that says accounts are not configured in this
  deployment and offers one button, **Open the workspace**. That is expected,
  not a misconfiguration — the edge mints a guest desk pass rather than bouncing
  them to a form that cannot sign them in.
- The book is a deterministic browser-generated sandbox, clearly tagged as
  generated. Writes are disabled outside `live`.

## Full stack

### The venv name is load-bearing — check this before anything else

```bash
ls Part2_Infrastructure/venv/bin/python
```

It must be **exactly** `Part2_Infrastructure/venv`. `web/package.json`'s
`dev:gateway` runs `cd .. && ./venv/bin/python`, and
`web/scripts/start-dev-all.mjs` spawns `resolve(rootDir, "venv/bin/python")`
with no existence check and no `error` handler on the child. A `.venv`, a conda
env or a uv env gives an unhandled `ENOENT` that reads like a Node crash.

If it is missing or wrongly named, create it:

```bash
cd Part2_Infrastructure
python3.12 -m venv venv                       # 3.12 — matches CI and OpenBB_Service
venv/bin/python -m pip install --upgrade pip
venv/bin/python -m pip install -r requirements-core.txt
```

Use `requirements-core.txt`. The full `requirements.txt` pulls vectorbt and
numba, which often fail to build from source; without them the backtester uses
its built-in NumPy engine and every number is identical. If the user wants to
lint too, use `requirements-dev.txt` (core plus `ruff`).

If the user already has a `.venv` or a conda env, do not try to make the scripts
find it. Create `venv` at the correct path — that is the supported layout.

### Boot both

Prefer two background processes so their logs stay separable:

```bash
cd Part2_Infrastructure && venv/bin/python -m uvicorn main:app --reload --port 8000
cd Part2_Infrastructure/web && npm run dev
```

Run the gateway with `Part2_Infrastructure` as the working directory — it
resolves the DuckDB audit log relative to itself.

`npm run dev:all` from `web/` does both in one process, which is fine when it
works and hard to diagnose when it does not.

### Confirm it is actually up

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/api/portfolio
```

Both should be 200. The web app finds the gateway with no configuration: with
`ALPHAENGINE_GATEWAY_URL` unset it falls back to `http://127.0.0.1:8000`, but
only when `NODE_ENV=development` — see `gatewayState()` in `web/lib/gateway.ts`.

Report:

| | |
|---|---|
| Desk workspace | http://localhost:3000 |
| Gateway API | http://127.0.0.1:8000 |
| Gateway console | http://127.0.0.1:8000/app |
| OpenAPI docs | http://127.0.0.1:8000/docs |

## What works with no keys at all

Say this plainly — it is the point of the setup:

- All eight tabs, every panel, full navigation.
- Crypto quotes, bars and L2 depth via Binance's public endpoints.
- The whole gateway: risk gates, TCA, backtests, the DuckDB audit log.
- Unset provider keys produce an honest "not configured", never a blank panel
  and never a zero.

Keys only add breadth: equities and fundamentals (`FMP_API_KEY`,
`TIINGO_API_KEY`, `MASSIVE_API_KEY`, `ALPHAVANTAGE_API_KEY`), web search
(`FIRECRAWL_API_KEY`), vector research (`ORACLE_*`), the realtime tape and
optional sign-in (`NEXT_PUBLIC_SUPABASE_*`).

## If something breaks

- **`ENOENT` spawning python** — wrong venv name. See above.
- **Every panel says the data is generated** — the gateway is not running or not
  reachable. Check `curl http://127.0.0.1:8000/health`.
- **Gateway returns 401 and the desk drops to the sandbox** — there is a
  `Part2_Infrastructure/.env` with `REQUIRE_AUTH=1` and no matching
  `ALPHAENGINE_GATEWAY_TOKEN` on the web side. On a fresh clone with no `.env`
  the gateway is open on localhost (`config.py:292` defaults it off). Either set
  both sides to the same token, or remove the `.env`. Never suggest copying
  `.env.example` to `.env` to "fix" a local setup — that file ships
  `REQUIRE_AUTH=1` and causes this exact failure.
- **`npm run lint` — missing script** — correct, there is none. Linting is
  `venv/bin/python -m ruff check .` from `Part2_Infrastructure`.

Do not add dependencies, edit `package.json`, or write a `.env` to get it
running. If it does not start, the cause is one of the four above.
