/**
 * The engine grid family: one layout vocabulary for both engine tabs.
 *
 * Every section on Proofs and Markets was one column — head, verdict, control
 * row, figure, reading, fold, table — with a small number of deliberate packing
 * grids on Proofs and none on Markets.
 * "Dense layouts, in the style of a quant desk's internal tools" is a layout
 * vocabulary that did not exist, so `14y-engine-grid.css` declares one and
 * this file holds it to four rules:
 *
 *   1. It is scoped to `.coherence-plane` — the plane every engine console
 *      renders, Diffusion included — and names no tab class. A grid split by
 *      tab is the drift `14q`/`14r`'s banner records.
 *   2. It sizes nothing, colours nothing and animates nothing. Borders are
 *      `14z`'s; type is the ladder's; a grid is geometry.
 *   3. Every packing rule sits inside a `min-width` query, and the base grid
 *      carries `align-content: start` — the seg-resizes-on-pane-switch trap:
 *      a `display: grid` on a subtab-panel element without it lets spare
 *      height inflate the rows, and `14j` protects only the portfolio, risk
 *      and execution panels.
 *   4. Every class it declares is rendered, and the first child of any Proofs
 *      grid is a drawing — `engine-opens-on-a-drawing` skips a `div` wrapper
 *      and fails on a table or a paragraph first, and this file says the same
 *      thing one level down.
 *
 * `.coh-figpair` is retired. The certificate verdict has since returned to one
 * full-width decision chain; the remaining two-up site still exercises the
 * shared grid vocabulary without forcing live verdict copy into narrow cards.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DRAWINGS } from "./helpers/engine-drawings";
import { cssRules } from "./globals-rules";
import { read } from "./helpers/workspace-sources";

const PARTIAL = "../app/globals/14y-engine-grid.css";
const partial = read(PARTIAL);
const blank = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const rules = cssRules(blank(partial), (index) => `14y:${partial.slice(0, index).split("\n").length}`);
const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

function engineSources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, `${rel}/${entry}`);
      else if (entry.endsWith(".tsx")) out.push([`${rel}/${entry}`, stripComments(readFileSync(path, "utf8"))]);
    }
  };
  walk(join(process.cwd(), "components", "coherence"), "components/coherence");
  for (const file of ["CoherenceConsole.tsx", "MarketsConsole.tsx"]) {
    out.push([`components/${file}`, stripComments(read(`../components/${file}`))]);
  }
  return out;
}
const SOURCES = engineSources();

/**
 * Where a Proofs grid is drawn and what leads it. Grown by the layout slices;
 * a grid site not listed here is red, so the vocabulary cannot spread without
 * its opener being checked.
 */
const LAYOUT: ReadonlyArray<{ file: string; primitive: string; leads: string }> = [
  { file: "components/coherence/PortfolioPane.tsx", primitive: "coh-grid--2", leads: "ShortfallScale" },
];

describe("14y exists, is imported once in order, and is one vocabulary for both tabs", () => {
  it("is imported after 14x and before 15", () => {
    const manifest = read("../app/globals.css");
    const lines = manifest.split("\n").filter((line) => line.startsWith("@import"));
    const at = (name: string) => lines.findIndex((line) => line.includes(name));
    assert.ok(at("14y-engine-grid.css") > -1, "14y is not imported");
    assert.ok(at("14y-engine-grid.css") > at("14x-markets-frame.css"), "14y must come after 14x");
    assert.ok(at("14y-engine-grid.css") < at("15-navigator-and-trailing-layer.css"), "14y must come before 15");
    assert.equal(lines.filter((line) => line.includes("14y-engine-grid.css")).length, 1);
  });

  it("ends in a newline and declares at least one rule", () => {
    assert.ok(partial.endsWith("\n"));
    assert.ok(rules.length >= 2, "the partial is empty — these assertions would measure nothing");
  });

  it("scopes every selector to the shared plane and names no tab", () => {
    for (const rule of rules) {
      for (const selector of rule.selector.split(",")) {
        assert.match(selector, /\.coherence-plane/, `${rule.where}: "${selector.trim()}" is not scoped to .coherence-plane`);
        assert.doesNotMatch(selector, /proofs-plane|markets-plane|diffusion-plane/, `${rule.where}: "${selector.trim()}" names a tab`);
      }
    }
  });

  it("sizes nothing, colours nothing, animates nothing", () => {
    for (const rule of rules) {
      assert.doesNotMatch(rule.body, /font-size|font:/, `${rule.where} sizes type`);
      assert.doesNotMatch(rule.body, /transition|animation/, `${rule.where} animates`);
      assert.doesNotMatch(rule.body, /\bcolor:|background|border|box-shadow|--series|--status/, `${rule.where} paints — borders are 14z's`);
    }
  });

  it("keeps every packing rule inside a min-width query, and the base grid starts its rows", () => {
    for (const rule of rules) {
      if (/grid-template-columns/.test(rule.body)) {
        assert.ok(rule.context.some((c) => /min-width/.test(c)), `${rule.where} packs columns outside a min-width query`);
      }
    }
    const base = rules.find((rule) => rule.selector === ".coherence-plane .coh-grid");
    assert.ok(base, "no base .coh-grid rule");
    assert.match(base.body, /display:\s*grid/);
    assert.match(base.body, /align-content:\s*start/, "a grid on a subtab panel without align-content: start inflates its rows on a pane switch");
    assert.match(base.body, /min-width:\s*0/);
  });
});

describe("every class the family declares is rendered, and the pair it replaces is gone", () => {
  const declared = [...new Set(rules.flatMap((rule) => [...rule.selector.matchAll(/\.(coh-grid(?:--[a-z0-9]+|__[a-z]+)?)/g)].map((m) => m[1])))];
  for (const name of declared) {
    it(`${name} has a render site`, () => {
      const pattern = new RegExp(`(?:^|[\\s"'\`])${name.replace(/[-]/g, "\\-")}(?:[\\s"'\`$]|$)`);
      assert.ok(SOURCES.some(([, source]) => pattern.test(source)), `${name} is declared in 14y and rendered nowhere`);
    });
  }
  it("declares the base and the two-up at least", () => {
    for (const name of ["coh-grid", "coh-grid--2"]) assert.ok(declared.includes(name), `${name} is not declared`);
  });
  it(".coh-figpair is in no partial and no component", () => {
    const partials = readdirSync(join(process.cwd(), "app", "globals")).filter((f) => f.endsWith(".css"));
    for (const file of partials) {
      assert.doesNotMatch(blank(read(`../app/globals/${file}`)), /coh-figpair/, `${file} still styles .coh-figpair`);
    }
    for (const [file, source] of SOURCES) assert.doesNotMatch(source, /coh-figpair/, `${file} still renders .coh-figpair`);
  });
});

describe("the Markets control row pins like the Proofs one", () => {
  it("14x's .coh-section__controls is sticky under the rail", () => {
    const frame = blank(read("../app/globals/14x-markets-frame.css"));
    const controls = cssRules(frame, () => "14x").filter((rule) => rule.selector === ".coh-section__controls");
    assert.ok(controls.length >= 1, "no .coh-section__controls rule");
    const bodies = controls.map((rule) => rule.body).join(" ");
    assert.match(bodies, /position:\s*sticky/);
    assert.match(bodies, /top:\s*calc\(var\(--rail-h\)/, "the pin must read the measured rail height");
    assert.match(bodies, /z-index:\s*var\(--z-sticky-cell\)/);
  });
});

describe("SectionFrame takes the grid as a layout prop wrapping children only", () => {
  const frame = stripComments(read("../components/coherence/SectionFrame.tsx"));
  it("declares layout and renders it around children, never around the head", () => {
    assert.match(frame, /layout\?: "2" \| "3" \| "aside" \| "lead";/);
    assert.match(frame, /className=\{`coh-grid coh-grid--\$\{layout\}`\}/);
    const head = frame.indexOf("{head}");
    const grid = frame.indexOf("coh-grid coh-grid--");
    const children = frame.indexOf("{children}");
    assert.ok(head > -1 && grid > head, "the grid must open after the head slot");
    assert.ok(children > grid, "children render inside the grid");
  });
});

describe("every Proofs grid opens on a drawing", () => {
  it("keeps the certificate verdict as one full-width decision chain", () => {
    const source = SOURCES.find(([file]) => file === "components/coherence/CertificateViews.tsx")?.[1] ?? "";
    const verdictAt = source.indexOf("export function VerdictView(");
    const proofAt = source.indexOf("export function ProofView(");
    assert.ok(verdictAt > -1 && proofAt > verdictAt, "the certificate views cannot be isolated");
    const verdict = source.slice(verdictAt, proofAt);
    assert.match(verdict, /<CheckLadder certificate=\{data\} \/>/,
      "the verdict does not open on its decision drawing");
    assert.doesNotMatch(verdict, /coh-grid--2|coh-grid--aside/,
      "the verdict decision chain is packed into a narrow multi-column grid");
  });

  for (const site of LAYOUT) {
    it(`${site.file.split("/").pop()} leads its ${site.primitive} with ${site.leads}`, () => {
      const source = SOURCES.find(([file]) => file === site.file)?.[1] ?? "";
      const at = source.indexOf(`className="coh-grid ${site.primitive}"`);
      assert.ok(at > -1, `${site.file} has no ${site.primitive} site`);
      const after = source.slice(at);
      const first = /<([A-Z][A-Za-z]*)/.exec(after)?.[1];
      assert.equal(first, site.leads, `${site.file}'s ${site.primitive} opens on <${first}>, not ${site.leads}`);
      assert.ok(DRAWINGS.includes(site.leads), `${site.leads} is not in DRAWINGS`);
    });
  }
  it("no Proofs grid site is missing from LAYOUT", () => {
    const listed = new Set(LAYOUT.map((site) => `${site.file} ${site.primitive}`));
    for (const [file, source] of SOURCES) {
      if (/Console\.tsx$/.test(file) || file.includes("/diffusion/")) continue;
      for (const match of source.matchAll(/className="coh-grid (coh-grid--[a-z0-9]+)"/g)) {
        // Markets sections apply the vocabulary through SectionFrame's prop and their own sites (slice 19).
        assert.ok(listed.has(`${file} ${match[1]}`) || /SectionFrame/.test(source),
          `${file} draws ${match[1]} without a LAYOUT row saying what leads it`);
      }
    }
  });
});
