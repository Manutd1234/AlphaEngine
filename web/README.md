# AlphaEngine — Strategy Research Portal (Vercel)

The research half of AlphaEngine as a deployable Next.js app: pick a market and a
model, sweep a parameter grid, and get an explicit answer to **"does this
strategy actually work?"** — with the multiple-testing correction applied, not
just the headline Sharpe.

Deployed as a standalone app; it needs no backend, no database and no API keys.

---

## Deploy to Vercel

1. Import the GitHub repo at <https://vercel.com/new>.
2. Set **Root Directory** to `web`. Everything else auto-detects (Next.js 15).
3. Deploy. There are **no required environment variables**.

Locally:

```bash
cd web
npm install
npm run dev     # http://localhost:3000
npm test        # 55 tests, no network required
```

---

## What it does

**Trend & signal view** — price with the model's two indicator lines, and the
bars where it actually held a position shaded behind them. Two moving averages
crossing is abstract; "you were long here and flat there" is not.

**Parameter controls** — symbol, interval, history depth, model, direction, the
fast/slow grid (from / to / step for each), fees and slippage in bps, and the
number of walk-forward folds. The combination count updates live, because a wider
search is not free: it raises the statistical hurdle the winner has to clear.

**The verdict, stated first** — before any chart, the page says PASS / MARGINAL /
FAIL and why, showing four numbers side by side:

| | |
|---|---|
| In-sample Sharpe | the number a naive backtest would report |
| Hurdle from the search | what a *random* search of the same size would have produced |
| Deflated Sharpe (DSR) | P(true Sharpe > 0) after paying for that search |
| Walk-forward OOS Sharpe | measured on data the parameters never saw |

**Equity curve vs buy & hold**, indexed to 1 so both share one axis, with the
drawdown underneath in its own panel.

**Sharpe surface** over the whole grid. The shape is the message: a broad plateau
means the edge survives small parameter changes; a lone bright cell surrounded by
neutral is an overfit that happened to win this particular search. Click any cell
to re-run that single combination and see what it actually did.

**Walk-forward folds** and the **top-15 table** — the full ranking behind the
winner, and the in-sample → out-of-sample gap that reveals overfitting.

---

## API

Every endpoint is public, needs no key, and hits the exchanges live.
`GET /api/markets` returns this list at runtime.

| Endpoint | Returns |
|---|---|
| `GET /api/markets` | symbols, venues, strategies, limits, endpoint index |
| `GET /api/ticker?symbols=BTCUSDT,ETHUSDT` | last price, 24h change, high/low, volume |
| `GET /api/depth?symbol=&limit=&depth=` | live L2 book per venue **and** the consolidated ladder, with cumulative notional |
| `GET /api/tca?symbol=&side=&notional=` | VWAP, slippage in bps, fillability per venue, and the cross-venue routing split |
| `GET /api/ohlcv?symbol=&interval=&bars=` | historical candles |
| `POST /api/backtest` | parameter sweep with deflated Sharpe and walk-forward |

```bash
curl "https://<your-app>.vercel.app/api/tca?symbol=BTCUSDT&side=BUY&notional=100000"
```

### Streaming vs snapshots

A serverless function cannot hold a WebSocket subscription open between
invocations, so tick-by-tick L2 does not go through the API at all — the **Live
market** tab opens sockets straight from the browser to Binance and Bybit. No
backend, no key, no CORS (the WebSocket handshake is not subject to it), and one
hop of latency instead of two. `/api/depth` and `/api/tca` serve the same numbers
as REST snapshots for non-browser callers, computed with identical maths.

The arithmetic is a port of Module A in the Python gateway, and
`tests/venues.test.ts` replays the gateway's own hand-computed ladders through
it — so a slippage number here and one from the Telegram bot cannot disagree.

### Depth is measured in a price band, not a level count

`depthUsd` within **±10 bps of mid**, not "the top 20 levels". Level counts are
not comparable: 20 levels of a merged two-venue book spans a far narrower band
than 20 levels of one venue, and a fine-tick instrument packs more levels into
the same band. Measured by level count the same book read 93.9% bid-imbalanced;
measured in a band it reads +0.34, which is the number that means something.

---

## Architecture

```
web/
├── app/
│   ├── page.tsx              research console (client)
│   ├── layout.tsx            theme bootstrap, metadata
│   ├── globals.css           design tokens (palette, light + dark)
│   └── api/
│       ├── backtest/route.ts parameter sweep
│       ├── depth/route.ts    live L2 books + consolidated ladder
│       ├── tca/route.ts      VWAP, slippage, cross-venue route
│       ├── ticker/route.ts   last price and 24h stats
│       ├── markets/route.ts  endpoint + instrument index
│       └── ohlcv/route.ts    historical candles
├── lib/
│   ├── engine.ts             vectorised backtester — port of the Python reference
│   ├── indicators.ts         O(n) SMA / rolling extremes / RSI kernels
│   ├── stats.ts              PSR, Deflated Sharpe, verdict logic
│   ├── marketdata.ts         Binance klines + deterministic synthetic fallback
│   ├── venues.ts             live venue adapters + book/TCA maths
│   ├── livebook.ts           browser WebSocket L2 client (Binance + Bybit)
│   └── types.ts              shared contracts
├── components/               charts (hand-rolled SVG), controls, tables
└── tests/                    55 tests incl. cross-engine parity
```

**Why the sweep runs server-side.** Binance's public API is called from the
serverless function, not the browser: no CORS, the per-IP rate limit is pooled at
the function rather than spread across users' networks, and identical requests
are cached at the edge. A 74-combination sweep over 2000 bars takes **~20 ms**.

**Why the engine is reimplemented in TypeScript.** The Python gateway uses
vectorbt/numba, which cannot run in a serverless function. Two implementations of
the same accounting is two chances to be wrong, so
`tests/parity.test.ts` replays real Binance bars through the TS engine and
asserts it reproduces what `Part2_Infrastructure/modules/backtester.py` produced
from identical input — across all three models and both directions. Trade counts,
exposure and turnover must match exactly; return statistics to 1e-6.

That test earned its keep: it caught two real bugs in the port — pandas applies
the exit mask *after* the entry mask (so exit wins when both fire, which turned
RSI reversion from 2 trades into 70), and position must be driven by crossover
*events* rather than the raw comparison (otherwise long/short mode opens a short
the instant the warmup ends, on a signal that never fired).

Regenerate the fixture after changing either engine:

```bash
cd ../Part2_Infrastructure && python tools/make_parity_fixture.py
```

---

## Visualisation notes

Charts are hand-rolled SVG rather than a charting library, so the colour roles
survive contact with the defaults.

- **Categorical hues are assigned in fixed order and never cycled.** Strategy is
  always slot 1, benchmark always slot 2 — filtering or re-running never repaints
  a series.
- **One axis, always.** Strategy and buy & hold are indexed to 1 at t0 rather
  than plotted on two y-scales, which would invent a correlation that isn't in
  the data. Drawdown gets its own panel for the same reason.
- **The Sharpe surface is diverging, not a rainbow.** Sharpe is signed around a
  meaningful zero, so it uses two hues that read as opposite with a *neutral*
  midpoint — zero reads as "nothing". (A red-yellow-green ramp puts a hue at the
  midpoint, and yellow/green is the first pair colour-blind readers lose.)
- **Palette validated, not eyeballed.** The categorical slots clear the
  colour-vision-deficiency separation, lightness-band, chroma and contrast checks
  in both light and dark mode. One light-mode slot sits below 3:1 contrast, which
  obliges the relief rule — hence the direct end-labels on every series and a
  table view of every number.
- **Dark mode is selected, not inverted** — its own steps chosen for the dark
  surface, reachable via the OS setting or the header toggle.
- **Every chart has a hover layer**: crosshair and tooltip on the line charts,
  per-cell hover and click-through on the heatmap.

---

## Relationship to the rest of the system

This portal is Module C (research). The full AlphaEngine gateway in
[`../Part2_Infrastructure`](../Part2_Infrastructure) adds the two modules that
need a long-lived process, which is why they are not deployed here:

- **Module A** — live L2 order books from Binance and Bybit over WebSocket, with
  VWAP, slippage and cross-venue smart routing.
- **Module B** — a pre-trade risk gateway (12 gates in ~0.2 ms) with an emergency
  kill switch, driven from Telegram.

Serverless functions cannot hold a WebSocket subscription open or keep risk state
between invocations, so those run on the always-on gateway and are reachable from
the Telegram bot and its Mini App.
