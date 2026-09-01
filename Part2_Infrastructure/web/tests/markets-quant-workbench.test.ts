import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MARKET_SECTION_CONTRACTS,
  MARKET_VIEW_CONTRACTS,
  marketsViewContract,
} from "../lib/markets/view-contracts";
import { MARKETS_SECTIONS } from "../lib/sections";
import { locationHash, viewsFor } from "../lib/section-views";
import { globalsCss } from "./globals-css";
import { cssRules, selectorList } from "./globals-rules";

const read = (relative: string) => readFileSync(
  fileURLToPath(new URL(relative, import.meta.url)),
  "utf8",
);

const consoleSource = read("../components/MarketsConsole.tsx");
const frameSource = read("../components/coherence/SectionFrame.tsx");
const switcherSource = read("../components/workspace/QuantViewSwitcher.tsx");
const barSource = read("../components/coherence/MarketsViewBar.tsx");
const evidenceSource = read("../components/coherence/EngineViewEvidence.tsx");
const css = read("../app/globals/14zza-markets-quant-workbench.css");

describe("the Markets workbench is derived from all 26 canonical destinations", () => {
  const canonical = MARKETS_SECTIONS.flatMap((section) =>
    viewsFor("markets", section.id).map(([view, label]) => ({ section, view, label })));

  it("has one complete, ordered technical contract per route", () => {
    assert.equal(canonical.length, 26);
    assert.equal(Object.keys(MARKET_VIEW_CONTRACTS).length, canonical.length);
    assert.equal(Object.keys(MARKET_SECTION_CONTRACTS).length, MARKETS_SECTIONS.length);

    canonical.forEach(({ section, view, label }, index) => {
      const contract = marketsViewContract(section.id, view);
      assert.ok(contract, `${section.id}/${view} has no technical contract`);
      assert.equal(contract?.ordinal, index + 1);
      assert.equal(contract?.total, canonical.length);
      assert.equal(contract?.sectionLabel, section.label);
      assert.equal(contract?.viewLabel, label);
      assert.equal(contract?.deepLink, locationHash("markets", section.id, view));
      assert.ok(contract?.question.endsWith("?"), `${section.id} does not state an analytical question`);
      assert.ok(contract?.leadSurface.length >= 8, `${section.id}/${view} does not name its lead surface`);
      assert.ok(contract?.exactAlternative.length >= 8, `${section.id}/${view} has no exact-value path`);
      assert.ok(contract?.guardrail.length >= 12, `${section.id}/${view} has no interpretation guardrail`);
    });
  });

  it("keeps the contract descriptive rather than inventing live measurements", () => {
    for (const contract of Object.values(MARKET_VIEW_CONTRACTS)) {
      const prose = `${contract.leadSurface} ${contract.exactAlternative}`;
      assert.doesNotMatch(prose, /\b(?:live|current)\s+\d|\b\d+(?:\.\d+)?\s*(?:ms|bps|contracts?)\b/i);
    }
  });
});

describe("Markets renders an interactive technical command bar", () => {
  it("mounts it between the canonical rail and evidence strip", () => {
    const rail = consoleSource.indexOf("<WorkspaceSubtabs");
    const evidence = consoleSource.indexOf("<EngineViewEvidence");
    const bar = consoleSource.indexOf("<MarketsViewBar", evidence);
    assert.ok(rail >= 0 && rail < evidence && bar > evidence,
      "Markets route actions must share the evidence band instead of creating a second row");
    assert.match(consoleSource, /<EngineViewEvidence[\s\S]*contextAction=\{\s*<MarketsViewBar/);
    assert.match(consoleSource, /onReset=\{\(\) => onViewChange\(section, marketsDefaultView\(section\)/);
  });

  it("uses source-owned shadcn primitives and honest clipboard feedback", () => {
    assert.match(barSource, /import \{[^}]*Button[^}]*\} from "@\/components\/ui\//);
    assert.match(evidenceSource, /import \{[^}]*Sheet[^}]*\} from "@\/components\/ui\//);
    assert.doesNotMatch(barSource, /<Sheet\b/,
      "route actions brought back a second Sheet beside the complete Evidence disclosure");
    assert.doesNotMatch(barSource, /import \{[^}]*Card[^}]*\} from "@\/components\/ui\//,
      "the shared evidence band owns the container; route actions must not add a nested card");
    assert.match(barSource, /navigator\.clipboard\.writeText/);
    assert.match(barSource, /role="status"/);
    assert.match(barSource, /data-copy-state=/);
    assert.match(barSource, /contract\.deepLink/);
  });

  it("cuts the eight section-lede source strings by at least ten percent", () => {
    const owners = [
      "UniverseSection", "SettlementSection", "BooksSection", "MakersSection",
      "SurfacePane", "StakePane", "FeesSection", "ShellPane",
    ].map((name) => read(`../components/coherence/${name}.tsx`)
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, ""));
    const ledes = owners.map((source) => {
      const plain = source.match(/lede[=:]\s*"([^"]+)"/)?.[1];
      if (plain) return plain;
      const fragment = source.match(/lede=\{\s*<>([\s\S]*?)<\/>(?:\s*)\}/)?.[1] ?? "";
      return fragment.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
    });
    assert.equal(ledes.filter(Boolean).length, MARKETS_SECTIONS.length, "a Markets lede escaped the copy measurement");
    const words = (value: string) => value.match(/[\p{L}\p{N}$]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
    const currentLedeWords = ledes.reduce((total, lede) => total + words(lede), 0);
    const priorLedeWords = 203;
    // The rail and local view control already name the active address. The
    // closed workbench therefore adds no repeated section/view label at rest.
    const currentChangedSurface = currentLedeWords;
    const reduction = 1 - (currentChangedSurface / priorLedeWords);
    assert.equal(currentChangedSurface, 107, "the source-derived Markets lede count drifted");
    assert.ok(reduction >= 0.10,
      `Markets lede source copy moved ${(reduction * 100).toFixed(1)}%; expected at least a 10% reduction`);
    assert.doesNotMatch(barSource, />\s*(?:Reset view|Copy deep link)\s*</,
      "icon actions repeat their accessible names visibly in the compact command row");
    const detailsAt = evidenceSource.indexOf("<SheetContent");
    assert.ok(detailsAt >= 0, "the technical contract is not progressively disclosed in Evidence");
    assert.doesNotMatch(barSource, /<details/);
    for (const technical of ["Decision question", "Lead surface", "Exact values", "Interpretation", "Deep link"]) {
      assert.ok(evidenceSource.lastIndexOf(technical) > detailsAt, `${technical} is no longer inside the closed technical contract`);
    }
  });
});

describe("every Markets section now has one structured result region", () => {
  it("uses the shadcn toggle group without permitting an empty selection", () => {
    assert.match(frameSource, /<QuantViewSwitcher\b/);
    assert.match(switcherSource, /import \{ ToggleGroup, ToggleGroupItem \}/);
    assert.match(switcherSource, /type="single"/);
    assert.match(switcherSource, /if \(next\) onValue/);
    assert.match(frameSource, /data-market-view=/);
    assert.match(frameSource, /className="coh-section__body"/);
    assert.match(frameSource, /role="region"/);
  });

  it("does not add a second heading rule or a second frame around nested KPI rows", () => {
    assert.doesNotMatch(frameSource, /Separator|coh-section__head-rule/);
    assert.doesNotMatch(css, /coh-section__head-rule/);
    assert.match(css, /\[data-market-section\] > \.coh-status__facts\s*\{/);
    assert.doesNotMatch(css, /\[data-market-section\] \.coh-status__facts\s*\{/);
  });
});

describe("the Markets-only visual layer is robust", () => {
  it("leaves shared SVG text on the diagram ladder", () => {
    assert.doesNotMatch(
      css,
      /:is\([^)]*(?:\.coh-surface__tick|\.coh-ladder__tick|\.coh-combo__axis|\.coh-svg-note)[^)]*\)\s*\{[^}]*font-size:/s,
      "the late Markets layer overrides a semantic SVG rung owned by the shared diagram ladder",
    );
  });

  it("stays scoped and delegates motion and forced colours to the one global contracts", () => {
    assert.ok(css.trim().length > 1200);
    assert.doesNotMatch(css, /@import/);
    for (const rule of cssRules(css, () => "14zza-markets-quant-workbench.css")) {
      if (rule.context.some((entry) => entry.startsWith("@keyframes"))) continue;
      for (const selector of selectorList(rule.selector)) {
        assert.match(selector, /\.markets-plane|\[data-market-section\]/, `unscoped selector: ${selector}`);
      }
    }
    assert.match(css, /:focus-visible/);
    assert.match(css, /@media \(max-width:/);
    assert.doesNotMatch(css, /prefers-reduced-motion: reduce|forced-colors: active/);
    assert.equal((globalsCss.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []).length, 1);
    assert.equal((globalsCss.match(/@media \(forced-colors: active\)/g) ?? []).length, 1);
  });

  it("derives colour and shadows from the house token system", () => {
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgba?\s*\(/i,
      "the Markets layer contains a fixed colour that cannot follow the active theme");
    assert.match(css, /color-mix\(in srgb, var\(--text-primary\)/);
  });
});
