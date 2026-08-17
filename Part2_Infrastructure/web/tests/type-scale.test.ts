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
  // The chrome tokens: the header row, the switcher, the bottom bar. Fixed.
  "--fs-chrome-tab", "--fs-chrome-chip", "--fs-chrome-caption", "--fs-chrome-brand",
] as const;

/** Content rungs: rem × the Text-size step. Chrome, tick and input are not. */
const CONTENT_RUNGS = RUNGS.filter(
  (r) => !r.startsWith("--fs-chrome") && r !== "--fs-tick" && r !== "--fs-input",
);

/** Inline SVG sizes the charts may use, in user units (px at 1:1). Ticks at
 *  10 and the donut figure at 25 stay; the reading labels stepped 11 → 12,
 *  11.5 → 12.5, 12 → 13 and 14 → 15 with the 2026-08-17 lift. */
const INLINE_SIZES = new Set([10, 12, 12.5, 13, 15, 25]);

/** Off-scale declarations sanctioned above, matched exactly. `100%` is the
 *  root: the browser's own size, which every rem rung is defined against. */
const SANCTIONED = new Set(["0", "7px", "7.5px", "25px", "100%"]);

describe("the stylesheet parses", () => {
  // None of the sheet-reading tests parse CSS; a stray brace passed every one
  // of them and broke the dev server. Depth never negative, zero at the end.
  it("braces balance in globals.css", () => {
    let depth = 0;
    let line = 1;
    for (const ch of declarations) {
      if (ch === "\n") line += 1;
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        assert.ok(depth >= 0, `an unmatched } at globals.css:${line}`);
      }
    }
    assert.equal(depth, 0, `${depth} unclosed block(s) at the end of globals.css`);
  });
});

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

  it("reading text never drops below the floor, in rem, at the browser's default size", () => {
    // --fs-tick is SVG chart furniture; no rung below it. The reading floor
    // is --fs-2xs, in rem × step: at 16px root and step 1 it must not fall
    // under 10px (it came in one commit after small type crept to 7pt), and
    // the compact step must not take it under 10px either.
    const tick = declarations.match(/--fs-tick:\s*([\d.]+)px/);
    assert.ok(tick && Number(tick[1]) >= 9, "--fs-tick must stay a legible px tick size");
    // Fluid or fixed, the floor is the clamp's minimum: what a laptop and a
    // phone get.
    const floor = declarations.match(/--fs-2xs:\s*calc\((?:clamp\()?([\d.]+)rem/);
    assert.ok(floor, "--fs-2xs must be rem × --type-step");
    const px = Number(floor![1]) * 16;
    assert.ok(px >= 10, `--fs-2xs is the reading floor: never below 10px (got ${px})`);
    const compact = declarations.match(/\[data-text-size="compact"\]\s*\{[^}]*--type-step:\s*([\d.]+)/);
    if (compact) assert.ok(px * Number(compact[1]) >= 10, "the compact step must keep the floor legible");
  });

  it("every fluid rung's maximum is above its minimum, and the viewport term is gentle", () => {
    // clamp(min, intercept + slope·vw, max): min < max, and a slope small
    // enough that 200 % zoom (CSS viewport 960 → every rung at min) still
    // yields ≥ 1.85× the size at 100 % — resizable text, not a ladder that
    // shrinks back as the reader zooms in.
    const root = declarations.slice(declarations.indexOf(":root {"), declarations.indexOf("\n}\n", declarations.indexOf(":root {")));
    for (const m of root.matchAll(/--fs-[a-z0-9-]+:\s*calc\(clamp\(([\d.]+)rem,\s*[\d.]+rem \+ ([\d.]+)vw,\s*([\d.]+)rem\)/g)) {
      const [, min, slope, max] = m;
      assert.ok(Number(max) > Number(min), `${m[0].slice(0, 20)}: max must exceed min`);
      assert.ok(Number(slope) <= 0.7, `${m[0].slice(0, 20)}: a viewport term above 0.7vw fights the reader's zoom`);
      assert.ok(Number(max) / Number(min) <= 1.2, `${m[0].slice(0, 20)}: a rung must not grow more than a fifth across the range`);
    }
  });

  it("every content rung is rem × the Text-size step, in ascending order", () => {
    // rem so the reader's browser preference and zoom scale the desk;
    // × --type-step so the Quick Settings preference reaches every rung at
    // once; ascending so no two rungs trade places under either.
    const root = declarations.slice(declarations.indexOf(":root {"), declarations.indexOf("\n}\n", declarations.indexOf(":root {")));
    assert.match(root, /--type-step:\s*1;/, "--type-step defaults to 1 in :root");
    const rem = (token: string): number => {
      const m = root.match(new RegExp(`${token}:\\s*calc\\((?:clamp\\()?([\\d.]+)rem`));
      assert.ok(m, `${token} must be calc(<rem> * var(--type-step)) (or a rem clamp inside it)`);
      assert.match(root, new RegExp(`${token}:[^;]*\\* var\\(--type-step\\)`), `${token} does not multiply by --type-step`);
      return Number(m![1]);
    };
    const order = ["--fs-2xs", "--fs-xs", "--fs-sm", "--fs-body", "--fs-md", "--fs-lg", "--fs-xl", "--fs-2xl", "--fs-title", "--fs-h2", "--fs-h1", "--fs-figure", "--fs-display"];
    const mins = order.map(rem);
    for (let i = 1; i < mins.length; i += 1) {
      assert.ok(mins[i] > mins[i - 1], `${order[i]} (${mins[i]}rem) must be above ${order[i - 1]} (${mins[i - 1]}rem)`);
    }
    for (const token of CONTENT_RUNGS) rem(token);
    // The two that are not typography stay px, unstepped — and the SVG
    // inline floor is the tick size.
    assert.match(root, /--fs-input:\s*16px;/);
    const tick = root.match(/--fs-tick:\s*(\d+)px;/);
    assert.ok(tick);
    assert.equal(Math.min(...INLINE_SIZES), Number(tick![1]), "the smallest inline SVG size is --fs-tick");
    // The root is the browser's own size and carries no rung.
    assert.match(declarations, /\nhtml \{\n  font-size: 100%;/);
    assert.doesNotMatch(declarations, /\nhtml,\nbody \{[^}]*font-size:/, "html/body must not share a rung — rem would double-scale");
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

  it("every numeric SVG fontSize in a component is a rung", () => {
    // SVG `<text fontSize={N}>` is user units — charts lay out in px and their
    // labels neither follow the rem ramp nor the Text-size step — so those
    // stay numeric and on the inline list. HTML text does not get a number.
    const offenders: string[] = [];
    for (const file of [...sources(join(root, "components")), ...sources(join(root, "app"))]) {
      // The icon generators draw a glyph into a fixed bitmap, not UI text.
      if (/app\/(apple-icon|icon)\.tsx$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        for (const match of line.matchAll(/fontSize=\{\s*([\d.]+)/g)) {
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

  it("no HTML text carries a literal size — not a Tailwind px, not a stock text-*, not a numeric style", () => {
    // Ninety `text-[12px]`-style literals and twenty-one `style={{ fontSize: 12.5 }}`
    // used to live beside the ladder, equal to its rungs by coincidence and
    // left behind by any change to them. Components read the ladder through
    // the bridged `text-fs-*` utilities or `var(--fs-*)`; nothing else.
    const offenders: string[] = [];
    for (const file of [...sources(join(root, "components")), ...sources(join(root, "app"))]) {
      if (/app\/(apple-icon|icon)\.tsx$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        const where = `${file.slice(root.length)}:${index + 1}`;
        for (const m of line.matchAll(/text-\[[\d.]+px\]/g)) offenders.push(`${where} — ${m[0]}`);
        for (const m of line.matchAll(/(?<![\w-])text-(xs|sm|base|lg|xl|\dxl)(?![\w-])/g)) offenders.push(`${where} — stock ${m[0]}`);
        for (const m of line.matchAll(/fontSize:\s*[\d.]+/g)) offenders.push(`${where} — ${m[0]}`);
      });
    }
    assert.deepEqual(offenders, [], `literal sizes off the ladder:\n  ${offenders.join("\n  ")}`);
  });
});
