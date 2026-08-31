import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type RGB,
  SHARPE_RAMP_DARK,
  SHARPE_RAMP_LIGHT,
  divergingScale,
  mixOklab,
  oklabToSrgb,
  rampStops,
  readableRampInk,
  srgbToOklab,
} from "../lib/colormap";
import { globalsCss } from "./globals-css";
import { blockAfter, tokensIn } from "./helpers/css-tokens";

const ANCHORS: RGB[] = [
  SHARPE_RAMP_LIGHT.neg,
  SHARPE_RAMP_LIGHT.mid,
  SHARPE_RAMP_LIGHT.pos,
  SHARPE_RAMP_DARK.neg,
  SHARPE_RAMP_DARK.mid,
  SHARPE_RAMP_DARK.pos,
];

const parseRgb = (s: string): RGB => {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(s);
  assert.ok(m, `not an rgb(int,int,int) string: ${s}`);
  return [Number(m![1]), Number(m![2]), Number(m![3])];
};

const parseHex = (value: string): RGB => {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  assert.ok(match, `not a six-digit hex colour: ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(match![1].slice(offset, offset + 2), 16)) as RGB;
};

const luminance = ([r, g, b]: RGB): number => {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrast = (a: RGB, b: RGB): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("oklab conversion", () => {
  it("mirrors the CSS diverging anchors and round-trips them within 1/255", () => {
    const palettes = [
      [SHARPE_RAMP_LIGHT, tokensIn(blockAfter(globalsCss, ":root {"))],
      [SHARPE_RAMP_DARK, tokensIn(blockAfter(globalsCss, ':root[data-theme="dark"]'))],
    ] as const;

    for (const [ramp, tokens] of palettes) {
      assert.deepEqual(ramp.neg, parseHex(tokens.get("--diverging-neg") ?? ""));
      assert.deepEqual(ramp.mid, parseHex(tokens.get("--diverging-mid") ?? ""));
      assert.deepEqual(ramp.pos, parseHex(tokens.get("--diverging-pos") ?? ""));
    }

    for (const rgb of ANCHORS) {
      const back = oklabToSrgb(srgbToOklab(rgb));
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(back[i] - rgb[i]) <= 1, `${rgb} → ${back}`);
      }
    }
  });

  it("mix endpoints reproduce the inputs", () => {
    const a: RGB = [227, 73, 72];
    const b: RGB = [37, 99, 235];
    assert.deepEqual(mixOklab(a, b, 0), oklabToSrgb(srgbToOklab(a)));
    assert.deepEqual(mixOklab(a, b, 1), oklabToSrgb(srgbToOklab(b)));
  });
});

describe("diverging scale", () => {
  it("zero maps to the midpoint, the extremes to the poles", () => {
    for (const ramp of [SHARPE_RAMP_LIGHT, SHARPE_RAMP_DARK]) {
      const scale = divergingScale(2, ramp);
      assert.deepEqual(parseRgb(scale(0)), oklabToSrgb(srgbToOklab(ramp.mid)));
      assert.deepEqual(parseRgb(scale(2)), oklabToSrgb(srgbToOklab(ramp.pos)));
      assert.deepEqual(parseRgb(scale(-2)), oklabToSrgb(srgbToOklab(ramp.neg)));
    }
  });

  it("clamps beyond the range and survives absMax = 0", () => {
    const scale = divergingScale(1, SHARPE_RAMP_LIGHT);
    assert.equal(scale(5), scale(1));
    assert.equal(scale(-5), scale(-1));
    const flat = divergingScale(0, SHARPE_RAMP_LIGHT);
    assert.equal(flat(3), flat(0));
    assert.ok(!flat(3).includes("NaN"));
  });

  it("lightness is monotone along each arm", () => {
    for (const ramp of [SHARPE_RAMP_LIGHT, SHARPE_RAMP_DARK]) {
      const scale = divergingScale(1, ramp);
      for (const sign of [1, -1]) {
        const pole = sign > 0 ? ramp.pos : ramp.neg;
        const dir = Math.sign(srgbToOklab(pole)[0] - srgbToOklab(ramp.mid)[0]);
        let prev = srgbToOklab(parseRgb(scale(0)))[0];
        for (let i = 1; i <= 20; i++) {
          const L = srgbToOklab(parseRgb(scale((sign * i) / 20)))[0];
          // Allow a hair of slack for 8-bit channel rounding.
          assert.ok(
            (L - prev) * dir >= -2e-3,
            `${sign > 0 ? "pos" : "neg"} arm not monotone at step ${i}`,
          );
          prev = L;
        }
      }
    }
  });

  it("legend stops span pole to pole", () => {
    const stops = rampStops(SHARPE_RAMP_LIGHT, 9);
    assert.equal(stops.length, 9);
    assert.equal(stops[0], divergingScale(1, SHARPE_RAMP_LIGHT)(-1));
    assert.equal(stops[8], divergingScale(1, SHARPE_RAMP_LIGHT)(1));
    for (const s of stops) parseRgb(s);
  });

  it("chooses AA ink across every sampled cell in both themes", () => {
    const cases = [
      [false, SHARPE_RAMP_LIGHT, tokensIn(blockAfter(globalsCss, ":root {"))],
      [true, SHARPE_RAMP_DARK, tokensIn(blockAfter(globalsCss, ':root[data-theme="dark"]'))],
    ] as const;

    const inherited = tokensIn(blockAfter(globalsCss, ":root {"));
    for (const [isDark, ramp, tokens] of cases) {
      const scale = divergingScale(1, ramp);
      for (let index = -100; index <= 100; index += 1) {
        const fill = scale(index / 100);
        const inkRole = readableRampInk(fill).match(/var\((--[\w-]+)\)/)?.[1];
        assert.ok(inkRole, `no token returned for ${fill}`);
        const ratio = contrast(parseHex(tokens.get(inkRole!) ?? inherited.get(inkRole!) ?? ""), parseRgb(fill));
        assert.ok(ratio >= 4.5, `${isDark ? "dark" : "light"} ${fill} with ${inkRole} is ${ratio.toFixed(2)}:1`);
      }
    }
  });
});
