/**
 * Generates lib/seed-run.json — the clearly-labelled demo run the landing
 * page shows at first paint, before the live auto-sweep completes.
 *
 * Run manually and commit the output:
 *   node --import tsx scripts/generate-seed-run.ts
 *
 * Everything in the seed is real: the bars are the committed parity fixture's
 * recorded Binance BTCUSDT 4h series, the engine is the production `runSweep`,
 * and the result is deterministic in the data. The only thing that makes it a
 * "demo" is WHEN it was computed — which is exactly what its warning says.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSweep } from "../lib/engine";
import { DEFAULT_REQUEST, type Bar, type DataSource } from "../lib/types";

interface ParityCase {
  symbol: string;
  interval: string;
  strategy: string;
  direction: string;
  source: string;
  bars: Bar[];
}

const fixturePath = fileURLToPath(new URL("../tests/fixtures/parity.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { cases: ParityCase[] };

const seedCase = fixture.cases.find(
  (c) =>
    c.symbol === DEFAULT_REQUEST.symbol
    && c.interval === DEFAULT_REQUEST.interval
    && c.strategy === DEFAULT_REQUEST.strategy
    && c.direction === DEFAULT_REQUEST.direction,
);
if (!seedCase) throw new Error("parity.json no longer carries the default-request case");

const request = { ...DEFAULT_REQUEST, bars: seedCase.bars.length };
const result = runSweep(seedCase.bars, request, seedCase.source as DataSource, [
  "Seeded demo run — computed ahead of time from committed, recorded BTCUSDT bars so the first "
  + "paint shows real numbers. The live sweep replaces it automatically.",
]);

const seed = { ...result, seededDemo: true as const };
const outPath = fileURLToPath(new URL("../lib/seed-run.json", import.meta.url));
writeFileSync(outPath, `${JSON.stringify(seed)}\n`);

const kb = Math.round(Buffer.byteLength(JSON.stringify(seed)) / 1024);
console.log(
  `seed-run.json written: ${kb}KB · verdict ${result.verdict.level} · `
  + `OOS Sharpe ${result.walkForwardOosSharpe} · ${result.combosTested} combos on ${request.bars} bars`,
);
