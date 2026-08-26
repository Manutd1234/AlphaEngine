/**
 * The files a Proofs section actually renders, found by import rather than by
 * directory.
 *
 * `summarised-markets.test.ts` scans the eight owner files, and on Markets that
 * is enough: its prose is `<p>` bodies in the owners. On Proofs it is not. The
 * seven owners hold 986 characters of prose between them; the other ~16,000
 * live in `reading=`, `missing=`, `notes=[…]`, `<caption>` and `lede=` props on
 * the figure files the owners import, so a guard that read the owners would
 * measure a tab that is 6% of the one on screen and call it terse.
 *
 * So the closure is walked: every file reachable by `import` from an owner,
 * kept while it is under `components/coherence/` (both `.tsx` and `.ts` —
 * `murphy-terms.ts` carries a glossary), dropped when it is shared chrome the
 * Markets and Diffusion consoles also render, or a reading pane that
 * `coherence-proof-claims` already names as the Quotes half's territory.
 *
 * `resolveImport` is the one `plane-scope.test.ts` uses, copied rather than
 * imported because that file runs its own suite at import time. A resolver
 * that missed a specifier form (`@/`, `./`, an `index.ts`) would silently
 * shrink the closure and every negative assertion over it would pass — so
 * `summarised-coherence` pins the closure's size as well as its contents.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The web root (`Part2_Infrastructure/web`). */
export const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The seven Proofs section owners, as `lib/sections.ts` orders the rail. */
export const PROOFS_OWNERS: Record<string, string> = {
  certificate: "CertificatePane",
  portfolio: "BasketSection",
  combos: "CombosSection",
  index: "IndexSection",
  calibration: "CalibrationPane",
  corpus: "CorpusSection",
  lessons: "LessonsPane",
};

/**
 * Chrome every engine console renders. Its copy is guarded where it is owned
 * (`engine-head-state`, `coherence-pane-head`, the plot-interaction suites),
 * not by a section's copy guard.
 */
export const SHARED_INFRA = new Set([
  "Figure.tsx", "figure-chips.tsx", "plot-overlays.tsx", "PaneHead.tsx", "SectionFrame.tsx",
  "KpiRow.tsx", "FamilyPicker.tsx", "FamilyChoice.tsx", "SectionVerdict.tsx", "StatusPane.tsx",
  "EngineStatePanel.tsx", "LiveTape.tsx", "LiveControls.tsx", "MarketPicker.tsx",
]);

/**
 * The Quotes half's reading panes, as `coherence-proof-claims.test.ts` names
 * them. Kept in step by that suite's own scan: `summarised-coherence` reads its
 * `READING_OWNED` block and fails if a name here is missing there.
 */
export const READING_OWNED = new Set([
  "UniverseSection.tsx", "UniversePane.tsx", "BasketOverview.tsx", "DollarBar.tsx",
  "BasketComposition.tsx", "PriceHistogram.tsx",
  "SettlementPane.tsx", "FormationDiagram.tsx", "PendingMinutes.tsx", "BooksSection.tsx",
  "BooksPane.tsx", "LadderChart.tsx", "IdentityStrip.tsx", "RfqPane.tsx",
  "DispersionStrips.tsx", "ChannelStates.tsx", "SurfacePane.tsx",
  "ShellPane.tsx", "ShellListing.tsx", "ShellTree.tsx", "ShellCommandReference.tsx", "PmfChart.tsx",
  "SurvivalChart.tsx",
]);

/** Resolve one import specifier to a file on disk, or null for a package. */
export function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(WEB_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

/** Every file reachable by import from `entry`, transitively, absolute paths. */
export function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
      const next = resolveImport(file, match[1]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

export interface EngineSource {
  /** Path relative to the web root, e.g. `components/coherence/MurphyBars.tsx`. */
  path: string;
  /** The raw file text. Callers choose their own stripper. */
  text: string;
}

/**
 * The Proofs closure: reachable from the seven owners, inside
 * `components/coherence/`, not Diffusion's, not shared chrome, not a reading pane.
 */
export function proofsSources(): EngineSource[] {
  const dir = join(WEB_ROOT, "components", "coherence");
  const files = new Set<string>();
  for (const owner of Object.values(PROOFS_OWNERS)) {
    for (const file of reachableFrom(join(dir, `${owner}.tsx`))) files.add(file);
  }
  return [...files]
    .filter((file) => file.startsWith(dir + "/"))
    .filter((file) => !file.includes("/diffusion/"))
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => {
      const name = file.slice(file.lastIndexOf("/") + 1);
      return !SHARED_INFRA.has(name) && !READING_OWNED.has(name);
    })
    .sort()
    .map((file) => ({ path: relative(WEB_ROOT, file), text: readFileSync(file, "utf8") }));
}

/** Comments only. A comment explaining a fact must not stand in for the fact. */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** The bodies of every `<details>` — what sits between `</summary>` and `</details>`. */
export function detailsBodies(source: string): string[] {
  return [...source.matchAll(/<details[\s\S]*?<\/details>/g)].map((block) => {
    const at = block[0].indexOf("</summary>");
    return at === -1 ? block[0] : block[0].slice(at + "</summary>".length);
  });
}

/** Every `<summary>` body. */
export function summaries(source: string): string[] {
  return [...source.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
}

/** The text between a `{` at `open` and its balancing `}`, or null if unbalanced. */
function balancedFrom(source: string, open: number): string | null {
  let depth = 1;
  let i = open + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  return depth === 0 ? source.slice(open + 1, i - 1) : null;
}

/**
 * The inside of every `notes={…}` prop, brace-balanced — and, when the prop is
 * a call (`notes={notesFor(points)}`), the body of that function too, because
 * that is where the folded sentences live. A note built anywhere else is open
 * to this scan, which is the point: the fold is wherever `Figure` renders it.
 */
export function notesLiterals(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/notes=\{/g)) {
    const inner = balancedFrom(source, match.index + match[0].length - 1);
    if (inner === null) continue;
    out.push(inner);
    const call = inner.trim().match(/^([A-Za-z_$][\w$]*)\(/);
    if (call) {
      const fn = source.search(new RegExp(`function ${call[1]}\\(`));
      if (fn === -1) continue;
      const open = source.indexOf("{", source.indexOf(")", fn));
      const body = open === -1 ? null : balancedFrom(source, open);
      if (body !== null) out.push(body);
      continue;
    }
    // A bare identifier (`notes={notes}`): the sentences are in its initialiser,
    // read from the `=` to the first `;` outside every bracket.
    const name = inner.trim().match(/^([A-Za-z_$][\w$]*)$/);
    if (!name) continue;
    const decl = source.search(new RegExp(`(?:const|let)\\s+${name[1]}\\b[^=]*=`));
    if (decl === -1) continue;
    let i = source.indexOf("=", decl) + 1;
    let depth = 0;
    const start = i;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
      else if (ch === ";" && depth === 0) break;
      i += 1;
    }
    out.push(source.slice(start, i));
  }
  return out;
}

/**
 * A summary's words with every `{…}` expression replaced by `#`, balanced —
 * a template literal with `${…}` inside it is one expression, not two.
 */
export function summaryWords(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "{") {
      const inner = balancedFrom(raw, i);
      if (inner === null) break;
      // Keep the words of a template literal; drop its interpolations.
      const literal = inner.trim().match(/^`([\s\S]*)`$/);
      out += literal ? literal[1].replace(/\$\{[^}]*\}/g, "#") : "#";
      i += inner.length + 2;
    } else {
      out += raw[i];
      i += 1;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}
