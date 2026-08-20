/**
 * The rules that keep the desk from dead-ending again.
 *
 * `scripts/desk-sweep.mjs` is the real proof — 43 sections under six fault
 * profiles in a browser — but it needs a dev server and a copy of Chrome, so it
 * runs when someone asks it to. These are the same invariants stated statically,
 * so the ones that CAN be checked on every commit are.
 *
 * Each assertion here exists because of a specific defect found in this pass:
 *
 *  - Every gateway READ carries a deadline. `useBook`, the cockpit, the audit
 *    trail and the working-orders feed were all bare `fetch` calls. Against a
 *    refused connection that is invisible; against a gateway that accepts and
 *    then never answers it left "book connecting", "Connecting to the risk
 *    gateway…" and a 220px skeleton on screen for the life of the tab.
 *  - Writes deliberately do NOT. Aborting a submitted order tells you nothing
 *    about whether it was booked, and a client that reports a timeout is
 *    claiming an outcome it does not know.
 *  - Only `live` enables a write, in one place, so twenty-odd surfaces cannot
 *    each decide it differently.
 *  - The provenance union has no dead-end member, which is what makes a
 *    forgotten branch a compile error rather than a thing to remember.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

const sourceFiles = (dir: string, exts = [".ts", ".tsx"]): string[] => {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(sourceFiles(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
};

/** Comment bodies stripped: this file's subject is vocabulary that appears in prose. */
const code = (file: string) =>
  readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const rel = (file: string) => file.slice(webRoot.length);

describe("every gateway read has a deadline", () => {
  it("no component or hook fetches a gateway route directly", () => {
    /**
     * The one exception is a write, and it is exempted by name rather than by
     * pattern so adding a second one has to be a decision.
     */
    const WRITE_EXEMPT = [
      "components/execution/OrderTicket.tsx",
      // Queues a supervised fit. `probeGateway` is GET-only — it coalesces by
      // URL, and collapsing two writes would drop one — so a write cannot use
      // it and must carry the deadline itself, which the assertion below now
      // requires of every name on this list.
      "components/research/FittedModels.tsx",
    ];

    const offenders: string[] = [];
    for (const file of [
      ...sourceFiles(join(webRoot, "components")),
      ...sourceFiles(join(webRoot, "lib")),
    ]) {
      const source = code(file);
      // A same-origin gateway or oracle route reached with the platform fetch.
      const direct = source.match(/fetch\(\s*[`"']\/api\/(gateway|oracle)[^`"']*[`"']/g);
      if (!direct) continue;
      if (WRITE_EXEMPT.some((exempt) => file.endsWith(exempt))) {
        // Assert the exemption is still a write, so this cannot silently become
        // a licence for reads in the same file.
        assert.match(source, /method:\s*"POST"/, `${rel(file)} is exempt as a write but posts nothing`);
        // The exemption is from `probeGateway`, not from its deadline. Without
        // this an exempt file can hang forever on a gateway that accepts and
        // never answers — the exact failure the rule above exists to prevent.
        assert.match(
          source, /AbortSignal\.timeout\(/,
          `${rel(file)} is exempt from probeGateway but carries no deadline of its own`,
        );
        continue;
      }
      /**
       * The rule is "bounded", not "uses probeGateway".
       *
       * OracleVarPanel carries its own AbortController on a 9s budget because a
       * 20,000-path in-database simulation legitimately takes seconds, and it
       * must not be coalesced by URL — two horizons would be served each
       * other's answer. That is a better fit than the shared helper, not a gap
       * in the rule, so a hand-rolled deadline satisfies this too.
       */
      const hasOwnDeadline = /new AbortController\(\)/.test(source)
        && /setTimeout\(\s*\(\)\s*=>\s*\w+\.abort\(\)/.test(source)
        && /signal:\s*\w+\.signal/.test(source);
      if (hasOwnDeadline) continue;
      offenders.push(`${rel(file)} — ${direct[0]}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "these reach a gateway route without the 2.5s deadline `probeGateway` carries, so a "
        + `gateway that accepts and never answers hangs them forever:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("the deadline is the value the brief asked for", () => {
    const manager = code(join(webRoot, "lib/use-gateway-connection.ts"));
    assert.match(manager, /GATEWAY_DEADLINE_MS\s*=\s*2500/);
    // An AbortController, not AbortSignal.timeout: the reason for the abort has
    // to be knowable, because "timed out" and "the component unmounted" produce
    // the same DOMException and only one is worth reporting.
    assert.match(manager, /new AbortController\(\)/);
  });

  it("the order ticket is exempt on purpose and says why", () => {
    const ticket = readFileSync(join(webRoot, "components/execution/OrderTicket.tsx"), "utf8");
    assert.match(
      ticket,
      /NOT deadlined/,
      "the write exemption above is load-bearing; if the reasoning is gone, so is the exemption",
    );
  });
});

describe("only live data may be acted on, decided once", () => {
  it("writesEnabled is the single authority", () => {
    const tier = code(join(webRoot, "lib/data-tier.ts"));
    assert.match(tier, /export function writesEnabled/);
    // Exactly one tier, expressed as an equality rather than a list, so a new
    // tier cannot accidentally arrive write-enabled.
    assert.match(tier, /return tier === "live"/);
  });

  it("no surface re-implements the write gate with its own tier test", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(webRoot, "components"))) {
      const source = code(file);
      // Enabling something on a tier comparison that is not the shared helper.
      if (/disabled=\{[^}]*tier\s*!==\s*"live"/.test(source)
        || /tier\s*===\s*"cached"\s*\|\|\s*tier\s*===\s*"sandbox"/.test(source)) {
        offenders.push(rel(file));
      }
    }
    assert.deepEqual(offenders, [], `re-implemented write gate:\n  ${offenders.join("\n  ")}`);
  });
});

describe("the provenance union cannot express a dead end", () => {
  it("DataTier has exactly three members and none of them is unavailable", () => {
    const tier = code(join(webRoot, "lib/data-tier.ts"));
    const match = /export type DataTier =([^;]+);/.exec(tier);
    assert.ok(match, "DataTier is gone");
    const members = match[1].split("|").map((m) => m.trim().replace(/"/g, "")).filter(Boolean);
    assert.deepEqual(members.sort(), ["cached", "live", "sandbox"]);
  });

  it("no provenance state renders nothing at all", () => {
    /**
     * The invariant, corrected by reading the code it was meant to police.
     *
     * The plan for this pass said to delete `"unavailable"` from the shared
     * `source` union outright, so every branch on it became a compile error.
     * Reading the six branches showed that would have been wrong. `AlertFeed`
     * and `OrderBlotter` use it well — they explain WHY a list is empty, with
     * comments recording that "an empty table must say WHY it is empty" and that
     * "a quiet desk is the good case" is only true of a live feed reporting zero
     * events. That is the behaviour this pass wants, not a defect.
     *
     * And the state is reachable only by pressing "Live gateway" on a deployment
     * that has none — an explicit request for real data. Answering it with
     * generated data would override an explicit human choice, which is the one
     * thing the desk never does; `chose.current` in `useBook` and `sandboxOff`
     * in the cockpit both exist to protect it.
     *
     * So the defect was never the state. It was one surface answering it by
     * rendering nothing: `FillQualityHeatmap` did `return null`, leaving a blank
     * plane indistinguishable from a section that failed to mount. THAT is what
     * is banned here.
     */
    const offenders: string[] = [];
    for (const file of sourceFiles(join(webRoot, "components"))) {
      const source = code(file);
      // `if (<provenance test>) return null` — on one line or two.
      const pattern = /if\s*\([^)]*\b(source|tier|provenance|state)\b[^)]*\)\s*(?:\{\s*)?return\s+(null|undefined|<>\s*<\/>)/g;
      for (const hit of source.matchAll(pattern)) {
        offenders.push(`${rel(file)} — ${hit[0].replace(/\s+/g, " ").slice(0, 80)}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a provenance state may say why a panel is empty, but no state may render nothing — a "
        + `blank plane is indistinguishable from a section that failed to mount:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("the surfaces that do carry an unavailable state explain it", () => {
    // The other half of the same rule: if a branch exists, it must produce words.
    for (const file of [
      "components/execution/AlertFeed.tsx",
      "components/execution/OrderBlotter.tsx",
      "components/execution/FillQualityHeatmap.tsx",
    ]) {
      const source = code(join(webRoot, file));
      /**
       * The COMPARISON, not the first mention.
       *
       * `indexOf('"unavailable"')` found the prop type declaration at the top of
       * FillQualityHeatmap — `source: "live" | "sandbox" | "unavailable"` — and
       * then looked for prose in the 500 characters of type signatures that
       * follow it. The branch is what has to explain itself.
       */
      const comparison = /===\s*"unavailable"/.exec(source);
      assert.ok(comparison, `${file} no longer handles the live-only outage state`);
      const index = comparison.index;
      /**
       * A real sentence within reach of the branch.
       *
       * The first version of this looked for three consecutive four-letter words
       * and failed on "The event stream has no source in this deployment."
       * because "has" is three. Measuring the length of the string literal is
       * the property actually wanted: a branch that produces 25+ characters of
       * prose is explaining itself, whatever the word lengths.
       */
      const near = source.slice(index, index + 500);
      const literals = [...near.matchAll(/"([^"]{25,})"/g)].map((m) => m[1]);
      assert.ok(
        literals.length > 0,
        `${file} branches on the outage state without saying anything about it`,
      );
    }
  });
});

describe("generated payloads are derived, never invented twice", () => {
  it("every fallback adapter is built from the shared sandbox generators", () => {
    /**
     * The binding rule from the contract review: do not write a second
     * generator. `sandboxBlotter` already reconciles to the cent with
     * `sandboxBook`'s attribution table, so a fallback derived from it inherits
     * that agreement; a fallback with its own numbers would have to re-earn it,
     * and a generated desk that disagrees with itself is worse than an error
     * because no banner can say which half is wrong.
     */
    const dir = join(webRoot, "lib/fallbacks");
    const files = sourceFiles(dir);
    assert.ok(files.length > 0, "lib/fallbacks is empty — no adapters to check");
    for (const file of files) {
      const source = code(file);
      assert.match(
        source,
        /from "@\/lib\/(blotter|portfolio|portfolio-risk)"/,
        `${rel(file)} generates its own data instead of deriving it from the sandbox desk`,
      );
    }
  });

  it("the audit adapter emits the wire shape, not the parsed one", () => {
    /**
     * The trap this avoids, verbatim from the contract review: returning
     * `BlotterRow` where the wire shape belongs is not a type error — the parser
     * reads `symbol`, `ts` and `accepted`, which camelCase rows still satisfy —
     * so every row survives and renders "—" for quantity, notional, fill, fee
     * and latency, keyed on an undefined order_id. Green, and wrong.
     */
    const adapter = code(join(webRoot, "lib/fallbacks/audit.ts"));
    for (const wireField of ["order_id", "fill_price", "fee_usd", "latency_ms", "rejected_by"]) {
      assert.match(adapter, new RegExp(`${wireField}:`), `audit adapter omits ${wireField}`);
    }
    // And it must not quietly default a value the source did not have: a
    // rejected order has no quantity, and 0 rendered as "0.0000" beside a
    // max_order_notional rejection — a zero-size order refused for being large.
    assert.doesNotMatch(adapter, /quantity:\s*row\.quantity\s*\?\?\s*0/);
  });
});
