# AlphaEngine OpenBB Service

A standalone, stateless and read-only FastAPI service for AlphaEngine market
research. It has no trading routes, Telegram lifecycle, portfolio state,
database, background worker, or writable runtime files.

The service uses the OpenBB YFinance provider's fetcher classes directly. It
does **not** import `openbb.obb`, run `openbb-build`, or create OpenBB's extension
map during a cold start. The complete `openbb` metapackage is intentionally not
installed; only the pinned provider runtime is included:

- `openbb-core==1.6.13`
- `openbb-yfinance==1.6.3`
- `yfinance==1.5.2`

## API contract

The routes are compatible with AlphaEngine's existing OpenBB adapter:

```text
GET /api/research/openbb/health
GET /api/research/openbb/quote?symbol=AAPL&asset=equity
GET /api/research/openbb/bars?symbol=AAPL&asset=equity&interval=1d&limit=500
GET /api/research/openbb/news?symbols=AAPL,MSFT&limit=20&asset=equity
GET /api/research/openbb/fundamentals?symbol=AAPL
```

`asset=crypto` on `news` spells each symbol the way YFinance names a pair
(`BTCUSDT` → `BTC-USD`), as `quote` and `bars` already did; the default is
`equity`, so an existing caller is unaffected.

Successful data calls return `{"ok":true,"data":...}`. A downstream provider
failure returns HTTP 200 with `{"ok":false,"error":"..."}` so AlphaEngine can
fail over to another data provider. Invalid caller input remains HTTP 422.

`GET /healthz` is an unauthenticated process-liveness route. It does not claim
that Yahoo is reachable. The OpenBB readiness route imports and verifies the
pinned provider classes. In production,
`.github/workflows/openbb-keepalive.yml` pings `/healthz` every ten minutes to
hold the function warm — a cold start pays the OpenBB import in full, and that
multi-second sample would otherwise land honestly in the desk's upstream
latency tail.

## Authentication

Set `OPENBB_API_TOKEN` to require `Authorization: Bearer <token>` on every
OpenBB route. When it is unset, the service is public but remains read-only.
Production should always set a long random token. `/healthz` remains public for
platform health checks and contains no provider or environment details.

## Local run and tests

One command, from a clean checkout. It creates the virtualenv, installs the
pinned set, runs the offline suite and then serves:

```bash
cd OpenBB_Service
./scripts/dev.sh            # http://127.0.0.1:8010
./scripts/dev.sh 8011       # a different port, when 8010 is taken
```

It is idempotent — a second run reuses the virtualenv it made. The long form,
if you would rather see each step:

```bash
cd OpenBB_Service
python3.12 -m venv .venv            # pyproject requires >=3.12,<3.15
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest          # 14 passed (re-measured 2026-08-22)
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8010
```

`python3.12` by name, not `python3`. This service pins `>=3.12,<3.15`, and 3.12
is what the repository's root venv, CI and the Vercel runtime use; a bare
`python3` on a developer machine is often something else.

`.venv/` is gitignored, which is correct — but it is why the previous round
recorded this service's blocker as *"no checked-in environment"*. Five pinned
packages and no way in the tree to turn them into a running process meant every
route was unverified. `scripts/dev.sh` is the part that was missing.

Point the web app at it with `OPENBB_API_URL=http://127.0.0.1:8010` in
`web/.env.local`. No token is needed locally: `require_bearer` returns
immediately when `OPENBB_API_TOKEN` is empty, and the provider calls YFinance
with `credentials=None`, so the service needs no secret of any kind to serve
real data.

### The offline suite proves less than it looks like it does

`pytest` replaces the provider fetchers with deterministic fakes and never calls
Yahoo — deliberately, because a test suite that depends on an external vendor's
availability reports the vendor's bad afternoon as your bug. The consequence is
that **it passes in an environment that cannot serve a single real quote.** It
did exactly that for a whole round, and it also passes from the repository's
root venv, which does not have `openbb-yfinance` installed at all.

So the suite is not evidence that this service works. That is what the smoke
test is for.

### Smoke test — and why HTTP 200 is not the thing it checks

```bash
.venv/bin/python scripts/smoke.py                             # 127.0.0.1:8010
.venv/bin/python scripts/smoke.py https://openbb.example.com  # a deployment
OPENBB_API_TOKEN=… .venv/bin/python scripts/smoke.py https://openbb.example.com
```

It exercises one real symbol per capability in both asset classes, reads `ok`
rather than the status line, and treats an empty payload as a failure. Measured
against a local run on 2026-08-20:

```text
  ✓ health         HTTP 200 provider='yfinance' versions={openbb_core 1.6.13, openbb_yfinance 1.6.3, yfinance 1.5.2}
  ✓ quote equity   HTTP 200 price=316.26
  ✓ quote crypto   HTTP 200 price=72195.0
  ✓ bars equity    HTTP 200 30 rows
  ✓ bars crypto    HTTP 200 30 rows
  ✓ news           HTTP 200 5 rows
  ✓ fundamentals   HTTP 200 name='Apple Inc.'

  7/7 routes answered with real data.
```

## The 200 envelope is deliberate, and it has a cost

`_envelope` catches `ProviderUnavailable` and answers HTTP **200** with
`{"ok": false, "error": …}`. An honest case exists for a 502 instead, and this
service keeps the 200 for one reason: *the failure is not this service's.* A
5xx would be counted against this deployment by the web app's circuit breaker
(`web/lib/providers/runtime.ts`), by `openBBReadiness`, and by any platform health
check — taking a healthy service out of rotation because Yahoo rate-limited a
symbol. Choosing another data provider is a routing decision, and routing needs
a body it can read rather than a status it has to guess from.

The cost is real and is stated here rather than glossed: **a 200 from this
service proves nothing.** A rate limit, a delisted symbol and a working call all
return it. So every reader of this envelope has to read `ok`, and each one that
does is written down:

| Reader | What it reads |
|---|---|
| `web/lib/providers/openbb.ts` — `assertOk` | throws on `ok:false`, and reads the message to tell a real outage from "no data for this symbol" |
| `web/lib/providers/raw-contracts-rest.ts` — `checkOpenBBRaw` | records `raw.openbb.declined` so the ledger can tell a refusal from an empty result |
| `web/scripts/capture-provider-fixtures.mjs` | refuses to write a fixture unless `body.ok === true` |
| `scripts/smoke.py` | fails the route, and says `ok=False` with the error text |

Anything new that checks this service by status code alone is wrong, and the
table above is where to add yourself.

## The `openbb-api` CLI is not what this service uses

<https://docs.openbb.co/odp/python/extensions/interface/openbb-api> documents a
CLI that turns an arbitrary FastAPI app into an **OpenBB Workspace backend**:
`openbb-api --app ./some_file.py --host 0.0.0.0 --port 8005`, defaulting to
`127.0.0.1:6900` and falling back to the next free port, building a
`widgets.json` from the app's routes.

It is not applicable here, for three reasons:

1. **Different consumer.** A Workspace backend serves widget definitions to
   OpenBB Workspace. This service serves JSON to AlphaEngine's Next.js adapter,
   whose route shapes are pinned by `web/lib/providers/openbb.ts` and by
   `web/tests/fixtures/raw/openbb/quote.json`. Nothing renders a widget.
2. **It is not installed, on purpose.** `openbb-api` ships with the `openbb`
   metapackage, not with `openbb-core`; the pinned set here provides only
   `openbb-build`. `tests/test_provider.py` asserts `openbb==` is absent from
   `requirements.txt` precisely so a cold start never runs an SDK build or needs
   a writable home directory.
3. **`widgets.json` is state.** Building one at start-up contradicts the
   stateless, read-only, no-writable-files design the rest of this README
   describes.

What *is* worth taking from that page is the launch convention — an explicit
`--host`/`--port` on a single FastAPI app — which `scripts/dev.sh` follows. The
port is 8010, this repository's own documented choice, not the CLI's 6900:
6900 is the default of a tool we do not run, and its "fall back to the next free
port" behaviour would be actively wrong here, because `OPENBB_API_URL` names one
fixed port and a service that silently moved would read as unreachable.

## The raw fixture

`web/tests/fixtures/raw/openbb/quote.json` is a real healthy body from this
service, captured with the service running locally:

```bash
cd OpenBB_Service && ./scripts/dev.sh          # one shell
cd web && node scripts/capture-provider-fixtures.mjs openbb   # another
```

The capture asserts `body.ok === true` before writing, so a rate-limited Yahoo
cannot be committed as a healthy fixture. That committed body is what promotes
`openbb` into `RAW_CALIBRATED` in `web/lib/providers/raw-contracts-rest.ts`: a
predicate may only raise `fatal` once a real good body has been through it,
because a validator that has never seen one must not be able to reject one.

## Deploy independently to Vercel

Create a separate Vercel project and set its Root Directory to
`Part2_Infrastructure/OpenBB_Service` — the repository root is one level above
`Part2_Infrastructure`, which is why the gateway README's §11 spells it the same
way. A Root Directory of `OpenBB_Service` is only correct if this directory is
itself the repository root, which in this deliverable it is not. FastAPI is detected from `[tool.vercel].entrypoint` and the
included `vercel.json` gives the function a 30-second ceiling. Add
`OPENBB_API_TOKEN` as a sensitive Production and Preview environment variable,
then deploy.

In the existing AlphaEngine web project, set these server-only variables and
redeploy:

```text
OPENBB_API_URL=https://<openbb-service-domain>
OPENBB_API_TOKEN=<same token configured on this service>
```

Do not prefix either variable with `NEXT_PUBLIC_`. The browser should continue
to call AlphaEngine's same-origin Next.js routes; only those server routes call
this service.
