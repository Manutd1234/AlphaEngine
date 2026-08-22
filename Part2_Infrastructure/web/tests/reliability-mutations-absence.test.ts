/**
 * The Mutations map's honesty floor: a dash, and the reason for it.
 *
 * `deriveStoreQuantities` is where this pane can lie without anyone noticing.
 * Six of the seven stores it draws carry a live figure, and the seventh — the
 * vendor's meter — carries none and never will. The failure mode is not a wrong
 * number; it is a zero standing in for a reading nobody took. "0 open of 8"
 * beside Restore routing is an answer when the registry was read, and a claim
 * about a registry nobody has seen when it was not, and the two render
 * identically. So the two are tested apart: an empty registry keeps its zeros
 * because that is a measurement, and a refusing health route dashes and names
 * the refusal.
 *
 * The same rule reaches the drawing's spoken form. It is `role="img"`, so its
 * `aria-label` IS the diagram for anyone who cannot see it, and a figure
 * missing from that string is a figure withheld from one reader and shown to
 * another.
 *
 * The matrix's thirty-five cells are `reliability-mutations-map.test.ts`; the
 * move that created the pane is `reliability-mutations-move.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  deriveStoreQuantities,
  describeMutationScope,
  type MutationScopeInput,
} from "@/components/systems/mutation-scope";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const map = read("../components/systems/MutationScopeMap.tsx");

/** Comments blanked: this file argues in prose about the very constructs it
 *  checks for, and a whole-file scan would find the explanation. */
const code = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"\'`\\])\/\/[^\n]*/g, (_m, lead: string) => lead);

/** What a reader meets before opening anything. */
const uncollapsed = (source: string) => code(source).replace(/<details[\s\S]*?<\/details>/g, " ");

/** Tags stripped, whitespace collapsed. */
const prose = (source: string) => source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the map source is actually loaded", () => {
  it("reads MutationScopeMap, non-empty", () => {
    // A scan of "" satisfies every negative assertion below and reads exactly
    // like a clean bill of health.
    assert.ok(map.length > 500, "MutationScopeMap loaded empty or truncated");
  });
});

// --------------------------------------------------------------------------
// 3 — absence is a typed state with a named reason.
// --------------------------------------------------------------------------

describe("a missing measurement dashes and says why", () => {
  const base: MutationScopeInput = {
    registryObserved: true,
    providerCount: 8,
    openCircuits: 0,
    simulated: 0,
    quotaLedgers: 5,
    cacheEntries: 0,
    stateEntries: 4,
    eventsRetained: 16,
    eventsCapacity: 600,
  };

  it("states the badges' own figures when everything was read", () => {
    const by = new Map(deriveStoreQuantities(base).map((s) => [s.id, s]));
    assert.equal(by.get("cache")!.value, "0 cached, 4 state");
    assert.equal(by.get("config")!.value, "8 providers");
    assert.equal(by.get("ledgers")!.value, "5 ledgers");
    assert.equal(by.get("telemetry")!.value, "16/600 events");
    assert.equal(by.get("circuits")!.value, "0 open of 8");
  });

  it("keeps a real zero a zero: an empty registry is a measurement", () => {
    const empty = deriveStoreQuantities({ ...base, providerCount: 0, quotaLedgers: 0 });
    const by = new Map(empty.map((s) => [s.id, s]));
    assert.equal(by.get("config")!.value, "0 providers");
    assert.equal(by.get("ledgers")!.value, "0 ledgers");
    assert.equal(by.get("config")!.absence, null);
  });

  it("dashes every registry figure when the registry was never read", () => {
    const unread = deriveStoreQuantities({ ...base, registryObserved: false });
    for (const id of ["circuits", "outages", "config", "ledgers"]) {
      const store = unread.find((s) => s.id === id)!;
      assert.equal(store.value, null, `${id} invented a figure from an unread registry`);
      assert.match(store.absence ?? "", /registry has not been observed/);
    }
  });

  it("dashes a counter an older snapshot does not carry, and names which", () => {
    const older = deriveStoreQuantities({ ...base, cacheEntries: null, eventsRetained: null });
    const by = new Map(older.map((s) => [s.id, s]));
    assert.equal(by.get("cache")!.value, null);
    assert.match(by.get("cache")!.absence ?? "", /no cache counter/);
    assert.equal(by.get("telemetry")!.value, null);
    assert.match(by.get("telemetry")!.absence ?? "", /no event counter/);
  });

  it("refuses to print a ratio when only half of it was published", () => {
    // `16/?` would put a punctuation mark where a number belongs.
    const half = deriveStoreQuantities({ ...base, eventsCapacity: null });
    const telemetry = half.find((s) => s.id === "telemetry")!;
    assert.equal(telemetry.value, "16 events, capacity not stated");
  });

  it("never states a figure for the vendor's meter, and always states why", () => {
    for (const input of [base, { ...base, registryObserved: false }]) {
      const vendor = deriveStoreQuantities(input).find((s) => s.id === "vendor")!;
      assert.equal(vendor.value, null);
      assert.match(vendor.absence ?? "", /nothing in this deployment can read it/);
    }
  });

  it("every store with no value carries a reason, in every input shape", () => {
    const shapes: MutationScopeInput[] = [
      base,
      { ...base, registryObserved: false },
      { ...base, cacheEntries: null, stateEntries: null, eventsRetained: null, eventsCapacity: null },
    ];
    for (const shape of shapes) {
      for (const store of deriveStoreQuantities(shape)) {
        if (store.value === null) {
          assert.ok(store.absence, `${store.id} dashes without saying why`);
        }
      }
    }
  });

  it("prints every dash's reason on screen, grouped, and not in a title", () => {
    /**
     * A `th` does not wrap, so the table can only afford the dash itself. The
     * reasons are collected under it instead — grouped by reason, because a
     * refusing health route dashes four stores for one cause and printing it
     * four times reads as four separate faults.
     */
    assert.match(prose(uncollapsed(map)), /Dashed above, and why:/);
    assert.match(code(map), /absences\.set\(store\.absence/);
    assert.doesNotMatch(code(map), /title=\{[^}]*absence/, "a reason living only in a tooltip");
  });

  it("the spoken description carries the quantities, not just the shape", () => {
    // The drawing is `role="img"`: this string is the whole diagram for anyone
    // who cannot see it, so a figure missing here is a figure withheld.
    const spoken = describeMutationScope(deriveStoreQuantities(base));
    assert.match(spoken, /Purge cached responses touches Cached responses \(0 cached, 4 state\)\./);
    assert.match(spoken, /Restore routing touches Circuit state \(0 open of 8\) and Simulated outages \(0 simulated\)/);
    // Said once as a preamble, not five times as a refrain: this is a label a
    // screen reader reads start to finish.
    assert.equal((spoken.match(/leaves every store not named for it intact/g) ?? []).length, 1);
    assert.match(spoken, /None of them reaches the vendor's meter/);
    const unread = describeMutationScope(deriveStoreQuantities({ ...base, registryObserved: false }));
    assert.match(unread, /not stated: the provider registry has not been observed/);
  });
});
