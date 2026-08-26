/**
 * Every addressable view is in the command palette, generated from the one
 * table and never listed twice.
 *
 * The palette reads its sections from `lib/sections.ts` "so a renamed section
 * cannot leave a stale command behind" (its own header). Views had no entries
 * at all — the palette knew the section a reader could reach and not the view
 * inside it, so "Proofs → Coherence test → Proof" was a press away from a
 * search that could not find it. `lib/workspace-view-commands.ts` adds one
 * entry per NON-DEFAULT view: the section's own entry already opens the
 * default, and two rows that open the same place are noise.
 *
 * The ids carry a `view-` prefix so `workspace-commands-unique`'s count of
 * `sec-` entries (one per rail section, the shape a nesting bug once broke)
 * is untouched.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCommands, type CommandDeps } from "../lib/workspace-commands";
import { COHERENCE_SECTIONS, MARKETS_SECTIONS } from "../lib/sections";
import { defaultView, viewsFor, VIEWS_BY_TAB } from "../lib/section-views";
import { NAV_ITEMS } from "../lib/workspace-nav";
import { read } from "./helpers/workspace-sources";

function deps(): CommandDeps {
  const noop = (() => {}) as never;
  return new Proxy({} as CommandDeps, {
    get: (_target, key) => {
      if (key === "running" || key === "autoRun" || key === "autoSuspended") return false;
      if (key === "req") return { symbol: "BTCUSDT", strategy: "sma_crossover" };
      if (key === "view") return "overview";
      if (key === "currentPinned") return null;
      return noop;
    },
  });
}

const RAILS: Record<string, ReadonlyArray<{ id: string; label: string }>> = { markets: MARKETS_SECTIONS, coherence: COHERENCE_SECTIONS };
const navLabel = (tab: string) => NAV_ITEMS.find((item) => item.id === tab)?.label ?? tab;

describe("one palette entry per non-default view, from the table", () => {
  const commands = buildCommands(deps());
  const views = commands.filter((command) => command.id.startsWith("view-"));

  it("emits exactly as many as the table has non-default views", () => {
    let expected = 0;
    for (const tab of Object.keys(VIEWS_BY_TAB)) {
      for (const section of Object.keys(VIEWS_BY_TAB[tab as keyof typeof VIEWS_BY_TAB] ?? {})) {
        expected += viewsFor(tab, section).filter(([id]) => id !== defaultView(tab, section)).length;
      }
    }
    assert.ok(expected >= 20, `only ${expected} non-default views in the table — a tab is missing`);
    assert.equal(views.length, expected, `${views.length} view commands for ${expected} non-default views`);
  });

  it("names each one by tab, section and view, in the reader's words", () => {
    for (const tab of Object.keys(VIEWS_BY_TAB)) {
      for (const section of RAILS[tab] ?? []) {
        for (const [id, label] of viewsFor(tab, section.id)) {
          const command = views.find((c) => c.id === `view-${tab}-${section.id}-${id}`);
          if (id === defaultView(tab, section.id)) {
            assert.equal(command, undefined, `the default view ${tab}/${section.id}/${id} has its own entry; the section's entry already opens it`);
            continue;
          }
          assert.ok(command, `no palette entry for ${tab}/${section.id}/${id}`);
          assert.equal(command.category, "View");
          assert.ok(command.label.startsWith(`${navLabel(tab)} → `), `${command.id} does not start with the tab's nav label: ${command.label}`);
          assert.ok(command.label.includes(section.label) && command.label.endsWith(label),
            `${command.id} does not name its section and view: ${command.label}`);
        }
      }
    }
  });

  it("is generated from viewsFor, never from a second list", () => {
    const source = read("../lib/workspace-view-commands.ts");
    assert.match(source, /viewsFor\(/, "workspace-view-commands.ts does not read the table");
    assert.doesNotMatch(source, /\["(?:verdict|proof|bands|parlays|baskets|families)"/, "a view id is spelled in the palette module — that is a second table");
    assert.match(source, /locationHash\(/, "a view command must write the same hash the writers do");
  });
});
