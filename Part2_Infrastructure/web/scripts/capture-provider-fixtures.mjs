/**
 * Capture real vendor responses as committed fixtures.
 * =====================================================
 *
 * A raw-schema validator with no corpus is untested code in the fetch path.
 * There were zero committed vendor bodies in this repository — for any of the
 * eight providers — so before anything can validate a raw payload, something
 * has to have seen one.
 *
 * Bodies are written verbatim. The point of a raw fixture is the SHAPE the
 * vendor actually sends, and a normalised or trimmed one tests the normaliser
 * rather than the vendor.
 *
 *   node scripts/capture-provider-fixtures.mjs
 *
 * ── Three classes of fixture, and why the distinction is load-bearing ───────
 *
 * KEYLESS      A healthy body from an endpoint that needs no credential at all.
 *              Anyone with a network connection can refresh these and there is
 *              no secret to leak.
 *
 * PUBLIC_DEMO  A healthy body obtained with a credential the VENDOR publishes
 *              for this purpose. Alpha Vantage's `apikey=demo` is documented on
 *              their own site and returns a genuine body for a fixed symbol.
 *              It is not this deployment's key and is not a secret.
 *
 * UNAUTHENTICATED  The vendor's REFUSAL envelope, captured on purpose by asking
 *              without a key. This is the half of a provider's contract that is
 *              usually never tested, and it is the half that breaks silently:
 *              FMP answers an invalid key with `{"Error Message": …}` — an
 *              OBJECT where the adapter indexes `rows[0]` — and Massive answers
 *              with `{"status":"ERROR"}` where the adapter reads `results`.
 *              A normaliser meeting either of those produces undefined fields
 *              rather than raising.
 *
 * The classes are kept apart on disk (`<capability>.json` versus
 * `unauthenticated.json`) because a refusal body must never be read as an
 * example of a healthy one. `tests/raw-contracts-rest.test.ts` asserts the
 * opposite thing of each: healthy fixtures must produce NO violation, refusal
 * fixtures must produce the specific one that names the refusal.
 *
 * ── What is still not captured, and why ────────────────────────────────────
 *
 * Tiingo, FMP and Massive have no public demo credential, so only their
 * refusals are committed — their healthy path is unverified and their
 * predicates therefore stay at `warn` (see RAW_CALIBRATED in
 * lib/providers/raw-contracts-rest.ts). OpenBB is this project's own stateless
 * service rather than a vendor API, so capturing it means running
 * OpenBB_Service.
 *
 * KEYED       A healthy body needing THIS deployment's credential, read from
 *             `.env.local`. Skipped with a stated reason when the key is
 *             absent, which is the normal case and not a failure — the keys are
 *             marked *Sensitive* in Vercel, which makes them write-only.
 *
 *             These are the ones to REVIEW BY HAND before committing: a keyed
 *             response can carry an account id, a plan name or a header
 *             echoing the key's identity, and none of that belongs in a
 *             fixture. `tests/raw-contracts.test.ts` enumerates the directory
 *             and refuses a credential, but it cannot recognise an account
 *             number.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "tests", "fixtures", "raw");

/**
 * Keys are read from `.env.local`, never from a committed file, and never
 * written into a fixture — `redact()` below strips them from the recorded URL.
 *
 * This exists because the keys are marked *Sensitive* in Vercel, which makes
 * them write-only: `vercel env pull` returns the literal string `[SENSITIVE]`.
 * So a fixture for a keyed provider cannot be captured by CI or by anyone
 * without the key in front of them, and the tool has to be usable the moment
 * somebody does have one rather than needing to be written first.
 */
function loadEnvLocal() {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].replace(/^"|"$/g, "");
    // `[SENSITIVE]` is what Vercel writes for a write-only variable. Treating
    // it as a key would send the literal string to the vendor and file the
    // 401 as though it were this deployment's.
    if (value && value !== "[SENSITIVE]" && !process.env[match[1]]) {
      process.env[match[1]] = value;
    }
  }
}
loadEnvLocal();

/** Healthy bodies. `expect` is the status that means the capture is valid. */
const TARGETS = [
  // ---- KEYLESS: public market data, no credential of any kind -------------
  {
    provider: "binance",
    capability: "bars",
    url: "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3",
    expect: 200,
  },
  {
    provider: "binance",
    capability: "quote",
    url: "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
    expect: 200,
  },
  {
    provider: "bybit",
    capability: "bars",
    url: "https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=60&limit=3",
    expect: 200,
  },
  {
    provider: "bybit",
    capability: "quote",
    url: "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT",
    expect: 200,
  },

  // ---- PUBLIC_DEMO: the vendor's own published demo credential ------------
  // Fixed to IBM because that is the symbol the demo key serves; asking for a
  // different one returns an advisory rather than a series, which would make
  // this a refusal fixture wearing a healthy fixture's filename.
  {
    provider: "alphavantage",
    capability: "bars",
    url: "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=IBM&apikey=demo",
    expect: 200,
  },
  {
    provider: "alphavantage",
    capability: "quote",
    url: "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=demo",
    expect: 200,
  },

  // ---- KEYLESS: an anonymous scrape of a domain that exists to be scraped -
  {
    provider: "firecrawl",
    capability: "news",
    url: "https://api.firecrawl.dev/v1/scrape",
    method: "POST",
    body: { url: "https://example.com" },
    expect: 200,
  },
];

/**
 * Refusal envelopes, captured by asking without a credential.
 *
 * `expect` is a NON-2xx status here, and a 200 is a failure: it would mean the
 * endpoint stopped requiring a key, and the body would be a healthy one filed
 * under a refusal's name.
 */
const REFUSALS = [
  {
    provider: "fmp",
    url: "https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=demo",
    expect: 401,
  },
  {
    provider: "tiingo",
    url: "https://api.tiingo.com/iex/?tickers=AAPL",
    expect: 403,
  },
  {
    provider: "massive",
    url: "https://api.massive.com/v2/aggs/ticker/X:BTCUSD/prev",
    expect: 401,
  },
];

/**
 * Healthy bodies that need THIS deployment's key. Skipped with a stated reason
 * when the key is absent, which is the normal case — never failed, because a
 * missing key is a fact about the environment rather than a broken capture.
 *
 * Review each one by hand before committing: a keyed response can carry an
 * account id, a plan name or a rate-limit header echoing the key's identity,
 * and none of that belongs in a fixture.
 */
const KEYED = [
  {
    provider: "tiingo",
    capability: "quote",
    env: "TIINGO_API_KEY",
    url: (key) => `https://api.tiingo.com/iex/?tickers=AAPL&token=${key}`,
  },
  {
    provider: "fmp",
    capability: "quote",
    env: "FMP_API_KEY",
    url: (key) => `https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=${key}`,
  },
  {
    provider: "fmp",
    capability: "bars",
    env: "FMP_API_KEY",
    url: (key) => `https://financialmodelingprep.com/api/v3/historical-chart/4hour/AAPL?apikey=${key}`,
  },
  {
    provider: "massive",
    capability: "bars",
    env: "MASSIVE_API_KEY",
    url: (key) => `https://api.massive.com/v2/aggs/ticker/X:BTCUSD/prev?apiKey=${key}`,
  },
  {
    provider: "openbb",
    capability: "quote",
    env: "OPENBB_API_URL",
    // Not a vendor: this project's own stateless service. The token is sent as
    // a header rather than in the URL, so there is nothing to redact.
    url: (base) => `${base.replace(/\/$/, "")}/api/quote?symbol=AAPL`,
    headers: () => (process.env.OPENBB_API_TOKEN
      ? { authorization: `Bearer ${process.env.OPENBB_API_TOKEN}` }
      : {}),
  },
];

const COMMENT =
  "Captured verbatim from the vendor by scripts/capture-provider-fixtures.mjs. "
  + "This is the SHAPE the vendor sends, not the shape this app normalises to — "
  + "trimming it would test the normaliser rather than the vendor. Refresh "
  + "deliberately: a change here is a change in what the vendor promises.";

const REFUSAL_COMMENT =
  "The vendor's REFUSAL envelope, captured on purpose by asking without a "
  + "credential. This is the half of the contract that breaks silently: the "
  + "shape here is NOT the shape the adapter expects, and a normaliser meeting "
  + "it produces undefined fields rather than raising. Never read this as an "
  + "example of a healthy body.";

/** The key never reaches a committed file, even when it is the public demo one. */
const redact = (url) =>
  url
    .replace(/([?&])(symbol|category|tickers)=[^&]*/g, "$1$2=…")
    .replace(/([?&])(apikey|token)=[^&]*/g, "$1$2=…");

function write(file, payload) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

let failures = 0;

async function capture(target, { refusal, optional = false }) {
  const name = `${target.provider}/${refusal ? "unauthenticated" : target.capability}`;
  try {
    const response = await fetch(target.url, {
      method: target.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(target.body ? { "content-type": "application/json" } : {}),
        ...(target.headers ?? {}),
      },
      ...(target.body ? { body: JSON.stringify(target.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== target.expect) {
      // Both directions are a failure. A healthy target that refuses has no
      // body worth committing; a refusal target that succeeds would file a
      // healthy body under a refusal's name, which is the one mistake these
      // fixtures exist to prevent.
      console.error(`  ${name}: HTTP ${response.status}, expected ${target.expect}`);
      if (!optional) failures += 1;
      return;
    }
    const body = await response.json();
    write(join(out, target.provider, `${refusal ? "unauthenticated" : target.capability}.json`), {
      _comment: refusal ? REFUSAL_COMMENT : COMMENT,
      _url: redact(target.url),
      _status: response.status,
      _captured: new Date().toISOString().slice(0, 10),
      body,
    });
    console.log(`  ${name}: written (HTTP ${response.status})`);
  } catch (cause) {
    // An optional capture that could not be reached is reported and does not
    // fail the run: OpenBB_Service not being up locally says nothing about the
    // four fixtures that were just refreshed.
    console.error(`  ${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
    if (!optional) failures += 1;
  }
}

for (const target of TARGETS) await capture(target, { refusal: false });
for (const target of REFUSALS) await capture(target, { refusal: true });

for (const target of KEYED) {
  const key = process.env[target.env];
  if (!key) {
    // Stated, not silent. A capture run that quietly skipped half the
    // providers would read as "all eight captured" in the scrollback.
    console.log(`  ${target.provider}/${target.capability}: skipped — ${target.env} is not set`);
    continue;
  }
  await capture({
    provider: target.provider,
    capability: target.capability,
    url: target.url(key),
    headers: target.headers?.(),
    expect: 200,
  }, { refusal: false, optional: true });
}

process.exit(failures ? 1 : 0);
