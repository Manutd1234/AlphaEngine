/**
 * The type contract.
 *
 * Forty distinct font sizes had accumulated in one hand-written stylesheet —
 * a half-pixel px ramp, pt, em and rem all naming nearly the same steps, and
 * adjacent rungs (16px beside 17px, 19px beside 20px) that no reader could
 * tell apart and no author could choose between. The scale in `:root` is the
 * ramp the file already used most, made the only one; this file keeps it that
 * way, in the same regex-over-source style as `motion.test.ts`.
 *
 * Sanctioned exceptions, each annotated at its declaration: the print block
 * (pt is print typography), the brand and tech lettermarks and the donut's
 * curled micro-caption (logo/chart geometry, not reading text), and
 * `font-size: 0` (icon-text hiding).
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(root, "app/globals.css"), "utf8");

/** Comment bodies blanked, newlines kept — declarations only, lines intact. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

function lineOf(index: number): number {
  return css.slice(0, index).split("\n").length;
}

/** The `{ … }` body of the block starting at `index`, brace-matched. */
function blockBody(index: number): string {
  const open = declarations.indexOf("{", index);
  let depth = 0;
  for (let i = open; i < declarations.length; i++) {
    if (declarations[i] === "{") depth += 1;
    if (declarations[i] === "}") {
      depth -= 1;
      if (depth === 0) return declarations.slice(open, i + 1);
    }
  }
  assert.fail("unclosed block");
}

/** Declarations with the print block blanked — pt sizing is print typography. */
const screenDeclarations = (() => {
  const print = declarations.indexOf("@media print");
  if (print === -1) return declarations;
  const body = blockBody(print);
  return declarations.replace(body, body.replace(/[^\n]/g, " "));
})();

const RUNGS = [
  "--fs-tick", "--fs-2xs", "--fs-xs", "--fs-sm", "--fs-body", "--fs-md",
  "--fs-lg", "--fs-xl", "--fs-2xl", "--fs-title", "--fs-input", "--fs-h2",
  "--fs-h1", "--fs-figure", "--fs-display", "--fs-hero-line", "--fs-hero-sub",
  "--fs-hero",
] as const;

/** Inline chart/SVG sizes the components may use, in px. */
const INLINE_SIZES = new Set([9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 17, 20, 23, 28]);

/** Off-scale declarations sanctioned above, matched exactly. */
const SANCTIONED = new Set(["0", "7px", "7.5px", "25px"]);

describe("one type scale", () => {
  it("declares every rung in :root", () => {
    for (const token of RUNGS) {
      assert.match(
        declarations,
        new RegExp(`${token}:\\s*[^;]+;`),
        `${token} is missing from the type scale`,
      );
    }
  });

  it("every screen font-size reads from the scale", () => {
    const offenders: string[] = [];
    for (const match of screenDeclarations.matchAll(/font-size:\s*([^;]+);/g)) {
      const value = match[1].trim();
      if (value.startsWith("var(--fs-")) continue;
      if (SANCTIONED.has(value)) continue;
      offenders.push(`globals.css:${lineOf(match.index)} — font-size: ${value}`);
    }
    assert.deepEqual(
      offenders,
      [],
      `font sizes off the scale:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("keeps the sanctioned exceptions annotated where they stand", () => {
    // The allowlist above is only honest while each exception explains
    // itself at the declaration; an unexplained 7px is just a defect again.
    for (const selector of [".donut__label", ".brand-mark__alpha", ".tech-mark--sm .tech-mark__letters"]) {
      const at = css.indexOf(selector);
      assert.notEqual(at, -1, `${selector} has left the stylesheet — retire its allowlist entry`);
      const before = css.slice(Math.max(0, at - 400), at);
      const after = css.slice(at, at + 400);
      assert.match(
        before + after,
        /sanction|logo|geometry|not (reading )?text/i,
        `${selector} sits off the scale without saying why`,
      );
    }
  });

  it("reading text never drops below the 10px floor", () => {
    // --fs-tick is SVG chart furniture; no rung below it, and no text rung
    // below 10px. The floor came in one commit after small type crept to 7pt.
    const tick = declarations.match(/--fs-tick:\s*([\d.]+)px/);
    assert.ok(tick && Number(tick[1]) >= 9, "--fs-tick must stay a legible tick size");
    const floor = declarations.match(/--fs-2xs:\s*([\d.]+)px/);
    assert.ok(floor && Number(floor[1]) >= 10, "--fs-2xs is the reading floor: 10px");
  });
});

describe("two font stacks", () => {
  it("no font-family outside the sans and mono tokens", () => {
    const offenders: string[] = [];
    for (const match of screenDeclarations.matchAll(/font-family:\s*([^;]+);/g)) {
      const value = match[1].trim();
      if (value.startsWith("var(--sans)") || value.startsWith("var(--mono)")) continue;
      if (value === "inherit") continue;
      // The wordmark's serif glyph, sanctioned and annotated at its rule.
      if (value.startsWith("Georgia")) continue;
      // The stack definitions themselves live on :root html vars.
      if (value.startsWith("var(--font-")) continue;
      offenders.push(`globals.css:${lineOf(match.index)} — font-family: ${value}`);
    }
    assert.deepEqual(
      offenders,
      [],
      `font families outside the two stacks:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("the serif exception stays singular", () => {
    const uses = [...screenDeclarations.matchAll(/font-family:\s*Georgia[^;]*;/g)];
    assert.equal(
      uses.length,
      1,
      "Georgia callers at: " + uses.map((m) => `globals.css:${lineOf(m.index)}`).join(", "),
    );
  });
});

describe("inline sizes stay on the scale", () => {
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sources(full));
      else if (/\.tsx$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("every numeric fontSize in a component is a rung", () => {
    const offenders: string[] = [];
    for (const file of [...sources(join(root, "components")), ...sources(join(root, "app"))]) {
      // The icon generators draw a glyph into a fixed bitmap, not UI text.
      if (/app\/(apple-icon|icon)\.tsx$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        for (const match of line.matchAll(/fontSize[:=][ {]*([\d.]+)/g)) {
          if (!INLINE_SIZES.has(Number(match[1]))) {
            offenders.push(`${file.slice(root.length)}:${index + 1} — fontSize ${match[1]}`);
          }
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `inline sizes off the scale:\n  ${offenders.join("\n  ")}`,
    );
  });
});
