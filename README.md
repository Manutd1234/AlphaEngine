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

Full documentation: [`web/README.md`](web/README.md)

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
