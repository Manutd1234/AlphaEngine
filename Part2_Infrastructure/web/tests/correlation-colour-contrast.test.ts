/**
 * The correlation cell uses two simultaneous readings: its printed coefficient
 * is ordinary text, while the composited fill is the graphical magnitude mark.
 * At the maximum authored alpha both must survive on the card plane.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CORR_ALPHA_MAX, corrFill } from "../lib/correlation";
import { globalsCss } from "./globals-css";
import { blockAfter, tokensIn } from "./helpers/css-tokens";

type RGB = [number, number, number];

function rgb(value: string | undefined): RGB {
  assert.match(value ?? "", /^#[0-9a-f]{6}$/i, `expected a six-digit colour, received ${value}`);
  return [1, 3, 5].map((offset) => Number.parseInt(value!.slice(offset, offset + 2), 16)) as RGB;
}

/** CSS color-mix with transparent retains the pole hue and changes its alpha. */
function composite(foreground: RGB, background: RGB, alpha: number): RGB {
  return foreground.map((channel, index) =>
    channel * alpha + background[index] * (1 - alpha)) as RGB;
}

function luminance(value: RGB): number {
  const channels = value.map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first: RGB, second: RGB): number {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

function maximumFill(value: 1 | -1): { token: string; alpha: number } {
  const rendered = corrFill(value);
  const match = /^color-mix\(in srgb, var\((--[a-z0-9-]+)\) (\d+)%, transparent\)$/.exec(rendered);
  assert.ok(match, `corrFill(${value}) emitted an unrecognised fill: ${rendered}`);
  return { token: match[1], alpha: Number(match[2]) / 100 };
}

const light = tokensIn(blockAfter(globalsCss, ":root {"));
const dark = tokensIn(blockAfter(globalsCss, ':root[data-theme="dark"]'));

describe("maximum correlation colour remains both readable and visible", () => {
  it("uses the exported alpha ceiling and the signed diverging poles", () => {
    assert.ok(CORR_ALPHA_MAX > 0 && CORR_ALPHA_MAX <= 100);
    assert.deepEqual(maximumFill(1), { token: "--diverging-pos", alpha: CORR_ALPHA_MAX / 100 });
    assert.deepEqual(maximumFill(-1), { token: "--diverging-neg", alpha: CORR_ALPHA_MAX / 100 });
  });

  for (const [theme, palette] of [["light", light], ["dark", dark]] as const) {
    for (const [sign, value] of [["positive", 1], ["negative", -1]] as const) {
      it(`${theme} ${sign}: coefficient text clears AA and the cell mark clears 3:1`, () => {
        const fillContract = maximumFill(value);
        const surface = rgb(palette.get("--surface-1"));
        const fill = composite(rgb(palette.get(fillContract.token)), surface, fillContract.alpha);
        const textRatio = contrast(rgb(palette.get("--text-primary")), fill);
        const markRatio = contrast(fill, surface);

        assert.ok(
          textRatio >= 4.5,
          `${theme} ${sign} coefficient is ${textRatio.toFixed(2)}:1 on the maximum correlation fill`,
        );
        assert.ok(
          markRatio >= 3,
          `${theme} ${sign} cell mark is ${markRatio.toFixed(2)}:1 against --surface-1`,
        );
      });
    }
  }
});

