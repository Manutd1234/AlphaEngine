/**
 * Every command in the palette has an id nothing else has.
 *
 * React keys the palette list by `command.id`, so a duplicate is not a tidiness
 * problem — it renders as "Encountered two children with the same key" and
 * React is free to drop or duplicate the entries. It reached a browser once:
 * the ninth tab's section loop was pasted INSIDE the eighth tab's loop body, so
 * every coherence command was built six times, once per developer section.
 *
 * Nothing caught it. `npm test` has no DOM and never renders, the ids are
 * generated rather than written down, and a palette with 48 copies of the same
 * eight commands still type-checks and still builds. This file is the cheap
 * check that closes that gap: it counts what the builder emits.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCommands, type CommandDeps } from "../lib/workspace-commands";
import {
  COHERENCE_SECTIONS,
  DATA_SECTIONS,
  DEVELOPER_SECTIONS,
  EXECUTION_SECTIONS,
  DIFFUSION_SECTIONS,
  MARKETS_SECTIONS,
  OVERVIEW_SECTIONS,
  PORTFOLIO_SECTIONS,
  RELIABILITY_SECTIONS,
  RESEARCH_SECTIONS,
  RISK_SECTIONS,
} from "../lib/sections";

/** Every dep is a no-op: this measures what the builder EMITS, not what it does. */
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

const RAILS = [
  OVERVIEW_SECTIONS, RESEARCH_SECTIONS, EXECUTION_SECTIONS, PORTFOLIO_SECTIONS,
  RISK_SECTIONS, DATA_SECTIONS, RELIABILITY_SECTIONS, DEVELOPER_SECTIONS,
  MARKETS_SECTIONS, COHERENCE_SECTIONS, DIFFUSION_SECTIONS,
];

describe("the command palette keys every entry uniquely", () => {
  const commands = buildCommands(deps());

  it("builds a palette at all, so an empty list cannot pass the checks below", () => {
    assert.ok(commands.length > 40, `only ${commands.length} commands were built`);
  });

  it("no two commands share an id", () => {
    const seen = new Map<string, number>();
    for (const command of commands) seen.set(command.id, (seen.get(command.id) ?? 0) + 1);
    const duplicates = [...seen].filter(([, count]) => count > 1);
    assert.deepEqual(
      duplicates.map(([id, count]) => `${id} x${count}`),
      [],
      "a duplicate id renders as a duplicate React key, and React may drop or double the entry",
    );
  });

  it("emits exactly one command per rail section, and no more", () => {
    // The shape the nesting bug broke: 8 coherence sections became 48 because
    // the loop ran once per developer section.
    const expected = RAILS.reduce((total, rail) => total + rail.length, 0);
    const sectionCommands = commands.filter((command) => command.id.startsWith("sec-"));
    assert.equal(
      sectionCommands.length,
      expected,
      `${sectionCommands.length} section commands for ${expected} rail sections`,
    );
  });

  it("every rail section is reachable from the palette", () => {
    const ids = new Set(commands.map((command) => command.id));
    const missing = RAILS.flatMap((rail) => rail.map((section) => section.id))
      .filter((id) => ![...ids].some((command) => command.endsWith(`-${id}`)));
    assert.deepEqual(missing, [], "a rail section the palette cannot reach");
  });
});
