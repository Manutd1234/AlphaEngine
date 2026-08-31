#!/usr/bin/env node
/** Read-only historical baselines for protected copy and the 71 engine views. */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { locationHash, VIEWS_BY_TAB } from "../lib/section-views";
import {
  COHERENCE_SECTIONS, DATA_SECTIONS, DEVELOPER_SECTIONS, DIFFUSION_SECTIONS,
  EXECUTION_SECTIONS, MARKETS_SECTIONS, OVERVIEW_SECTIONS, PORTFOLIO_SECTIONS,
  RELIABILITY_SECTIONS, RESEARCH_SECTIONS, RISK_SECTIONS,
  type WorkspaceSectionDef,
} from "../lib/sections";

const WEB = resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPONENTS = join(WEB, "components");

interface ProtectedDefinition {
  panel: string;
  roots: readonly string[];
  sections: readonly WorkspaceSectionDef[];
}

const PROTECTED: Record<string, ProtectedDefinition> = {
  overview: { panel: "overview", roots: ["components/WorkspaceOverview.tsx"], sections: OVERVIEW_SECTIONS },
  research: { panel: "research", roots: ["components/ResearchWorkspace.tsx"], sections: RESEARCH_SECTIONS },
  execution: {
    panel: "live",
    roots: ["components/LiveMarket.tsx", "components/execution/ExecutionCockpit.tsx"],
    sections: EXECUTION_SECTIONS,
  },
  portfolio: { panel: "portfolio", roots: ["components/PortfolioWorkspace.tsx"], sections: PORTFOLIO_SECTIONS },
  risk: { panel: "risk", roots: ["components/RiskWorkspace.tsx"], sections: RISK_SECTIONS },
  data: { panel: "data", roots: ["components/DataConsole.tsx"], sections: DATA_SECTIONS },
  reliability: { panel: "reliability", roots: ["components/ReliabilityConsole.tsx"], sections: RELIABILITY_SECTIONS },
  developer: { panel: "developer", roots: ["components/DeveloperConsole.tsx"], sections: DEVELOPER_SECTIONS },
};

const STRUCTURAL_ATTRIBUTES = new Set([
  "className", "id", "role", "htmlFor", "key", "href", "type", "name", "value",
  "method", "action", "target", "rel", "aria-controls", "aria-labelledby", "aria-describedby",
  "data-testid", "data-view", "data-section", "data-plane", "suppressHydrationWarning",
]);

const STRUCTURAL_PROPERTIES = new Set([
  "id", "path", "route", "endpoint", "className", "method", "href", "key", "value", "kind",
]);

const COPY_PROPERTIES = new Set([
  "label", "title", "description", "detail", "lede", "reading", "missing", "reason", "note",
  "summary", "kicker", "hint", "text", "message", "meaning", "question", "explanation", "empty",
  "error", "unit", "source", "transport",
]);

function normalise(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&rsquo;/g, "’")
    .replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function looksLikeCopy(value: string): boolean {
  if (!value || /^(?:@\/|\.?\.\/|\/api\/|https?:\/\/|var\(|[.#][a-z_-])/i.test(value)) return false;
  if (/^[a-z][a-z0-9_.:/_-]*$/.test(value)) return false;
  return /[\p{L}\p{N}▲✕○◌✓✗→●]/u.test(value);
}

function propertyName(node: ts.Node): string | null {
  const parent = node.parent;
  if (!ts.isPropertyAssignment(parent) || parent.initializer !== node) return null;
  return ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name) ? parent.name.text : null;
}

function enclosingAttribute(node: ts.Node): ts.JsxAttribute | null {
  let parent: ts.Node | undefined = node.parent;
  while (parent && !ts.isSourceFile(parent) && !ts.isJsxElement(parent)) {
    if (ts.isJsxAttribute(parent)) return parent;
    parent = parent.parent;
  }
  return null;
}

function literalIsCopy(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
      || ts.isExternalModuleReference(parent) || ts.isLiteralTypeNode(parent)) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node) return false;
  const attribute = enclosingAttribute(node);
  if (attribute) {
    const name = attribute.name.getText();
    return !STRUCTURAL_ATTRIBUTES.has(name) && !name.startsWith("data-");
  }
  const key = propertyName(node);
  return !key || !STRUCTURAL_PROPERTIES.has(key);
}

function certainCopyContext(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return true;
  const attribute = enclosingAttribute(node);
  if (attribute && COPY_PROPERTIES.has(attribute.name.getText())) return true;
  const key = propertyName(node);
  return key !== null && COPY_PROPERTIES.has(key);
}

/** Human-facing static literals in one TS/TSX source; comments and machine attributes are absent. */
export function staticCopy(source: string, filename = "baseline.tsx"): string[] {
  const kind = filename.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const add = (raw: string, certain = false) => {
    const value = normalise(raw);
    if ((certain && /[\p{L}\p{N}▲✕○◌✓✗→●]/u.test(value)) || looksLikeCopy(value)) found.push(value);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) add(node.text, true);
    else if (ts.isTemplateExpression(node)) {
      const attribute = enclosingAttribute(node);
      if (!attribute || (!STRUCTURAL_ATTRIBUTES.has(attribute.name.getText())
          && !attribute.name.getText().startsWith("data-"))) {
        add(`${node.head.text}${node.templateSpans.map((span) => `\${…}${span.literal.text}`).join("")}`,
          certainCopyContext(node));
      }
      return;
    } else if (ts.isStringLiteralLike(node) && literalIsCopy(node)) add(node.text, certainCopyContext(node));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(WEB, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile() && /\.tsx?$/.test(candidate)) return candidate;
    } catch { /* try the next extension */ }
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  parsed.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveImport(file, node.moduleSpecifier.text);
      if (target) imports.push(target);
    }
  });
  return imports;
}

function closure(roots: readonly string[]): string[] {
  const queue = roots.map((root) => join(WEB, root));
  const seen = new Set<string>();
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file) || !file.startsWith(WEB) || /(?:tests|scripts)\//.test(relative(WEB, file))
        || file.includes(".generated.")) continue;
    seen.add(file);
    for (const imported of importsOf(file)) if (!seen.has(imported)) queue.push(imported);
  }
  return [...seen].sort();
}

function panelSlice(panel: string): string {
  const source = readFileSync(join(COMPONENTS, "workspace/WorkspacePanels.tsx"), "utf8");
  const marker = source.indexOf(`id="panel-${panel}"`);
  if (marker < 0) throw new Error(`panel-${panel} is absent from WorkspacePanels`);
  const start = source.lastIndexOf("<section", marker);
  const tags = /<section\b|<\/section>/g;
  tags.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(source))) {
    depth += match[0] === "</section>" ? -1 : 1;
    if (depth === 0) return source.slice(start, tags.lastIndex);
  }
  throw new Error(`panel-${panel} has no closing section`);
}

function corpus(definition: ProtectedDefinition): string[] {
  const values = closure(definition.roots).flatMap((file) => staticCopy(readFileSync(file, "utf8"), file));
  values.push(...staticCopy(panelSlice(definition.panel), `panel-${definition.panel}.tsx`));
  for (const section of definition.sections) values.push(section.label, section.description);
  return values.map(normalise).filter(looksLikeCopy).sort();
}

export interface ContentSignature { sha256: string; strings: number; words: number }

export function signatureFor(values: readonly string[]): ContentSignature {
  const strings = [...values].sort();
  const words = strings.reduce((total, value) =>
    total + (value.match(/[\p{L}\p{N}]+(?:[’'.%/-][\p{L}\p{N}]+)*/gu)?.length ?? 0), 0);
  return {
    sha256: createHash("sha256").update(JSON.stringify(strings), "utf8").digest("hex"),
    strings: strings.length,
    words,
  };
}

export function verifySignature(expected: ContentSignature, actual: ContentSignature): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`static copy changed: expected ${expected.sha256}, received ${actual.sha256}`);
  }
}

export function buildProtectedBaseline() {
  const corpora: Record<string, string[]> = {};
  const signatures: Record<string, ContentSignature> = {};
  for (const [tab, definition] of Object.entries(PROTECTED)) {
    corpora[tab] = corpus(definition);
    signatures[tab] = signatureFor(corpora[tab]);
  }
  return { corpora, signatures };
}

export interface EngineViewBaseline {
  product: "markets" | "proofs" | "diffusion";
  routeTab: "markets" | "coherence" | "diffusion";
  section: string;
  view: string;
  label: string;
  id: string;
  deepLink: string;
}

export function buildEngineInventory(): EngineViewBaseline[] {
  const tabs = [
    ["markets", "markets", MARKETS_SECTIONS],
    ["proofs", "coherence", COHERENCE_SECTIONS],
    ["diffusion", "diffusion", DIFFUSION_SECTIONS],
  ] as const;
  return tabs.flatMap(([product, routeTab, sections]) => sections.flatMap((section) =>
    (VIEWS_BY_TAB[routeTab]?.[section.id] ?? []).map(([view, label]) => ({
      product, routeTab, section: section.id, view, label,
      id: `${product}/${section.id}/${view}`,
      deepLink: locationHash(routeTab, section.id, view),
    }))));
}

export function buildEngineWordBaseline(): Record<string, ContentSignature> {
  const roots = {
    markets: ["components/MarketsConsole.tsx"],
    proofs: ["components/CoherenceConsole.tsx"],
    diffusion: ["components/DiffusionConsole.tsx"],
  };
  return Object.fromEntries(Object.entries(roots).map(([tab, entries]) => {
    const values = closure(entries).flatMap((file) => staticCopy(readFileSync(file, "utf8"), file));
    return [tab, signatureFor(values)];
  }));
}

export interface ClaimDefaults {
  sourceVersion: string;
  sampleRule: string;
  threshold: string;
  uncertainty: string;
  states: string[];
  exactAlternative: string;
  conclusionLimitations: string;
  delivery: string;
}

export interface ClaimSection {
  decisionQuestion: string;
  requiredTerms: string[];
  formulae: string[];
  unitTimeBasis: string;
}

export type ExpandedClaim = EngineViewBaseline & ClaimDefaults & ClaimSection;

export function expandClaimLedger(
  defaults: ClaimDefaults,
  sections: Record<string, ClaimSection>,
  inventory: EngineViewBaseline[],
): ExpandedClaim[] {
  return inventory.map((view) => {
    const claims = sections[`${view.product}/${view.section}`];
    if (!claims) throw new Error(`${view.id} has no claim-section baseline`);
    return { ...defaults, ...claims, ...view };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({
    protected: buildProtectedBaseline().signatures,
    engineViews: buildEngineInventory(),
    wordBaseline: {
      browserObserved: false,
      method: "source-static import-closure upper bound",
      tabs: buildEngineWordBaseline(),
    },
  }, null, 2));
}
