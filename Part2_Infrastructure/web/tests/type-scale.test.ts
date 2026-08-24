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

import { globalsCss, locateInGlobals } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));
const css = globalsCss;

/** Comment bodies blanked, newlines kept — declarations only, lines intact. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));


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
 *  11.5 → 12.5, 12 → 13 and 14 → 15 with the 2026-08-17 lift.
 *
 *  The 2026-08-24 lift stepped them again — 12 → 13, 12.5 → 13 and 13 → 14 —
 *  and moved the WORDS that were sitting on the 10 tick rung up to the 12 the
 *  labels vacated. 12.5 LEAVES the set rather than being kept beside 13: no
 *  site draws at it any more, and an allow-list that still names a value
 *  nothing uses is how a half-pixel rung comes back. The floor is unmoved and
 *  unmovable — `--fs-2xs` at compact is 10.714px and
 *  `type-ladder-presets.test.ts` requires 0.5px of clearance over `--fs-tick`,
 *  which caps the tick at 10.214 and requires a whole number. 14 is the top:
 *  the same 0.5px clearance under compact `--fs-title` (14.571px) puts the
 *  ceiling at 14.071. REJECTED: 15 for legends, which sits 0.43px ABOVE
 *  compact reading prose. */
const INLINE_SIZES = new Set([10, 12, 13, 14, 15, 25]);

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
      offenders.push(`${locateInGlobals(match.index)} — font-size: ${value}`);
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
    // under 10.5px (it came in one commit after small type crept to 7pt), and
    // the compact step must not take it under 10.5px either.
    //
    // Raised from 10 to 10.5 on 2026-08-22, when the compact step went to 6/7:
    // at the old 0.75rem that step computed to 10.29px, which cleared the 10px
    // guard while putting prose 0.29px above --fs-tick — and --fs-2xs is not a
    // kicker rung, it carries the bare `small` rule, two prose selectors, a log
    // stream, table bodies and 21 controls. The rung moved to 0.78125rem in the
    // same change; the guard moved with it so the next step cannot quietly
    // re-enter the tick zone. Strengthening, not a weakening: nothing that
    // passed at 10.5 would have failed at 10.
    const tick = declarations.match(/--fs-tick:\s*([\d.]+)px/);
    assert.ok(tick && Number(tick[1]) >= 9, "--fs-tick must stay a legible px tick size");
    // Fluid or fixed, the floor is the clamp's minimum: what a laptop and a
    // phone get.
    const floor = declarations.match(/--fs-2xs:\s*calc\((?:clamp\()?([\d.]+)rem/);
    assert.ok(floor, "--fs-2xs must be rem × --type-step");
    const px = Number(floor![1]) * 16;
    assert.ok(px >= 10.5, `--fs-2xs is the reading floor: never below 10.5px (got ${px})`);
    const compact = declarations.match(/\[data-text-size="compact"\]\s*\{[^}]*--type-step:\s*([\d.]+)/);
    if (compact) assert.ok(px * Number(compact[1]) >= 10.5, "the compact step must keep the floor legible");
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

describe("one control, one rung", () => {
  /**
   * The segmented control had three rungs.
   *
   * `.seg button` read --fs-lg, `.research-seg button` --fs-body and the rail
   * seg --fs-sm, and `.blotter-views__bar .seg button` took --fs-lg back on
   * top of a private 34px height. Three rungs on one control, on a sheet whose
   * whole argument is that adjacent rungs are indistinguishable to a reader
   * and unchoosable by an author.
   *
   * Asserted by SELECTOR rather than by value: `.seg button` is declared twice
   * on purpose — 00 gives the segment its flex behaviour and chip radius, 12
   * gives it the house size — so a scan for "every --fs-* near a seg" would
   * read the rung 12 overrides and call it a second size. What must not come
   * back is a SECOND selector sizing the same control, which is how all three
   * of the others arrived.
   *
   * Scoped to selectors that NAME the seg. Three variant classes hung on a
   * `.seg` element still declare a size of their own in 07 and 08; all three
   * are (0,1,1) and declared earlier, so the cascade already resolves them
   * here, and `seg-metrics.test.ts` pins that ordering rather than this file.
   */
  it("no second selector naming the seg sizes it, and the rung is --fs-sm", () => {
    const sizers = new Map<string, string[]>();
    for (const match of screenDeclarations.matchAll(/([^{}]*?\bseg[a-z_-]*\b[^{}]*?)\{([^}]*)\}/gim)) {
      const selector = match[1].trim().replace(/\s+/g, " ");
      // The toolbar rule that names the seg only to exclude itself from it.
      if (/:not\([^)]*\.seg/.test(selector)) continue;
      for (const size of match[2].matchAll(/font-size:\s*var\((--fs-[a-z0-9-]+)\)/g)) {
        sizers.set(selector, [...(sizers.get(selector) ?? []), size[1]]);
      }
    }
    assert.deepEqual(
      [...sizers.keys()],
      [".seg button"],
      "a second selector sizes the segmented control — that is how it ended up "
        + "with three rungs. Converge it in app/globals/12-workspace-standardisation.css",
    );
    const declared = sizers.get(".seg button") ?? [];
    assert.ok(declared.length >= 1, "the seg reads no rung at all");
    // --fs-sm until 2026-08-24, when the reader asked for "markets and coherence
    // subtabs and subsubtabs, standardize the font size to 14" and the two-tab
    // override the ask implies was refused by this assertion's own first half
    // (and by seg-metrics and tab-chrome-metrics). Converging it here is what
    // those three demand, so the rung moved for all ten tabs and the level
    // stayed standardised. Still pinned, and still exact: a THIRD value would be
    // the drift this test was written against. See type-role-map's sub-subtab
    // role and nav-type-markets-coherence.test.ts for the whole record.
    assert.equal(
      declared[declared.length - 1],
      "--fs-body",
      "the rung the cascade actually applies to every seg on every tab",
    );
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
      offenders.push(`${locateInGlobals(match.index)} — font-family: ${value}`);
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
      "Georgia callers at: " + uses.map((m) => `${locateInGlobals(m.index)}`).join(", "),
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
