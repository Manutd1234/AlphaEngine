/**
 * No hook on this tab sits below a conditional return.
 *
 * WHAT THIS COSTS WHEN IT IS WRONG: the whole dashboard, not the section.
 * `StakePane` shipped with `useLiveSeries` below its `if (!target)` branch, so
 * a COLD load — no family on the first render, a family on the next — ran one
 * render with fewer hooks than the one after it. React tears the tree down with
 * error #310 and the page renders "This page couldn't load". Measured in Chrome
 * against a gateway with a cold read cache; the first browser check missed it
 * entirely because the universe read was already warm, `target` was truthy from
 * the first render, and the branch never fired.
 *
 * SO THE BUG IS INVISIBLE EXACTLY WHERE IT IS MOST LIKELY. A warm desk never
 * takes the early branch. A reader opening the tab for the first time always
 * does. And no assertion on this desk could see it — the suite has no DOM
 * (CLAUDE.md, fact 6), so nothing renders twice and nothing counts hooks.
 *
 * This reads the source instead: for every component on the tab, find the first
 * `return` that is INSIDE a conditional, and fail if any `use*(` call appears
 * after it. That is a coarse rule and deliberately so — the React rule is
 * exactly this coarse, and every legitimate shape on this tab already obeys it.
 *
 * The eslint rule that normally does this is not available: the web workspace
 * has no lint script at all (CLAUDE.md, fact 2), and adding one would be a new
 * dependency, which the house forbids.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripNonCode } from "./helpers/workspace-sources";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Every component the Markets rail can reach, plus the console itself. */
function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".tsx")) out.push([next, readFileSync(join(root, next), "utf8")]);
    }
  };
  walk("components/coherence");
  out.push(["components/MarketsConsole.tsx", readFileSync(join(root, "components/MarketsConsole.tsx"), "utf8")]);
  return out;
}

/**
 * The index of the first COMPONENT-LEVEL return that is reached conditionally.
 *
 * INDENTATION IS THE TEST, and the first version of this got it wrong in the
 * direction that matters: it accepted an `if` at two to six spaces, which is
 * also where `if (!open) return;` sits inside a `useEffect` callback. Two
 * pickers failed for a `return` that exits an effect, not a render.
 *
 * A component's own body is at exactly two spaces in this codebase, so an early
 * return is `  if (…) {` with a `return` under it, or `  if (…) return`. A
 * callback's body is deeper by construction. That is a convention rather than a
 * law, which is why the hook scan below is anchored the same way — both halves
 * have to be at the component's own level for the pair to mean anything.
 */
function firstConditionalReturn(code: string): number {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^ {2}if \(/.test(lines[i])) continue;
    // `if (…) return …` on one line, or a `return` in the block it opens.
    if (/^ {2}if \([^)]*\) return[\s(;]/.test(lines[i])) return lines.slice(0, i).join("\n").length;
    for (let j = i + 1; j < Math.min(i + 30, lines.length); j += 1) {
      if (/^ {4}return[\s(;]/.test(lines[j])) return lines.slice(0, j).join("\n").length;
      if (/^ {2}\}/.test(lines[j])) break;
    }
  }
  return -1;
}

describe("every hook runs on every render", () => {
  const files = sources();

  it("finds the tab's components at all", () => {
    // A walk that found nothing would make every assertion below vacuous, which
    // is the failure mode a source-scanning suite has by default.
    assert.ok(files.length > 40, `only ${files.length} components scanned — has the tab moved?`);
  });

  for (const [path, raw] of files) {
    it(`${path.replace("components/", "")} calls no hook after a conditional return`, () => {
      // Comments and strings blanked: several files QUOTE the defect in their
      // headers — including the one that caused it — and a raw scan reads that
      // prose as the defect itself.
      const code = stripNonCode(raw);
      const cut = firstConditionalReturn(code);
      if (cut === -1) return;
      const after = code.slice(cut);
      // Hooks at the COMPONENT's own indent, for the reason the return scan is
      // anchored there: a `use*` inside a callback is not a hook call of this
      // component and never was.
      const hooks = [...after.matchAll(/^ {2}(?:const [\w{}, ]+ = )?(use[A-Z]\w*)\(/gm)]
        .map((match) => match[1]);
      assert.deepEqual(
        [...new Set(hooks)],
        [],
        `${path} calls ${[...new Set(hooks)].join(", ")} after a conditional return. On the render that `
        + "takes the branch React sees fewer hooks, and on the next it sees more — error #310 tears down "
        + "the whole dashboard, not this section. Move the hook above the branch.",
      );
    });
  }
});
