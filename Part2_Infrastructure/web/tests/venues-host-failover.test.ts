/**
 * Every venue client has somewhere to fall back to.
 *
 * A venue that cannot be reached does not announce itself as missing: it drops out
 * of the consolidated mid, the merged depth and the routing table, and every
 * "cross-venue" number quietly becomes a one-venue number that still says
 * cross-venue on the screen. That is the failure this file exists to keep out, and
 * it is a property of the transport rather than of the maths — the ladder
 * arithmetic those numbers are built from is guarded in
 * `venues-book-maths.test.ts` and `venues-routing.test.ts`.
 *
 * These are source-level assertions on purpose. The hosts they pin only diverge in
 * a deployed region, which is exactly where a test cannot stand.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readVenues } from "./helpers/venue-books";

describe("every venue client has somewhere to fall back to", () => {
  // Production surfaced the asymmetry these pin: `api.binance.com` answers
  // HTTP 451 from the serverless region and `api.bybit.com` answers HTTP 403,
  // while both work from a laptop. Binance had a mirror and recovered; Bybit
  // had one host and silently dropped out of every "cross-venue" number.
  const source = readVenues();
  const hostPreferenceSource = readFileSync(
    fileURLToPath(new URL("../lib/host-preference.ts", import.meta.url)),
    "utf8",
  );

  it("declares more than one host per venue", () => {
    const binance = /const BINANCE_HOSTS = \[([^\]]*)\]/s.exec(source)?.[1] ?? "";
    const bybit = /const BYBIT_HOSTS = \[([^\]]*)\]/s.exec(source)?.[1] ?? "";
    assert.ok(
      (binance.match(/https:/g) ?? []).length >= 2,
      "Binance must keep its mirror host",
    );
    assert.ok(
      (bybit.match(/https:/g) ?? []).length >= 2,
      "Bybit needs a fallback host — a single-host venue disappears from consolidated depth when a region is blocked",
    );
  });

  it("walks the whole host list rather than pinning the remembered one", () => {
    // The memo is a PREFERENCE. If `ordered()` ever returned a single host it
    // would become a pin, and one bad answer would strand the venue.
    //
    // The memo used to be a bare Map in the venues module and is now
    // `HostPreference`, shared with the two klines transports that had each
    // grown their own copy — so the property is asserted where it now lives.
    const fn = /ordered\(\): readonly string\[\] \{[\s\S]*?\n  \}/.exec(hostPreferenceSource)?.[0] ?? "";
    assert.ok(fn, "HostPreference.ordered() must exist");
    assert.match(fn, /\.\.\.this\.hosts\.filter/, "the non-preferred hosts must still be returned");
    assert.ok(!/return \[this\.hosts\[this\.index\]\];/.test(fn), "ordered() must not return a single host");
  });

  it("binds each memo to the host list it indexes", () => {
    // The previous Map was keyed by a string with the host array passed in
    // separately, so nothing stopped a "binance" lookup being resolved against
    // BYBIT_HOSTS. The constructor argument is what makes that unrepresentable.
    assert.match(hostPreferenceSource, /constructor\(private readonly hosts: readonly string\[\]\)/);
    assert.match(source, /new HostPreference\(BINANCE_HOSTS\)/);
    assert.match(source, /new HostPreference\(BYBIT_HOSTS\)/);
  });

  it("treats a non-zero Bybit retCode as a host failure, not a book", () => {
    // Bybit refuses at the application layer on an HTTP 200. Without throwing,
    // the loop never reaches the mirror for the one error it exists to route
    // around.
    const fn = /export async function fetchBybitBook[\s\S]*?\n}/.exec(source)?.[0] ?? "";
    assert.match(fn, /retCode !== 0/, "retCode must still be checked");
    assert.match(fn, /for \(const host of orderedHosts\("BYBIT"\)/, "Bybit must loop over hosts");
    assert.match(fn, /lastError = \(err as Error\)\.message/, "a failed host must be recorded and the loop continue");
  });
});
