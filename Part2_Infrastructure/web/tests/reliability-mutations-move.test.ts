/**
 * The Mutations pane: the move, and the four sentences it could have lost.
 *
 * The server mutations took their own pane in Remediation. A move is the
 * cheapest possible place to lose a sentence: the screenshot afterwards looks
 * correct whether or not the amber warning about the vendor's meter came with
 * it, and nothing in a type checker knows that four particular sentences are
 * the ones standing between an operator and a misunderstood destructive
 * button. So each of them is asserted present, verbatim, and asserted
 * UNFOLDED — behind a disclosure is the same as gone for a reader whose finger
 * is already on the button.
 *
 * The other half of the move is the SPLIT it made. `OperatorPanel` renders two
 * `part`s now, and the pane boundary runs between the writes and the reference
 * surface they used to share a pane with. Everything a reader needs before
 * pressing had to travel with the writes: the guard and its token field, the
 * confirmation preview, the disabled reasons, the price under each row. This
 * suite checks the boundary by position rather than by presence, because
 * "OperatorGuard is somewhere in the file" is exactly what a botched split
 * still satisfies.
 *
 * The MAP the same pane grew is `reliability-mutations-map.test.ts`; the pane
 * switcher itself is `remediation-panes.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const panel = read("../components/systems/OperatorPanel.tsx");
const controls = read("../components/systems/OperatorControls.tsx");

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
      ["OperatorPanel", panel], ["OperatorControls", controls],
    ] as const) {
      assert.ok(source.length > 500, `${name} loaded empty or truncated`);
    }
  });
});

// --------------------------------------------------------------------------
// 1 — the move. Every sentence that stops a misunderstanding travelled.
// --------------------------------------------------------------------------

describe("the four sentences that stop a destructive button being misread", () => {
  /**
   * Each is a COST or a CORRECTION OF THE OBVIOUS READING, which is why none of
   * them may fold. "Reload" obviously means "pick up my new key" and does not;
   * "Close all circuits" obviously means "declare it healthy" and does not;
   * "Reset counter" obviously means "I have my calls back" and does not. A
   * reader who acts on the obvious reading of any of the three is the reader
   * this pane exists for.
   */
  const REQUIRED = [
    {
      what: "the amber warning that a ledger reset clears our count and not the vendor's",
      needle: "This clears <em>our</em> count, not the vendor",
      sentence: "This clears our count, not the vendor\u2019s meter; further requests may still be "
        + "rejected upstream or billed.",
    },
    {
      what: "the price of a purge",
      needle: "The next request for each purged key goes upstream and spends a real call.",
      sentence: "The next request for each purged key goes upstream and spends a real call.",
    },
    {
      what: "what closing a circuit actually asks",
      needle: "Closing a circuit asks the provider again; it does not declare it healthy.",
      sentence: "Closing a circuit asks the provider again; it does not declare it healthy.",
    },
    {
      what: "the reload that cannot read a changed .env from disk",
      needle: "Cannot import a changed <code>.env</code> from disk; new keys need a redeploy.",
      sentence: "Cannot import a changed .env from disk; new keys need a redeploy.",
    },
  ] as const;

  for (const { what, needle, sentence } of REQUIRED) {
    it(`${what} is on the Mutations pane, word for word`, () => {
      // Both readings, because JSX wraps a sentence anywhere: the raw fragment
      // catches a rewritten tag, the prose form catches a truncation at a line
      // break — and a needle tied to one line break rots the day a formatter
      // moves it.
      assert.ok(controls.includes(needle), `the move dropped: ${needle}`);
      assert.ok(prose(controls).includes(sentence), `the move truncated: ${sentence}`);
    });

    it(`${what} is on screen at rest, not behind a fold`, () => {
      assert.ok(
        uncollapsed(controls).includes(needle),
        "a cost you must open a fold to find is a cost you meet after clicking",
      );
    });
  }

  it("the authenticated-in-production notice moved with the buttons it qualifies", () => {
    assert.match(uncollapsed(panel), /Authenticated in production/);
    assert.match(uncollapsed(panel), /<span className="page-kicker">Server mutations<\/span>/);
  });

  it("the guard travelled with the buttons it gates, not with the scope summary", () => {
    /**
     * The whole argument for splitting the pane this way. A disabled button
     * whose reason — and whose token field — lives one pane away is a button
     * with no reason on it, and `OperatorGuard` is both. The scope part returns
     * before either is reached, so the check is positional.
     */
    const stripped = code(panel);
    const scopeReturn = stripped.indexOf('if (part === "scope")');
    const scopeEnd = stripped.indexOf("  return (", scopeReturn);
    assert.ok(scopeReturn > 0 && scopeEnd > scopeReturn, "OperatorPanel no longer has two parts");
    const scopePart = stripped.slice(scopeReturn, scopeEnd);
    assert.doesNotMatch(scopePart, /<OperatorGuard/, "the token field is stranded on the reference pane");
    assert.doesNotMatch(scopePart, /<OperatorControls/, "a write button is on the reference pane");
    assert.match(stripped.slice(scopeEnd), /<OperatorGuard/);
    assert.match(stripped.slice(scopeEnd), /<OperatorControls/);
  });

  it("keeps the confirmation path on all three disruptive actions", () => {
    // Moving a pane must not quietly turn a previewed action into a bare click.
    for (const action of ["purge_cache", "reset_quota", "clear_telemetry"]) {
      const at = controls.indexOf(`action: "${action}"`);
      assert.ok(at > 0, `${action} is no longer dispatched from OperatorControls`);
      const before = controls.slice(Math.max(0, at - 400), at);
      assert.match(before, /onRequestConfirmation\(/, `${action} lost its confirmation preview`);
    }
    assert.match(code(panel), /<OperatorConfirmation/);
    assert.match(code(panel), /const disabled = locked \|\| missingToken/);
  });

  it("names a dimmed control's reason in the markup, not only in a title", () => {
    // The empty-ledger case: the select is empty and Reset counter is dimmed.
    assert.match(
      uncollapsed(controls),
      /No provider in this instance keeps a local quota ledger, so there is nothing to reset\./,
    );
  });
});
