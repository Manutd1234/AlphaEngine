/**
 * --status-* is the 3:1 graphical step for keylines, dots and icon strokes.
 * Status words use the independently tuned --success/--warning/--critical-text
 * roles, which clear 4.5:1 on every reachable surface.
 *
 * This is a roll-call rather than a broad "selector contains svg" exception:
 * every graphical use is reviewed, and a new `color: var(--status-*)` fails
 * until it is either changed to a text role or deliberately added here.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");

function cssFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...cssFiles(path));
    else if (entry.name.endsWith(".css")) files.push(path);
  }
  return files;
}

function tsxFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...tsxFiles(path));
    else if (entry.name.endsWith(".tsx")) files.push(path);
  }
  return files;
}

function displayPath(path: string): string {
  return relative(root, path).split(sep).join("/");
}

function maskComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function selectorKey(path: string, selector: string): string {
  return `${path} :: ${selector.replace(/\s+/g, " ").trim()}`;
}

const GRAPHICAL_COLOR_USES = new Set([
  "app/globals/01-workspace-shell.css :: .data-tier--good .data-tier__dot",
  "app/globals/01-workspace-shell.css :: .data-tier--warn .data-tier__dot",
  "components/coherence/SettlementInstruments.module.css :: .verification > svg",
  "components/coherence/SettlementInstruments.module.css :: .verification[data-holds=\"no\"] > svg",
  "components/coherence/SettlementInstruments.module.css :: .queueCount svg",
  "components/coherence/SettlementInstruments.module.css :: .sealRoute > span[data-state=\"complete\"] > svg",
  "components/coherence/SettlementInstruments.module.css :: .evidenceBadge > svg",
  "components/coherence/SettlementInstruments.module.css :: .evidenceBadge[data-holds=\"no\"] > svg",
  "components/coherence/SettlementInstruments.module.css :: .emptyQueue svg",
]);

describe("status fill roles stay graphical across every stylesheet", () => {
  const files = [...cssFiles(join(root, "app")), ...cssFiles(join(root, "components"))].sort();
  const offenders: string[] = [];
  const observedGraphicalUses = new Set<string>();
  let statusColorDeclarations = 0;

  for (const file of files) {
    const path = displayPath(file);
    const source = maskComments(readFileSync(file, "utf8"));

    // Innermost declaration blocks are sufficient here. Inside @media the
    // match begins after the media brace and still captures the actual selector.
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].replace(/\s+/g, " ").trim();
      const body = rule[2];
      for (const declaration of body.matchAll(/(^|[;\s])color\s*:\s*var\(--status-(good|warning|critical)\)\s*(?:!important)?\s*(?=;|$)/g)) {
        statusColorDeclarations += 1;
        const key = selectorKey(path, selector);
        if (GRAPHICAL_COLOR_USES.has(key)) {
          observedGraphicalUses.add(key);
          continue;
        }
        const declarationIndex = rule.index + rule[0].indexOf("{") + 1 + declaration.index;
        offenders.push(`${path}:${lineAt(source, declarationIndex)} ${selector} uses --status-${declaration[2]} as color`);
      }
    }
  }

  it("finds the reviewed graphical uses, so the scan cannot pass vacuously", () => {
    assert.equal(statusColorDeclarations, GRAPHICAL_COLOR_USES.size);
    assert.deepEqual(
      [...observedGraphicalUses].sort(),
      [...GRAPHICAL_COLOR_USES].sort(),
      "the graphical allow-list is stale or a reviewed selector stopped matching",
    );
  });

  it("never paints status text with a graphical fill token", () => {
    assert.equal(
      offenders.length,
      0,
      `use --success-text, --warning-text or --critical-text for these selectors:\n${offenders.join("\n")}`,
    );
  });
});

describe("SVG words use the text step of each semantic colour", () => {
  const files = [...tsxFiles(join(root, "app")), ...tsxFiles(join(root, "components"))].sort();
  const offenders: string[] = [];
  let textTags = 0;

  for (const file of files) {
    const path = displayPath(file);
    const source = maskComments(readFileSync(file, "utf8"));
    for (const tag of source.matchAll(/<text\b[^>]*>/g)) {
      textTags += 1;
      if (/fill\s*=\s*["']var\(--status-(?:good|warning|critical)\)["']/.test(tag[0])) {
        offenders.push(`${path}:${lineAt(source, tag.index)} ${tag[0].replace(/\s+/g, " ").trim()}`);
      }
    }
  }

  it("scans the authored SVG text rather than an empty corpus", () => {
    assert.ok(textTags > 100, `only found ${textTags} SVG text tags`);
  });

  it("never applies a graphical status fill directly to an SVG word", () => {
    assert.deepEqual(offenders, [], `use the matching --*-text token:\n${offenders.join("\n")}`);
  });

  it("keeps breaker borders and breaker counts on separate roles", () => {
    const breaker = readFileSync(join(root, "components/systems/BreakerStateMachine.tsx"), "utf8");
    assert.match(breaker, /stroke=\{active \? borderTone : "var\(--border\)"\}/);
    assert.match(breaker, /fill=\{active \? countTone : "var\(--text-muted\)"\}/);
    assert.match(breaker, /const countTone[\s\S]{0,240}var\(--success-text\)/);
  });
});
