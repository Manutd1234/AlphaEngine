/**
 * One source for the Kalshi engine's URLs, and a warm plan that cannot drift
 * from it.
 *
 * A section on this engine can now be READ before anyone opens it — the rail warms
 * it on hover and the console sweeps the rest on idle — which is the fix for
 * seconds of "Reading the exchange…" on every first visit. It also creates a
 * failure mode nothing else here would catch: the URL exists in two places, the
 * pane that asks for it and the plan that warms it, and the first time a query
 * string diverges the warm fills a cache nobody reads. The lag comes back, and
 * every assertion in this repository still passes.
 *
 * So the URLs are built in `lib/coherence/routes.ts` and nowhere else, and this
 * file holds both halves of that: no pane may spell a gateway path itself, and
 * every section of both rails must have an entry in its own console's plan.
 *
 * TWO CONSOLES AGAIN SINCE 2026-08-24. The engine is Prices (`MarketsConsole`)
 * and Proofs (`CoherenceConsole`), and the plans are checked separately because
 * they are separately wrong-able: a section that moves tab has to take its warm
 * entry with it, and an entry left behind warms a read the console it sits in
 * can no longer draw.
 *
 * Source-level assertions, like the rest of the routing suites. There is no DOM
 * here and the property worth pinning is structural.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { COHERENCE_SECTION_IDS, MARKETS_SECTION_IDS } from "../lib/sections";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/** Every `.tsx` under components/coherence, at any depth. */
function paneFiles(relative = "components/coherence"): string[] {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? paneFiles(join(relative, entry.name))
      : entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")
        ? [join(relative, entry.name)]
        : [],
  );
}

const routes = read("lib/coherence/routes.ts");
const consoles = ["components/MarketsConsole.tsx", "components/CoherenceConsole.tsx"];

describe("the engine's gateway URLs are built in one place", () => {
  it("no pane spells a gateway path of its own", () => {
    const offenders: string[] = [];
    for (const file of [...paneFiles(), ...consoles]) {
      const source = read(file);
      for (const match of source.matchAll(/["'`]\/api\/gateway\/(coherence|diffusion)\//g)) {
        offenders.push(`${file} builds ${match[0].slice(1)}…`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a URL spelt in a pane is a URL the warm plan cannot warm — build it in lib/coherence/routes.ts",
    );
  });

  it("the routes module is the only file that does", () => {
    assert.match(routes, /\/api\/gateway\/coherence/);
    assert.match(routes, /\/api\/gateway\/diffusion/);
  });

  it("every route it exports is called by something", () => {
    const exported = [...routes.matchAll(/export const (\w+Route)\b/g)].map((match) => match[1]);
    assert.ok(exported.length >= 15, `only ${exported.length} routes are exported — the scan is measuring nothing`);
    const callers = [...paneFiles(), ...consoles, "lib/coherence/use-coherence.ts"]
      .map((file) => read(file))
      .join("\n");
    const unused = exported.filter((name) => !new RegExp(`\\b${name}\\(`).test(callers));
    assert.deepEqual(unused, [], "a route builder nothing calls is a URL that has quietly moved back into a pane");
  });
});

describe("every section can be warmed before it is opened", () => {
  /** The `SECTION_READS` literal of one console, as `{ id: [url count] }`. */
  function planOf(file: string): Record<string, number> {
    const source = read(file);
    const start = source.indexOf("const SECTION_READS");
    assert.notEqual(start, -1, `${file} no longer declares SECTION_READS`);
    const block = source.slice(start, source.indexOf("\n};", start));
    return Object.fromEntries(
      [...block.matchAll(/^ {2}(\w+): \[([^\]]*)\]/gm)]
        .map(([, id, body]) => [id, body.trim() ? body.split("),").length : 0]),
    );
  }

  /**
   * The ids whose warm list is empty ON PURPOSE, and the words that say so.
   *
   * `lessons` is the only one, and it has been through three restructures
   * without changing: it is rendered from `lib/coherence/lessons.ts` and asks
   * the gateway for nothing at all. `ablation` joined it when the 20,000-row
   * replay became its own section and left again when the replay went back to
   * being two views of Fees, so its exemption is a VIEW-level gate the Prices
   * console explains beside its own `SECTION_READS`.
   *
   * The exemption is a table rather than an `if`, and it is STRICTER than a
   * skip in two ways: an exempt id must plan exactly zero reads, and the
   * console itself has to carry the reason in prose a reader auditing
   * `SECTION_READS` will meet. An empty list that is a decision and an empty
   * list that is an oversight look identical in a diff; these regexes are what
   * tells them apart.
   */
  const UNWARMED: Record<string, RegExp> = {
    lessons: /asks the gateway for nothing/,
    // `dispersion` joined on 2026-08-25, when the RFQ channel became a section
    // again. As two views of Books its read was gated on the VIEW and warmed by
    // nothing, which is the `rfq` entry in VIEW_GATED below; as a section it is
    // gated on the section and STILL warmed by nothing, which is this entry.
    // The reason did not change with the shape: the route is a signed
    // private-channel call on a 25-second budget, and on any keyless
    // deployment it answers "no view, unsigned" every time — so warming it
    // spends the desk's slowest read to pre-fetch a refusal.
    dispersion: /pre-fetch a refusal/,
  };

  /**
   * The two reads gated on a VIEW rather than on a section, and the words the
   * Prices console owes each.
   *
   * The consolidation demoted eight sections to views, and two of them owned
   * the two most expensive calls on the engine: the signed RFQ channel (a
   * private-channel call on a 25-second budget, behind Books → Dispersion) and
   * `/replay?limit=20000` (behind Fees → Ablation). As sections they were
   * warmed and gated on the section; as views they must be warmed by nothing
   * and gated on the view, or a reader who opened Books to look at a ladder
   * pays for the slowest signed call on the desk.
   *
   * `rfq` IS A SECTION AGAIN as of 2026-08-25 and this entry stays, which is
   * the interesting case rather than an oversight: `MakersSection` gates the
   * call on its own section now, so the VIEW-level gate is gone — but the rule
   * this entry defends is the other half, that the route may not appear in
   * either console's warm plan. That is still true and is now enforced twice
   * over, here and by `dispersion` in UNWARMED above. The console still owes
   * the sentence.
   */
  const VIEW_GATED: Record<string, { route: string; why: RegExp }> = {
    rfq: { route: "rfqRoute", why: /25-second gateway budget/ },
    replay: { route: "replayRoute", why: /largest read on the tab/ },
  };

  /** Each console, its rail, and the plan that has to match it exactly. */
  const RAILS: Array<[string, string, readonly string[]]> = [
    ["Quotes", "components/MarketsConsole.tsx", MARKETS_SECTION_IDS],
    ["Proofs", "components/CoherenceConsole.tsx", COHERENCE_SECTION_IDS],
  ];

  for (const [label, file, ids] of RAILS) {
    it(`${label} plans a read for each section, and says why any is left cold`, () => {
      const source = read(file);
      const plan = planOf(file);
      assert.deepEqual(Object.keys(plan).sort(), [...ids].sort());
      for (const [id, count] of Object.entries(plan)) {
        if (id in UNWARMED) {
          assert.equal(count, 0, `${label}/${id} is on the unwarmed list but plans a read`);
          assert.match(source, UNWARMED[id], `${label}/${id} warms nothing and never says why`);
          continue;
        }
        assert.ok(count > 0, `${label}/${id} plans no read, so it will still open cold`);
      }
    });
  }

  it("no unwarmed id has quietly stopped being a section", () => {
    // A stale exemption has to be spent, or removed from the table above.
    const everywhere = RAILS.flatMap(([, file]) => Object.keys(planOf(file)));
    assert.deepEqual(
      Object.keys(UNWARMED).filter((id) => !everywhere.includes(id)),
      [],
      "an unwarmed id above is on neither rail any more",
    );
  });

  it("the two view-gated reads are warmed by nothing, and the console says why", () => {
    const prices = read("components/MarketsConsole.tsx");
    for (const [name, { route, why }] of Object.entries(VIEW_GATED)) {
      for (const [, file] of RAILS) {
        const source = read(file);
        const start = source.indexOf("const SECTION_READS");
        const plan = source.slice(start, source.indexOf("\n};", start));
        assert.ok(
          !plan.includes(route),
          `${name} is warmed from ${file}'s SECTION_READS, but it is behind a view — warming `
          + "spends it for every reader who opens the section for something else",
        );
      }
      assert.match(prices, why, `the Prices console never says why ${name} is left to its own view`);
    }
  });

  it("both consoles sweep their rail and warm on intent", () => {
    for (const file of consoles) {
      const source = read(file);
      assert.match(source, /useSectionWarming\(SECTION_READS, active\)/, `${file} does not sweep its rail`);
      assert.match(source, /onIntent=\{warmSection\}/, `${file} does not warm the section a pointer is crossing`);
    }
  });
});
