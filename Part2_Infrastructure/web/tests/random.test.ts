import { test } from "node:test";
import assert from "node:assert/strict";

import { mulberry32, seedFromString } from "../lib/random";
import { syntheticBars } from "./helpers/synthetic-bars";

test("mulberry32 stream is pinned (refactor regression)", () => {
  // First draws for seed 1 — the sequence syntheticBars has produced since the
  // PRNG was inlined. If these change, every synthetic dataHash changes.
  const rand = mulberry32(1);
  const got = [rand(), rand(), rand(), rand()];
  const expected = [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741];
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(got[i] - expected[i]) < 1e-15, `draw ${i}: ${got[i]} != ${expected[i]}`);
  }
});

test("seed 0 is remapped, not degenerate", () => {
  const zero = mulberry32(0);
  const one = mulberry32(1);
  assert.equal(zero(), one());
});

test("seedFromString matches the historical 31-multiplier hash", () => {
  let seed = 0;
  const s = "BTCUSDT";
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
  assert.equal(seedFromString(s), seed);
  assert.notEqual(seedFromString("BTCUSDT"), seedFromString("ETHUSDT"));
});

test("syntheticBars is reproducible across calls", () => {
  const a = syntheticBars("BTCUSDT", "4h", 500);
  const b = syntheticBars("BTCUSDT", "4h", 500);
  assert.equal(a.length, 500);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].c, b[i].c, `close ${i} differs`);
    assert.equal(a[i].v, b[i].v, `volume ${i} differs`);
  }
});

test("synthetic timestamps are quantised to the bar interval", () => {
  const stepMs = 144e5; // 4h
  const bars = syntheticBars("ETHUSDT", "4h", 50);
  for (const bar of bars) {
    assert.equal(bar.t % stepMs, 0, `timestamp ${bar.t} not on a 4h boundary`);
  }
});

test("different symbols seed different series", () => {
  const btc = syntheticBars("BTCUSDT", "4h", 10);
  const eth = syntheticBars("ETHUSDT", "4h", 10);
  assert.notEqual(btc[0].c, eth[0].c);
});
