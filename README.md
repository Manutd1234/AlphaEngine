# AlphaEngine — NUSSIF Developer Analyst Case Study

Unified execution-quality, pre-trade-risk and strategy-research infrastructure,
reachable from a **Telegram bot**, a **Telegram Mini App** and a **Vercel web
portal**.

| | Module | Where it runs |
|---|---|---|
| **A** | Cross-venue TCA & L2 order-book depth (live Binance + Bybit) | gateway |
| **B** | Pre-trade risk gateway & emergency kill-switch | gateway |
| **C** | Asynchronous parametric backtesting, deflated for multiple testing | gateway **and** Vercel |

```
     Telegram bot            Telegram Mini App            Vercel research portal
   /kill /risk /tca         DOM · risk · research          trends · params · verdict
          │                          │                              │
          └────────────┬─────────────┘                              │
                       ▼                                            ▼
          FastAPI gateway (always-on)                    Next.js serverless
        A: L2 ingest, VWAP, smart routing                C: parameter sweeps
        B: 12 pre-trade gates, kill switch                  DSR + walk-forward
        C: vectorbt sweeps via job queue
                       │
              DuckDB audit log
```

---

## Two deployables

### 1. `Part2_Infrastructure/` — the gateway (Python / FastAPI)

Live order books, the risk gateway and the Telegram bot. Needs a long-lived
process: it holds WebSocket subscriptions open and keeps risk state between
requests.

```bash
cd Part2_Infrastructure
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add TELEGRAM_BOT_TOKEN to enable the bot
uvicorn main:app --port 8000  # portal at http://localhost:8000/app
pytest                        # 109 tests
```

Full documentation: [`Part2_Infrastructure/README.md`](Part2_Infrastructure/README.md)

### 2. `web/` — the research portal (Next.js / Vercel)

Module C as a standalone deployable. No backend, no database, no API keys.

**Deploy:** import this repo at <https://vercel.com/new> and set **Root
Directory** to `web`. Everything else auto-detects.

```bash
cd web
npm install
npm run dev    # http://localhost:3000
npm test       # 38 tests
```

Live-feed endpoints (public, no key):
`/api/ticker` · `/api/depth` · `/api/tca` · `/api/ohlcv` · `POST /api/backtest` ·
`/api/markets` for the index. Tick-by-tick L2 streams straight from the exchanges
to the browser, since a serverless function cannot hold a subscription open.

Full documentation: [`web/README.md`](web/README.md)

---

## Deployment

### Vercel — research portal (`web/`)

Set **Project → Settings → Build & Deployment → Root Directory** to `web`.
That is the only setting required; `web/` is a standard zero-config Next.js 15
app with no environment variables.

Deliberately **no `vercel.json`**. A root config that ran `cd web && npm install`
works only when the Root Directory is the repo root — once it is `web`, the build
already starts there and the same command fails with
`cd: web: No such file or directory`. Zero-config detection is correct under the
Root Directory setting and cannot drift out of sync with it.

`next` is pinned exactly (not `^`) so a deployment can never resolve to a
different build than the one tested here.

**Turn off Deployment Protection.** Settings → Deployment Protection → Vercel
Authentication → **Disabled**. While it is on, every request redirects to
`vercel.com/login`, so the Telegram Mini App webview opens a Vercel login page
instead of the portal, and the `/research` button does nothing useful. The portal
holds no secrets and has no mutating endpoints — the sweep API is a pure function
of its query — so there is nothing here that protection is buying.

### Telegram webhook — gateway

The bot runs in **webhook** mode whenever `PUBLIC_URL` is an `https://` origin,
and falls back to **long-polling** when it is not. Nothing else changes: every
command behaves identically on both transports.

The kill switch is why the webhook must point at the gateway and not at Vercel.
`/kill` has to reach the process that owns the risk state, and a serverless
function cannot hold that state (nor the L2 WebSocket subscriptions Module A
needs) between invocations.

Give the gateway a public HTTPS origin — free, no account:

```bash
cloudflared tunnel --url http://localhost:8000
#   https://<name>.trycloudflare.com
```

Put it in `.env` and restart; the bot registers the webhook itself on startup:

```bash
PUBLIC_URL=https://<name>.trycloudflare.com
RESEARCH_PORTAL_URL=https://<your-project>.vercel.app
TELEGRAM_MODE=auto        # -> webhook, because PUBLIC_URL is https
```

Verify Telegram's own view of it:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
# url set, pending_update_count 0, and no last_error_message
```

A quick tunnel's hostname changes each restart. For anything long-lived use a
named Cloudflare tunnel or a host with a stable domain, and update `PUBLIC_URL`.

Webhook requests are rejected unless they carry the
`X-Telegram-Bot-Api-Secret-Token` shared secret, so a forged POST to the public
URL cannot trip the kill switch.

---

## One engine, two implementations, one test that proves it

The gateway runs parameter sweeps through vectorbt/numba; Vercel's serverless
runtime cannot. So the engine is reimplemented in TypeScript — and
[`web/tests/parity.test.ts`](web/tests/parity.test.ts) replays real Binance bars
through it and asserts it reproduces what the Python reference produced from
identical input, across all three models and both directions.

That test caught two real bugs in the port. It is regenerated with:

```bash
cd Part2_Infrastructure && python tools/make_parity_fixture.py
```

---

## Security

- `.env` is gitignored. **No token, key or secret is committed** — the Telegram
  bot token lives only in a local `.env` and in the host's environment variables.
- Mini App requests are authenticated by re-deriving Telegram's `initData` HMAC;
  webhook requests are verified against a shared secret header.
- Risk limits are a frozen dataclass with env overrides: changing a hard limit
  requires a deploy, and therefore a code review.

---

## Submission checklist

| # | Item | Status |
|---|---|---|
| 1 | `CV_Ian_Wangsa.pdf` | _to add_ |
| 2 | `Part1_Data_Handling.ipynb` | _to add_ |
| 3 | `Part1_Data_Handling.html` | _to add_ |
| 4 | `Part2_Infrastructure/` + `web/` | **complete** |
