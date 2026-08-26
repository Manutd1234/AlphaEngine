/**
 * A label drawn above a plot is inside the plot's own viewBox.
 *
 * THE DEFECT, reported as "the diagrams are cut off" with two screenshots.
 * Fees → Cost shape draws the parabola's peak reading — "0.0175 per contract" —
 * at `y(peak) - 3`, and `y(peak)` IS `MARGIN.top` by construction, because the
 * peak is what the vertical scale is normalised to. `MARGIN.top` was 12, so the
 * baseline sat at y=9; the string sets on the 14px `--fs-diagram-legend` rung,
 * and a 14px face carries roughly eleven pixels of ascender above its baseline.
 * The text was therefore drawn from y=-2 and `<svg viewBox="0 0 w h">` cut the
 * top third off every glyph. Lattice → Survival had the same arithmetic at
 * `MARGIN.top - 8` over a top of 16.
 *
 * WHY NOTHING CAUGHT IT. SVG text neither wraps nor clips itself and `npm test`
 * has no DOM (CLAUDE.md, fact 6), so there is no render to measure and no
 * overflow to observe. The only checkable form of "it fits" is the arithmetic
 * that decides it, which is what this file reads.
 *
 * THE RULE. A `<text>` whose `y` is `MARGIN.top - k` has a baseline at
 * `top - k`, and every pixel of ascender above that baseline is outside the
 * viewBox. Ascender is under one em for every face on this desk, so requiring
 * `top - k >= rung` is the conservative form: it reserves a full em where about
 * 0.8 is used, and it is one number a reader can check by eye.
 *
 * DERIVED, NEVER OBSERVED. This proves the margin clears the rung, not that a
 * reader saw the label. Both figures above were also screenshotted at 1440px
 * before and after, which is the half no repository test can do.
 *
 * NOT AN ALLOW-LIST. Four figures were failing when this was written and all
 * four were fixed in the same change — two on Quotes and two on Proofs — rather
 * than recorded as exemptions. A margin guard with known holes in it is a guard
 * that gets read as noise the first time it fires.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DIAGRAM_LABEL_PX, DIAGRAM_LEGEND_PX } from "../lib/coherence/label-metrics";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * The rung each in-plot text class sets at, in pixels.
 *
 * The two diagram rungs come from `label-metrics`, which mirrors
 * `14r-coherence-density.css` and is itself pinned against the stylesheet — so
 * a rung that moves moves here too rather than being restated a third time.
 * `--fs-tick` is `:root`'s 10px SVG floor and is not on the diagram ladder.
 */
const TICK_PX = 10;
const RUNG: Record<string, number> = {
  "coh-figure__key": DIAGRAM_LEGEND_PX,
  "coh-svg-note": DIAGRAM_LEGEND_PX,
  // Added 2026-08-25 with `ReturnFan`, which titles its y axis with it. The
  // class already existed and reads the 13px label rung at `14r:183`; the map
  // simply had not been taught it, so its labels were going unchecked.
  "coh-svg-label": DIAGRAM_LABEL_PX,
  // The fan's panel header, added 2026-08-26 when the refused count moved off
  // the axis row and onto it. Both read `--fs-sm`, which is this rung.
  "diff-fan__head": DIAGRAM_LABEL_PX,
  "diff-fan__count": DIAGRAM_LABEL_PX,
  // The watch's poll count, added 2026-08-26 with the recorder clock. Reads
  // `--fs-sm`, the same rung.
  "diff-watch__count": DIAGRAM_LABEL_PX,
  "coh-axis__label": DIAGRAM_LABEL_PX,
  "coh-surface__value": DIAGRAM_LABEL_PX,
  "coh-surface__rise": DIAGRAM_LABEL_PX,
  "coh-calib__barlabel": DIAGRAM_LABEL_PX,
  // `diff-time__label` left with `StageTimeline` on 2026-08-26; `StageWindows`
  // draws the same rung under its own name.
  "diff-win__label": DIAGRAM_LABEL_PX,
  // The Control view's head row, 2026-08-26. Both read `--fs-sm`.
  "diff-floor__head": DIAGRAM_LABEL_PX,
  "diff-floor__count": DIAGRAM_LABEL_PX,
  "coh-surface__tick": TICK_PX,
  "coh-ladder__tick": TICK_PX,
  // The decade scale's axis words, added 2026-08-26 with `ShortfallScale`. The
  // one it draws above `MARGIN.top` is the label for the band that holds
  // anything under a tick — it moved there because under the band it shared a
  // baseline with the first decade tick and the two printed over each other.
  "coh-decade__tick": TICK_PX,
  // The mixture figure's axis words, added 2026-08-26 with `CorpusShares`. The
  // one above `MARGIN.top` labels the dashed rule at a slope of one, which is
  // the only position on that axis with a name.
  "coh-mix__tick": TICK_PX,
};

function figures(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...figures(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

interface Label {
  readonly where: string;
  readonly baseline: number;
  readonly rung: number;
  readonly className: string;
}

/** Every `<text y={SOMEMARGIN.top - k}>` in the engine, with the rung it sets at. */
function labelsAbovePlot(source: string, file: string): Label[] {
  const margins = new Map<string, number>();
  for (const [, name, top] of source.matchAll(/const (\w*MARGIN) = \{[^}]*?top:\s*(\d+)/g)) {
    margins.set(name, Number(top));
  }
  if (!margins.size) return [];

  const found: Label[] = [];
  for (const match of source.matchAll(/<text\b[^>]*?\/?>/gs)) {
    const tag = match[0].replace(/\s+/g, " ");
    const y = tag.match(/y=\{(\w*MARGIN)\.top\s*-\s*(\d+)\}/);
    if (!y) continue;
    const top = margins.get(y[1]);
    if (top === undefined) continue;
    const className = tag.match(/className="([^"]+)"/)?.[1] ?? "";
    const rung = Math.max(0, ...className.split(/\s+/).map((name) => RUNG[name] ?? 0));
    // A class this map has not been taught is not silently scored as zero —
    // the coverage assertion below is what catches that, so it is left out
    // here rather than passing on a rung of nothing.
    if (!rung) continue;
    const line = source.slice(0, match.index).split("\n").length;
    found.push({ where: `${file}:${line}`, baseline: top - Number(y[2]), rung, className });
  }
  return found;
}

const ALL = figures(join(root, "components/coherence"))
  .flatMap((file) => labelsAbovePlot(readFileSync(file, "utf8"), file.slice(root.length)));

describe("no figure draws a label off the top of its own viewBox", () => {
  it("finds the labels it is meant to be checking", () => {
    // A scan that matched nothing would make the assertion below vacuously
    // true, which is the shape of dead test this repository keeps catching.
    assert.ok(
      ALL.length >= 6,
      `only ${ALL.length} above-plot labels found — the scan has stopped reading the figures`,
    );
  });

  it("every above-plot baseline clears the rung it sets at", () => {
    const clipped = ALL
      .filter((label) => label.baseline < label.rung)
      .map((label) => `${label.where} — baseline ${label.baseline} under a ${label.rung}px rung (${label.className})`);
    assert.deepEqual(
      clipped,
      [],
      "these labels are drawn above y=0 and the viewBox cuts them off. Raise MARGIN.top "
        + "(and HEIGHT by the same amount, so the plot area is unchanged):\n  " + clipped.join("\n  "),
    );
  });

  it("the rung map still covers the classes the figures actually draw", () => {
    // The check above skips a class it does not know, so an unknown class is a
    // silent hole rather than a failure. This is what makes it loud: every
    // in-plot text class on the engine is either in RUNG or is a tick numeral
    // the ladder floors at 10px.
    const drawn = new Set<string>();
    for (const file of figures(join(root, "components/coherence"))) {
      const source = readFileSync(file, "utf8");
      if (!/const \w*MARGIN = \{[^}]*?top:/s.test(source)) continue;
      for (const match of source.matchAll(/<text\b[^>]*?\/?>/gs)) {
        const tag = match[0].replace(/\s+/g, " ");
        if (!/y=\{\w*MARGIN\.top\s*-\s*\d+\}/.test(tag)) continue;
        for (const name of (tag.match(/className="([^"]+)"/)?.[1] ?? "").split(/\s+/)) {
          if (name) drawn.add(name);
        }
      }
    }
    const unknown = [...drawn].filter((name) => !(name in RUNG)).sort();
    assert.deepEqual(
      unknown,
      [],
      `these in-plot classes have no rung here, so their labels are not being checked:\n  ${unknown.join("\n  ")}`,
    );
  });
});
