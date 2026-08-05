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
  srgbToOklab,
} from "../lib/colormap";

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

describe("oklab conversion", () => {
  it("round-trips every ramp anchor within 1/255 per channel", () => {
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
});
