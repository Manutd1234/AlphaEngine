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

```bash
cd OpenBB_Service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app:app --reload --port 8010
pytest        # 14 passed (2026-08-17)
```

The automated tests replace the provider fetchers with deterministic fakes and
never call Yahoo. A post-deployment smoke test should exercise one real symbol
for each capability because Yahoo availability is external state.

## Deploy independently to Vercel

Create a separate Vercel project and set its Root Directory to
`OpenBB_Service`. FastAPI is detected from `[tool.vercel].entrypoint` and the
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
