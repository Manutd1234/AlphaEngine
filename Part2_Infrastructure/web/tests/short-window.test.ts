/**
 * A short window fails with its cause and its fix, not just its symptom.
 *
 * THE DEFECT THIS PINS
 *
 * `runSweep` throws `Not enough data: 3 bars.` — a true sentence that helps
 * nobody. A user who picked MSFT · 4h saw it and had no way to know the cause
 * (free equity tiers keep a few days of intraday history and years of daily —
 * the same provider serves 400 daily bars and 6 four-hourly ones for the same
 * ticker) or the fix (switch one dropdown to 1d). It read as a broken app.
 *
 * The route now refuses short windows itself, before the engine, because the
 * route is the only layer that knows which provider answered and what was
 * asked. Same class as the equity-routing bug this repo already documents in
 * `marketdata-routing.test.ts`: a message that names the wrong thing is how a
 * fixable problem survives.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const route = read("../app/api/backtest/route.ts");
const engine = read("../lib/engine.ts");
const page = read("../app/page.tsx");

describe("the route's floor and the engine's floor are one number", () => {
  it("both say 200", () => {
    // If the engine's floor ever rises above the route's, the unhelpful throw
    // comes back for the band between them — the exact regression this file
    // exists to prevent. Read from both sources so a change to either fails.
    assert.match(route, /const MIN_BARS = 200;/);
    assert.match(engine, /bars\.length < 200/);
  });

  it("the route checks before the engine can throw", () => {
    // The order is the fix: `bars.length < MIN_BARS` must be evaluated on the
    // loaded window before runSweep sees it.
    const check = route.indexOf("bars.length < MIN_BARS");
    const sweep = route.indexOf("runSweep(bars");
    assert.ok(check > -1, "the route no longer checks the window");
    assert.ok(sweep > -1, "the route no longer calls runSweep");
    assert.ok(check < sweep, "the engine throws before the route can explain");
  });
});

describe("the failure names cause and fix, machine-readably", () => {
  it("answers 422, not 400", () => {
    // The request was well-formed; the data was not there. A client cannot fix
    // a 400 by switching interval, and these are different problems.
    assert.match(route, /status: 422/);
  });

  it("suggests the interval that would work", () => {
    assert.match(route, /suggestedInterval/);
    // Only when the caller was not already on daily — suggesting 1d to a 1d
    // request would be an instruction to do what was just done.
    assert.match(route, /interval !== "1d"/);
  });

  it("names the provider that answered and the counts", () => {
    for (const field of ["source", "barsReturned", "barsRequired"]) {
      assert.match(route, new RegExp(`${field}:`), `${field} missing from the 422 body`);
    }
  });

  it("still distinguishes 'no provider at all' from 'thin history'", () => {
    // Synthetic means nothing answered; a short real window means the provider
    // answered honestly with what it had. Different causes, different fixes,
    // and the message must not collapse them.
    assert.match(route, /source === "synthetic"/);
  });
});

describe("a substitution is confessed, never silent", () => {
  /**
   * The trap has fired twice. A stale whitelist replaced 23 strategies with
   * ma_cross for months. Then a probe sent "tsmom" — a name this catalogue
   * does not use — got ma_cross back, printed its own input instead of the
   * server's echo, and reported a PASS for a strategy that never ran. The
   * fallback is deliberate; the silence was the defect.
   */
  it("an unknown strategy is reported in warnings", () => {
    assert.match(route, /is not in the catalogue — this ran/);
  });

  it("an invalid symbol and interval are reported too", () => {
    assert.match(route, /is not a valid ticker — this ran/);
    assert.match(route, /is not offered — this ran/);
  });

  it("only actual substitutions are confessed, not omitted fields", () => {
    // An omitted field taking its default is the contract working. Warning on
    // it would bury the one substitution that matters under three that do not.
    for (const field of ["symbol", "interval", "strategy"]) {
      assert.match(
        route,
        new RegExp(`body\\.${field} !== undefined`),
        `${field} coercion does not distinguish omitted from invalid`,
      );
    }
  });

  it("coercions lead the warning list", () => {
    // "This ran a different strategy than you asked for" outranks every data
    // caveat that follows it.
    assert.match(route, /warnings\.unshift\(\.\.\.coercions\)/);
  });
});

describe("the banner turns the fix into a click", () => {
  it("offers the suggested interval as an action", () => {
    assert.match(page, /Switch to \{errorFix\} and rerun/);
  });

  it("reruns explicitly rather than trusting the Auto toggle", () => {
    // `updateRequest` alone only sets state; with Auto off nothing would run
    // and the button would be a lie. The override carries the new interval so
    // the rerun does not race the state update.
    assert.match(page, /void run\(\{ interval: errorFix \}\)/);
  });

  it("clears the stale suggestion on every new run", () => {
    // A fix belonging to a previous failure must not decorate the next one.
    assert.match(page, /setError\(null\);\s*setErrorFix\(null\);/);
  });
});
