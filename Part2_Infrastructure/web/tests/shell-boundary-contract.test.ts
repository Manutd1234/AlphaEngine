/**
 * The shell boundary contract.
 *
 * This deliberately tests the applied CSS cascade rather than component copy:
 * a doubled boundary, a clipped focus ring, or a card promoted above the rail
 * can leave every data and content assertion green while the desk is unusable.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
  comment.replace(/[^\n]/g, " "));

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function exactRules(selector: string): string[] {
  const matches = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escape(selector)}\\s*\\{`, "g"))];
  return matches.map((match) => {
    const start = css.indexOf(selector, match.index);
    return css.slice(start, css.indexOf("\n}", start));
  });
}

function mediaBodies(condition: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  while (from < css.length) {
    const opening = css.indexOf(condition, from);
    if (opening < 0) break;
    let depth = 0;
    let started = false;
    for (let index = css.indexOf("{", opening); index < css.length; index += 1) {
      if (css[index] === "{") { depth += 1; started = true; }
      else if (css[index] === "}") depth -= 1;
      if (started && depth === 0) {
        bodies.push(css.slice(opening, index + 1));
        from = index + 1;
        break;
      }
    }
  }
  assert.ok(bodies.length > 0, `${condition} is absent`);
  return bodies;
}

describe("one universal sizing model", () => {
  it("puts elements and both pseudo-elements under one border-box owner", () => {
    assert.match(
      css,
      /\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-sizing:\s*border-box;/s,
      "border-box must include pseudo-elements; otherwise a 100% decorative edge can exceed its card",
    );
    assert.equal(
      (css.match(/box-sizing:\s*border-box;/g) ?? []).length,
      1,
      "border-box is declared by more than one layer; the reset must be the only owner",
    );
  });
});

describe("one card and container boundary vocabulary", () => {
  const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}", css.indexOf(":root {")));

  it("aliases radius, padding and border through one surface contract", () => {
    assert.match(root, /--surface-radius:\s*var\(--radius-lg\);/);
    assert.match(root, /--surface-pad-block:\s*var\(--card-pad-y\);/);
    assert.match(root, /--surface-pad-inline:\s*var\(--card-pad\);/);
    assert.match(root, /--surface-boundary:\s*1px solid var\(--rule\);/);
  });

  it("gives the legacy card one complete, token-only geometry owner", () => {
    const cards = exactRules(".card");
    assert.equal(cards.length, 1, `expected one exact .card rule, found ${cards.length}`);
    const card = cards[0];
    assert.match(card, /border:\s*var\(--surface-boundary\);/);
    assert.match(card, /border-radius:\s*var\(--surface-radius\);/);
    assert.match(card, /padding:\s*var\(--surface-pad-block\) var\(--surface-pad-inline\);/);
    assert.match(card, /background:\s*var\(--surface-1\);/);
  });

  it("puts source-owned Card primitives on the same radius and inset tokens", () => {
    const primitive = exactRules('[data-slot="card"]:not(.card)');
    assert.equal(primitive.length, 1, "source-owned Card has no shared container rule");
    assert.match(primitive[0], /border-radius:\s*var\(--surface-radius\);/);
    assert.match(primitive[0], /padding-block:\s*var\(--surface-pad-block\);/);
    assert.match(primitive[0], /border-color:\s*var\(--rule\);/);
  });
});

describe("cards never compete with application chrome", () => {
  it("allows local card paint order only, never a rail/header/overlay rung", () => {
    const offenders: string[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*z-index:\s*([^;]+);[^{}]*)\}/g)) {
      const selector = match[1].trim();
      if (!/(^|[\s>+~,:])\.card\b|\[data-slot=["']card["']\]/.test(selector)) continue;
      const value = match[3].trim();
      const local = Number(value);
      if (Number.isFinite(local) && Math.abs(local) <= 2) continue;
      offenders.push(`${selector} — ${value}`);
    }
    assert.deepEqual(offenders, [], `card surfaces claim page-level depth:\n  ${offenders.join("\n  ")}`);
  });
});

describe("the responsive header yields space without covering navigation", () => {
  it("wraps below the measured desktop band and releases clipping there", () => {
    const narrow = mediaBodies("@media (max-width: 1110px)").join("\n");
    assert.match(narrow, /\.workspace-header__utility\s*\{[^}]*flex-wrap:\s*wrap;/s);
    assert.match(narrow, /\.workspace-header__utility\s*\{[^}]*overflow-x:\s*visible;/s,
      "a wrapped row must not clip focus rings or anchored panels at its inline edge");
  });

  it("uses the compact navigator before primary tabs can overlap controls", () => {
    const compact = mediaBodies("@media (max-width: 900px)").join("\n");
    assert.match(compact, /\.workspace-tabs\s*\{[^}]*display:\s*none;/s);
    assert.match(compact, /\.workspace-switcher\s*\{[^}]*display:\s*grid;/s);
  });

  it("sizes the only content scroller from the measured header height", () => {
    const shell = exactRules(".workspace-shell").find((rule) => /overflow-y:\s*auto/.test(rule));
    assert.ok(shell, "the workspace shell is no longer the primary scroller");
    assert.match(shell, /height:\s*calc\(100svh - var\(--header-h\)\)/);
    assert.match(read("../components/WorkspaceHeader.tsx"), /ResizeObserver/,
      "header wrapping is not being measured into --header-h");
  });
});
