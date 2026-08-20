/**
 * Capture real vendor responses as committed fixtures.
 * =====================================================
 *
 * A raw-schema validator with no corpus is untested code in the fetch path.
 * There were zero committed vendor bodies in this repository — for any of the
 * eight providers — so before anything can validate a raw payload, something
 * has to have seen one.
 *
 * Only the KEYLESS providers are captured here: Binance and Bybit serve their
 * public market endpoints without credentials, so these fixtures can be
 * refreshed by anyone with a network connection and no secret to leak. The
 * other six (Alpha Vantage, Tiingo, FMP, Massive, Firecrawl, OpenBB) need an
 * API key, and a fixture captured with one has to be reviewed by hand for
 * account identifiers before it can be committed — that is a deliberate act,
 * not something a script should do unattended.
 *
 * Bodies are written verbatim. The point of a raw fixture is the SHAPE the
 * vendor actually sends, and a normalised or trimmed one tests the normaliser
 * rather than the vendor.
 *
 *   node scripts/capture-provider-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "tests", "fixtures", "raw");

/** Keyless, public, documented. Anything needing a header does not belong here. */
const TARGETS = [
  {
    provider: "binance",
    capability: "bars",
    url: "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3",
  },
  {
    provider: "binance",
    capability: "quote",
    url: "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
  },
  {
    provider: "bybit",
    capability: "bars",
    url: "https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=60&limit=3",
  },
  {
    provider: "bybit",
    capability: "quote",
    url: "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT",
  },
];

let failures = 0;
for (const target of TARGETS) {
  try {
    const response = await fetch(target.url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`  ${target.provider}/${target.capability}: HTTP ${response.status}`);
      failures += 1;
      continue;
    }
    const body = await response.json();
    const file = join(out, target.provider, `${target.capability}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({
      _comment:
        "Captured verbatim from the vendor by scripts/capture-provider-fixtures.mjs. "
        + "This is the SHAPE the vendor sends, not the shape this app normalises to — "
        + "trimming it would test the normaliser rather than the vendor. Refresh "
        + "deliberately: a change here is a change in what the vendor promises.",
      _url: target.url.replace(/([?&])(symbol|category)=[^&]*/g, "$1$2=…"),
      _captured: new Date().toISOString().slice(0, 10),
      body,
    }, null, 2)}\n`);
    console.log(`  ${target.provider}/${target.capability}: written`);
  } catch (cause) {
    console.error(`  ${target.provider}/${target.capability}: ${cause instanceof Error ? cause.message : String(cause)}`);
    failures += 1;
  }
}
process.exit(failures ? 1 : 0);
