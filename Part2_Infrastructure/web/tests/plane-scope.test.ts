/**
 * A rule scoped to a tab must target classes that tab can actually render.
 *
 * THE FAULT THIS EXISTS FOR, and it has now happened twice in one evening.
 * `app/globals/14s-proofs-model.css` scoped every rule to `.proofs-plane`,
 * which was correct while Diffusion was a section of the Proofs rail. Diffusion
 * became its own tab, `DiffusionConsole` renders `.coherence-plane
 * diffusion-plane`, and six rules silently stopped matching anything. Measured
 * in Chrome afterwards, the damage was worse than the source suggested: the
 * noise-floor histogram was drawing at `height: 0px`, and the simulator's
 * ground-truth decay — the line its recovered half-life is judged AGAINST — had
 * `stroke: none` and was invisible. Four of that tab's views were unstyled.
 *
 * WHY NOTHING CAUGHT IT. `dead-css.test.ts` asks whether a class NAME appears
 * anywhere under `components`, `app` or `lib`. All six did, in the components
 * that render them. A class can be referenced everywhere it should be and still
 * be styled by a rule that cannot reach it, because the fault is not in the
 * class and not in the rule — it is in the RELATIONSHIP between the rule's scope
 * and the component's tab. No single-file check can see a relationship.
 *
 * WHAT THIS CHECKS. For every rule scoped to a specific plane, take the classes
 * it targets, find the components that render them, and assert those components
 * are reachable by import from the console that renders that plane. A rule
 * scoped to a tab whose console cannot reach the component is dead, and this
 * says so by name.
 *
 * THE FAILURE MESSAGE NAMES THE CONSOLE, not just the class, and that is
 * deliberate: the thing that cost time was not noticing the mismatch, it was
 * that nothing pointed at `DiffusionConsole` as the console in question.
 *
 * DERIVED, NEVER OBSERVED — this reads source, so it proves a rule CAN match,
 * not that the result looks right. The browser check that catches the rest is
 * `scripts/section-density-measure.mjs`, which is not in any suite because it
 * needs a server and a browser.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsPartialsOnDisk, readGlobalsPartial } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Which console renders each plane, read from source rather than assumed. */
function planeOwners(): Map<string, string> {
  const owners = new Map<string, string>();
  for (const file of sourceFiles(join(root, "components"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/className="coherence-plane ([a-z-]+-plane)"/g)) {
      owners.set(match[1], file);
    }
  }
  return owners;
}

/** Every `.ts`/`.tsx` under a directory, recursively. */
function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Resolve one import specifier to a file on disk, or null for a package. */
function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(root, specifier.slice(2));
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

/**
 * Every file a console can reach by import, transitively.
 *
 * An import graph rather than a directory rule, because the directory is not the
 * boundary any more: `components/coherence/**` is now shared by three consoles,
 * which is exactly how the fault arose.
 */
function reachableFrom(entry: string): Set<string> {
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

/** Files that put a class into rendered markup. */
function renderSites(className: string): string[] {
  const needle = new RegExp(`\\b${className.replace(/[-_]/g, "[-_]")}\\b`);
  return sourceFiles(join(root, "components"))
    .filter((file) => {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      return /className=/.test(text) && needle.test(text);
    });
}

interface ScopedRule {
  plane: string;
  classes: string[];
  where: string;
}

/**
 * Every rule in the sheet that is scoped to ONE plane, with the classes it
 * targets. Comment bodies are blanked first — several of these partials argue
 * in prose about the class they are not styling, and a scan that read comments
 * would report a rule that does not exist.
 */
function scopedRules(): ScopedRule[] {
  const out: ScopedRule[] = [];
  for (const partial of globalsPartialsOnDisk()) {
    const body = readGlobalsPartial(partial).replace(/\/\*[\s\S]*?\*\//g, (block) =>
      block.replace(/[^\n]/g, " "));
    for (const match of body.matchAll(/([^{}]+)\{[^}]*\}/g)) {
      const selector = match[1].trim().replace(/\s+/g, " ");
      if (selector.startsWith("@") || !selector) continue;
      const plane = selector.match(/\.coherence-plane\.([a-z-]+-plane)\b/)?.[1];
      if (!plane) continue;
      // The classes this rule TARGETS: every class after the plane scope.
      const after = selector.slice(selector.indexOf(plane) + plane.length);
      const classes = [...new Set([...after.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map((m) => m[1]))]
        .filter((name) => !name.endsWith("-plane"));
      if (classes.length) out.push({ plane, classes, where: partial });
    }
  }
  return out;
}

const owners = planeOwners();
const rules = scopedRules();
const reach = new Map<string, Set<string>>();
for (const [plane, console_] of owners) reach.set(plane, reachableFrom(console_));

describe("the sheet and the consoles agree about which tab a rule is for", () => {
  it("every plane in the sheet is rendered by exactly one console", () => {
    // If a plane class has no console, every rule scoped to it is dead and this
    // whole suite would pass vacuously.
    const planes = new Set(rules.map((rule) => rule.plane));
    assert.ok(planes.size >= 2, `only ${planes.size} plane(s) scoped in the sheet — has the scoping changed?`);
    const orphans = [...planes].filter((plane) => !owners.has(plane));
    assert.deepEqual(orphans, [], `these planes are styled but rendered by no console:\n  ${orphans.join("\n  ")}`);
  });

  it("every plane-scoped rule targets a class that plane's console can reach", () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      const console_ = owners.get(rule.plane);
      if (!console_) continue;
      const reachable = reach.get(rule.plane) as Set<string>;
      for (const className of rule.classes) {
        const sites = renderSites(className);
        // A class nobody renders is `dead-css.test.ts`'s business, not this
        // suite's — reporting it here would duplicate a guard and blur what
        // this one is for.
        if (!sites.length) continue;
        if (sites.some((site) => reachable.has(site))) continue;
        const consoles = [...owners.entries()]
          .filter(([, entry]) => sites.some((site) => (reach.get(owners.get([...owners.keys()].find((p) => owners.get(p) === entry) as string) as string) ?? new Set()).has(site)))
          .map(([plane]) => plane);
        offenders.push(
          `${rule.where}: .${className} is scoped to .${rule.plane} (rendered by `
          + `${console_.slice(root.length)}), but its render site(s) `
          + `${sites.map((site) => site.slice(root.length)).join(", ")} are not reachable from that console`
          + (consoles.length ? ` — they are reachable from ${consoles.join(", ")}` : ""),
        );
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a rule is scoped to a tab that cannot render what it styles, so it matches nothing:\n  "
        + offenders.join("\n  "),
    );
  });
});
