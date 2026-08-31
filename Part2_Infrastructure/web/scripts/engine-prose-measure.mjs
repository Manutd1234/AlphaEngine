#!/usr/bin/env node
/**
 * Measure the prose on an engine tab, classified — the numbers
 * `tests/summarised-coherence.test.ts` quotes in its header.
 *
 *   node scripts/engine-prose-measure.mjs coherence
 *   node scripts/engine-prose-measure.mjs markets
 *
 * WHY A SCRIPT. The Markets guard's header quotes a measurement taken by hand
 * with a `<p>`-body regex, and on Proofs that method reads 986 characters out
 * of 17,176: the tab's prose is figure props (`reading=`, `missing=`,
 * `notes=[…]`, `lede=`, `<caption>`), not paragraphs. A header that quotes a
 * script can be re-run; one that quotes a memory cannot.
 *
 * METHOD, exactly:
 *   1. Files: the import closure of the tab's section owners, kept under
 *      components/coherence/ (.tsx and .ts), minus diffusion/, minus shared
 *      chrome, minus the reading panes coherence-proof-claims names. Each file
 *      counted once per tab — per-section sums double-count shared figures.
 *   2. Strip block, line and JSX comments. NOT string literals.
 *   3. Extract, each >= 15 chars after `${…}` and tags are removed and
 *      whitespace collapsed: <p> bodies; brace-balanced reading={}, missing={},
 *      notes={[]}, lede={} / lede="…", reason={} / reason="…"; <caption> bodies.
 *      For a prop, every string literal inside it counts (a ternary's two
 *      branches both render).
 *   4. Classify: PROTECTED = missing, reason, lede, and any <p> carrying a
 *      console-empty / coh-figure__missing / coh-figure__empty class or a ◌ / ✕
 *      (an absence or a failure); FOLDED = inside a <details> block or a notes=
 *      array; FOLDABLE = reading, open captions, every other <p>.
 *
 * Read-only. Prints one table and exits 0.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIR = join(WEB, "components", "coherence");

const OWNERS = {
  coherence: ["CertificatePane", "BasketSection", "CombosSection", "IndexSection", "CalibrationPane", "CorpusSection", "LessonsPane"],
  markets: ["UniverseSection", "SettlementSection", "BooksSection", "MakersSection", "SurfacePane", "StakePane", "FeesSection", "ShellPane"],
};
const SHARED = new Set([
  "Figure.tsx", "figure-chips.tsx", "plot-overlays.tsx", "PaneHead.tsx", "SectionFrame.tsx", "KpiRow.tsx",
  "FamilyPicker.tsx", "FamilyChoice.tsx", "SectionVerdict.tsx", "StatusPane.tsx", "EngineStatePanel.tsx",
  "LiveTape.tsx", "LiveControls.tsx", "MarketPicker.tsx",
]);
const READING_OWNED = new Set([
  "UniverseSection.tsx", "UniversePane.tsx", "BasketOverview.tsx", "DollarBar.tsx", "BasketComposition.tsx",
  "PriceHistogram.tsx", "SettlementPane.tsx", "FormationDiagram.tsx", "PendingMinutes.tsx", "BooksSection.tsx",
  "BooksPane.tsx", "LadderChart.tsx", "IdentityStrip.tsx", "RfqPane.tsx", "DispersionStrips.tsx", "ChannelStates.tsx",
  "SurfacePane.tsx", "ShellPane.tsx", "ShellBrowser.tsx", "ShellRouteFlow.tsx", "ShellListing.tsx", "ShellTree.tsx",
  "ShellCommandReference.tsx", "PmfChart.tsx",
  "SurvivalChart.tsx",
]);

function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(WEB, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    try { if (statSync(c).isFile()) return c; } catch { /* next */ }
  }
  return null;
}

function closure(tab) {
  const seen = new Set();
  const queue = OWNERS[tab].map((o) => join(DIR, `${o}.tsx`));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text; try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const m of text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
      const next = resolveImport(file, m[1]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  const owners = tab === "markets" ? new Set() : READING_OWNED;
  return [...seen].filter((f) => f.startsWith(DIR + "/") && !f.includes("/diffusion/") && /\.tsx?$/.test(f))
    .filter((f) => { const n = f.slice(f.lastIndexOf("/") + 1); return !SHARED.has(n) && !owners.has(n); })
    .sort();
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const clean = (s) => s.replace(/\$\{[^}]*\}/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

function balanced(source, opener) {
  const out = [];
  for (const m of source.matchAll(new RegExp(opener.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{", "g"))) {
    let depth = 1, i = m.index + m[0].length; const start = i;
    while (i < source.length && depth > 0) { const ch = source[i]; if (ch === "{") depth += 1; else if (ch === "}") depth -= 1; i += 1; }
    if (depth === 0) out.push({ text: source.slice(start, i - 1), at: m.index });
  }
  return out;
}
const literals = (expr) => [...expr.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
const inside = (spans, at) => spans.some(([a, b]) => at >= a && at <= b);

function measure(tab) {
  const totals = { protected: 0, folded: 0, foldable: 0 };
  const files = closure(tab);
  let pOnly = 0;
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    const folds = [...src.matchAll(/<details[\s\S]*?<\/details>/g)].map((m) => [m.index, m.index + m[0].length]);
    const add = (kind, text) => { const t = clean(text); if (t.length >= 15) totals[kind] += t.length; };
    for (const m of src.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const t = clean(m[2]); if (t.length < 15) continue; pOnly += t.length;
      const absence = /console-empty|coh-figure__missing|coh-figure__empty/.test(m[1]) || /[◌✕]/.test(m[2]);
      totals[absence ? "protected" : inside(folds, m.index) ? "folded" : "foldable"] += t.length;
    }
    for (const m of src.matchAll(/<caption\b[^>]*>([\s\S]*?)<\/caption>/g)) add(inside(folds, m.index) ? "folded" : "foldable", m[1]);
    for (const [prop, kind] of [["reading=", "foldable"], ["missing=", "protected"], ["reason=", "protected"], ["lede=", "protected"]]) {
      for (const span of balanced(src, prop)) for (const lit of literals(span.text)) add(inside(folds, span.at) ? "folded" : kind, lit);
      for (const m of src.matchAll(new RegExp(prop + '"([^"]*)"', "g"))) add(kind, m[1]);
    }
    for (const span of balanced(src, "notes=")) for (const lit of literals(span.text)) add("folded", lit);
  }
  const total = totals.protected + totals.folded + totals.foldable;
  const pct = (n) => `${Math.round((n / total) * 100)}%`;
  console.log(`${tab}: ${files.length} files`);
  console.log(`  protected ${totals.protected.toLocaleString("en-GB")} (${pct(totals.protected)})`);
  console.log(`  folded    ${totals.folded.toLocaleString("en-GB")} (${pct(totals.folded)})`);
  console.log(`  foldable  ${totals.foldable.toLocaleString("en-GB")} (${pct(totals.foldable)})`);
  console.log(`  total     ${total.toLocaleString("en-GB")}   (<p> bodies alone: ${pOnly.toLocaleString("en-GB")})`);
}

const tab = process.argv[2] ?? "coherence";
if (!OWNERS[tab]) { console.error(`unknown tab ${tab}; use coherence or markets`); process.exit(2); }
measure(tab);
