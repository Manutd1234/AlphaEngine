/**
 * The blast-radius map: thirty-five claims about what a server write touches.
 *
 * A drawing is the easiest place in a codebase to assert something false,
 * because it looks like documentation rather than a claim —
 * `breaker-machine.test.ts` opens with that sentence and this suite is its
 * sibling. The claims here are the cells of the scope matrix, and every one was
 * read out of `lib/operator.ts`. Where the code states a rule as a constant,
 * this reads the constant rather than the drawing's word for it:
 * `CACHE_PREFIXES` decides whether a purge can reach a breaker, so the "Purge
 * leaves circuits intact" cell is checked against it. A drawing that got that
 * one wrong would be wrong in the most expensive direction — it would tell an
 * operator that a purge is a way out of an open circuit.
 *
 * WHAT THIS SUITE WILL NOT DO is check that the drawing looks like anything. It
 * checks that the model is complete and is what the write path does, that
 * nothing here needs a pointer or reads by colour, and that the map has a
 * caller — a capability with no caller is the defect this repository keeps a
 * scar about.
 *
 * The dashes and their reasons are `reliability-mutations-absence.test.ts`; the
 * move that created the pane is `reliability-mutations-move.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EFFECT_STYLE,
  MUTATION_STORES,
  SERVER_MUTATIONS,
} from "@/components/systems/mutation-scope";
import { CACHE_PREFIXES, OPERATOR_ACTIONS } from "@/lib/operator-actions";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const console_ = read("../components/ReliabilityConsole.tsx");
const panel = read("../components/systems/OperatorPanel.tsx");
const controls = read("../components/systems/OperatorControls.tsx");
const map = read("../components/systems/MutationScopeMap.tsx");
const diagram = read("../components/systems/MutationScopeDiagram.tsx");
const model = read("../components/systems/mutation-scope.ts");

/** Comments blanked. Every file here argues in prose about the very sentences
 *  and constructs it is being checked for, so a whole-file scan would find the
 *  explanation and report the thing as present after it had been cut. */
const code = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (_m, lead: string) => lead);

/** What a reader meets before opening anything. */
const uncollapsed = (source: string) => code(source).replace(/<details[\s\S]*?<\/details>/g, " ");

/** Tags stripped, entities resolved, whitespace collapsed. */
const prose = (source: string) =>
  source
    .replace(/<[^>]+>/g, " ")
    .replace(/&apos;|&rsquo;/g, "’")
    .replace(/\s+/g, " ")
    .trim();

describe("the sources this file is about are actually loaded", () => {
  it("reads every file the pane is built from, non-empty", () => {
    // A scan of "" satisfies every negative assertion below and reads exactly
    // like a clean bill of health. This trap has been found twice in this tree.
    for (const [name, source] of [
      ["ReliabilityConsole", console_], ["OperatorPanel", panel], ["OperatorControls", controls],
      ["MutationScopeMap", map], ["MutationScopeDiagram", diagram], ["mutation-scope", model],
    ] as const) {
      assert.ok(source.length > 500, `${name} loaded empty or truncated`);
    }
  });
});

// --------------------------------------------------------------------------
// 2 — the model is complete, and it is what the write path actually does.
// --------------------------------------------------------------------------

describe("the scope matrix is complete", () => {
  it("has five mutations and seven stores, so thirty-five cells", () => {
    assert.equal(SERVER_MUTATIONS.length, 5);
    assert.equal(MUTATION_STORES.length, 7);
    const cells = SERVER_MUTATIONS.flatMap((row) => MUTATION_STORES.map((s) => row.effects[s.id]));
    assert.equal(cells.length, 35);
    assert.equal(cells.filter(Boolean).length, 35, "a store with no answer is a gap the drawing would hide");
  });

  it("gives every cell a reason, and none of them is a restatement of the word", () => {
    for (const row of SERVER_MUTATIONS) {
      for (const store of MUTATION_STORES) {
        const cell = row.effects[store.id];
        assert.ok(cell.reason.length > 24, `${row.id}/${store.id}: "${cell.reason}" says nothing`);
        assert.ok(
          !cell.reason.startsWith(EFFECT_STYLE[cell.effect].word),
          `${row.id}/${store.id}: the reason repeats the word it is meant to explain`,
        );
      }
    }
  });

  it("dispatches only actions the wire contract accepts", () => {
    for (const row of SERVER_MUTATIONS) {
      assert.ok(row.actions.length > 0, `${row.id} names no action`);
      for (const action of row.actions) {
        assert.ok(
          (OPERATOR_ACTIONS as readonly string[]).includes(action),
          `${row.id} claims an action the server does not have: ${action}`,
        );
      }
    }
  });
});

describe("the cells agree with lib/operator.ts, not with the prose beside them", () => {
  it("a purge cannot reach a breaker or a quota ledger, because CACHE_PREFIXES says so", () => {
    /**
     * `operator-actions.ts` states the rule as data — "Cache namespaces a purge
     * may touch. Deliberately excludes `quota:` and `breaker:`." — so the two
     * cells are checked against the constant. A drawing that disagreed with
     * this would be wrong in the most expensive direction: it would tell an
     * operator that a purge is a way out of an open circuit.
     */
    const purge = SERVER_MUTATIONS.find((row) => row.id === "purge_cache")!;
    assert.equal(purge.effects.circuits.effect, "intact");
    assert.equal(purge.effects.ledgers.effect, "intact");
    assert.ok(!(CACHE_PREFIXES as string[]).includes("breaker"));
    assert.ok(!(CACHE_PREFIXES as string[]).includes("quota"));
    assert.equal(purge.effects.cache.effect, "clears");
  });

  it("clearing telemetry leaves behaviour alone, exactly as the executor's caveat says", () => {
    const executor = read("../lib/operator.ts");
    assert.match(
      executor,
      /Simulated outages and circuit-breaker state are untouched — those are behaviour, not observation\./,
    );
    const clear = SERVER_MUTATIONS.find((row) => row.id === "clear_telemetry")!;
    assert.equal(clear.effects.circuits.effect, "intact");
    assert.equal(clear.effects.outages.effect, "intact");
    assert.equal(clear.effects.telemetry.effect, "clears");
    // The nuance the prose reading missed: the cache COUNTERS go, the cached
    // responses stay. Two different stores, and only one of them is emptied.
    assert.equal(clear.effects.cache.effect, "intact");
  });

  it("a reload re-reads rather than clears, and cannot be drawn as a recovery", () => {
    const reload = SERVER_MUTATIONS.find((row) => row.id === "reload_providers")!;
    assert.equal(reload.effects.config.effect, "rereads");
    assert.equal(reload.effects.circuits.effect, "intact");
    assert.equal(reload.effects.outages.effect, "intact");
  });

  it("restoring routing clears both circuits and simulated outages and nothing else", () => {
    const restore = SERVER_MUTATIONS.find((row) => row.id === "reset_breaker")!;
    const cleared = MUTATION_STORES
      .filter((store) => restore.effects[store.id].effect === "clears")
      .map((store) => store.id);
    assert.deepEqual(cleared, ["circuits", "outages"]);
  });
});

describe("nothing on this pane reaches the vendor's meter", () => {
  it("every mutation reports the vendor's meter as out of reach", () => {
    /**
     * The single most important column. "Reset a quota ledger" is the one
     * button on the desk whose name most invites the opposite belief, and the
     * executor's own comment calls its caveat "the single most important
     * sentence in this file".
     */
    for (const row of SERVER_MUTATIONS) {
      assert.equal(
        row.effects.vendor.effect,
        "unreachable",
        `${row.id} claims to touch a meter this deployment cannot read`,
      );
    }
  });

  it("the quota reset says why in its own cell, not only in the shared default", () => {
    const quota = SERVER_MUTATIONS.find((row) => row.id === "reset_quota")!;
    assert.match(quota.effects.vendor.reason, /still believes it served those calls/);
    // `may` is the qualifier that keeps it honest: further requests are not
    // certain to be refused, and asserting that they will be is its own wrong
    // answer. The sentence beside the button carries the same word.
    assert.match(quota.effects.vendor.reason, /may reject or bill the next ones/);
  });

  it("the map repeats the warning on screen, unfolded", () => {
    assert.match(
      prose(uncollapsed(map)),
      /clears our count and not the vendor’s meter/,
      "the map may not be the one surface that leaves this out",
    );
  });
});

// --------------------------------------------------------------------------
// 4 — it reads with no pointer, and it never means anything by colour alone.
// --------------------------------------------------------------------------

describe("the diagram is not the only route to any fact", () => {
  it("gives every effect a distinct mark from the house status vocabulary", () => {
    const VOCABULARY = ["●", "▲", "✕", "○", "◌", "✓", "✗", "→"];
    const glyphs = Object.values(EFFECT_STYLE).map((style) => style.glyph);
    assert.equal(new Set(glyphs).size, glyphs.length, "two effects share a mark, so colour is the carrier again");
    for (const glyph of glyphs) {
      assert.ok(VOCABULARY.includes(glyph), `${glyph} is not in the status vocabulary`);
    }
  });

  it("prints a word beside every mark, so a greyscale print still reads", () => {
    for (const style of Object.values(EFFECT_STYLE)) {
      assert.ok(style.word.length > 4, `"${style.word}" is not a word a reader can act on`);
    }
    // The matrix renders mark and word together; the mark alone is hidden from
    // assistive technology, which would otherwise announce a bullet.
    assert.match(map, /<span aria-hidden>\{style\.glyph\}<\/span> \{style\.word\}/);
  });

  it("states the same thirty-five cells as text in a table, not only as a drawing", () => {
    assert.match(map, /<table className="mutation-map__matrix">/);
    assert.match(map, /SERVER_MUTATIONS\.map\(\(row\) => \(/);
    assert.match(map, /<th scope="row">\{row\.label\}<\/th>/);
    // Eight columns need a scroll container of their own; the page must not
    // scroll sideways, and a keyboard reader needs to reach the scroll.
    assert.match(map, /<div className="table-wrap" tabIndex=\{0\}>/);
  });

  it("keeps the drawing one labelled image rather than thirty-five focus stops", () => {
    // The drawing moved through `Figure`/`Plot` on 2026-08-26, so the image
    // role and the name are the FIGURE's now — a `role="img"` on the svg inside
    // one would be an image nested in an image. The property under test is
    // unchanged and is now enforced rather than conventional: `Plot` takes
    // exactly one tab stop, so thirty-five cells cannot become thirty-five
    // focus stops even if someone makes them focusable.
    assert.match(diagram, /ariaLabel=\{label\}/,
      "the diagram no longer names itself, so the matrix is an unlabelled image");
    assert.match(diagram, /<Plot height=\{266\} viewBox="0 0 560 266">/,
      "the diagram no longer keeps its own coordinate system");
    assert.match(read("../components/coherence/Figure.tsx"), /tabIndex=\{interactive \? 0 : undefined\}/,
      "the plot is no longer a single tab stop");
    assert.doesNotMatch(code(diagram), /tabIndex|onClick|onFocus/,
      "a focusable SVG node is a keyboard trap wearing a diagram's clothes");
  });

  it("selects with real buttons that say which one is pressed", () => {
    assert.match(map, /className="seg mutation-map__picker" role="group" aria-label="Highlight one mutation"/);
    assert.match(map, /aria-pressed=\{selected === row\.id\}/);
    assert.match(map, /type="button"/);
    // Toggling off is reachable: the selected button deselects rather than
    // trapping the reader in a highlighted state with no way back.
    assert.match(map, /current === row\.id \? null : row\.id/);
  });

  it("reports the unselected state rather than rendering nothing", () => {
    assert.match(prose(map), /No mutation is highlighted/);
  });

  it("animates nothing, so there is nothing for reduced motion to remove", () => {
    for (const [name, source] of [["MutationScopeMap", map], ["MutationScopeDiagram", diagram]] as const) {
      assert.doesNotMatch(code(source), /transition|animate|setInterval|requestAnimationFrame/,
        `${name} grew motion, which now needs a prefers-reduced-motion answer`);
    }
  });
});

// --------------------------------------------------------------------------
// 5 — the map has a caller, and its figures are the badges' own.
// --------------------------------------------------------------------------

describe("the map is wired, and states the numbers the buttons state", () => {
  it("is mounted where its subject is", () => {
    assert.match(code(panel), /<MutationScopeMap/, "the map is a capability with no caller");
    // Below the controls it describes, not above them: the rows and their
    // prices are what a reader came to press.
    assert.ok(code(panel).indexOf("<OperatorControls") < code(panel).indexOf("<MutationScopeMap"));
  });

  it("is threaded the same counts OperatorControls is, never a second derivation", () => {
    /**
     * Two derivations of one fact agree only for as long as they happen to
     * coincide. The map takes `openCircuits`, `simulated`, `quotaLedgers` and
     * the counters from the panel that already computed them for the badges, so
     * a figure on the map cannot disagree with the badge ten pixels above it.
     */
    const stripped = code(panel);
    const at = stripped.indexOf("<MutationScopeMap");
    const props = stripped.slice(at, stripped.indexOf("/>", at));
    for (const prop of [
      "registryObserved={observed}", "openCircuits={openCircuits}", "simulated={simulated}",
      "quotaLedgers={quotaLedgers}", "cacheEntries={counters?.cacheEntries ?? null}",
      "eventsRetained={counters?.eventsRetained ?? null}",
    ]) {
      assert.ok(props.includes(prop), `the map re-derives instead of reading: ${prop}`);
    }
    assert.doesNotMatch(code(map), /providers|health\./,
      "the map reads the counts it is handed, never the snapshot itself");
  });

  it("the pane exists, leads the switcher and is the one the reader lands on", () => {
    assert.match(console_, /\{ id: "mutations", label: "Mutations"/);
    assert.match(console_, /useState<RemediationPane>\("mutations"\)/);
  });
});
