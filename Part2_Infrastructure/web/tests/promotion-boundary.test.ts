/**
 * Promotion reaches the paper-pricing surface, and nothing further.
 *
 * `components/research/PromotionPanel.tsx` used to carry a paragraph on screen
 * saying so: promotion moves a candidate to the paper-pricing surface only,
 * and order submission, position sizing and the kill switch stay behind the
 * authenticated risk gateway. The desk asked for that paragraph to go. The
 * sentence was the only thing holding the claim, which is the failure mode this
 * repository has already been bitten by — a boundary documented in prose
 * disappears the day someone edits the prose, and nothing turns red.
 *
 * So the claim moves here. These tests are structural rather than textual on
 * purpose: the property is not that some sentence exists, it is that the
 * research surface has no path to the execution gateway. Each assertion below
 * is something a future edit would have to break deliberately.
 *
 * Three things are held:
 *
 *   1. **The closure.** Every module reachable from the panel by import is
 *      scanned for network reach. The panel is inert today because everything
 *      it pulls in is arithmetic and formatting; the hazard is a helper three
 *      hops down quietly growing a `fetch`.
 *   2. **The prop.** `onHandOff` takes no arguments. A panel that cannot
 *      describe an order cannot submit one, whatever it is handed.
 *   3. **The call site.** The prop is a bare callback, so the panel is only as
 *      inert as what `components/research/DecisionSection.tsx` passes it — the
 *      Research tab's own Decision section since `page.tsx` was split. What it
 *      passes is state staging plus navigation, and that is pinned here.
 *
 * `desk-interconnect.test.ts` also touches this hand-off, but it is asking a
 * different question — that the link lands on live/trade rather than wherever
 * execution was last read. That is a routing property. This file is the safety
 * one, and they should not be merged: a rewording of the destination table
 * must not be able to take the security assertion down with it.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = join(root, "components/research/PromotionPanel.tsx");

/**
 * Source with comments stripped, so only code is scanned.
 *
 * This matters more than it looks. The removal that prompted this file left a
 * comment behind naming the boundary, and that comment names `/api/gateway`
 * precisely because it is describing what must not appear. Scanning raw text
 * would flag the note that exists to protect the rule.
 */
function code(text: string): string {
  return text
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")   // {/* JSX comment */}
    .replace(/\/\*[\s\S]*?\*\//g, " ")                // /* block */
    .replace(/^\s*\/\/.*$/gm, " ");                    // // line
}

/** Resolve an import specifier to a file in this repo, or null if it is a package. */
function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [base + ".ts", base + ".tsx", join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function specifiers(text: string): string[] {
  return [...text.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Every repo file the panel reaches by import, transitively, plus the packages it stops at. */
function closure(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      const resolved = resolveSpec(spec, file);
      if (resolved === null) packages.add(spec);
      else queue.push(resolved);
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort() };
}

/**
 * The shapes that mean "this module can talk to the execution side".
 *
 * Named rather than regex-golfed so a failure says which capability appeared.
 */
const REACH: ReadonlyArray<readonly [string, RegExp]> = [
  ["a network call", /\bfetch\s*\(/],
  ["a request object", /\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/],
  ["a same-origin API path", /["'`]\/api\//],
  ["a gateway helper", /\b(?:callGateway|gatewayBase|gatewayHeaders|failureBody)\s*\(/],
  ["a risk-control helper", /\b(?:submitRiskAction|buildRiskRequest|operatorHeaders)\s*\(/],
];

/** Imports that would put the gateway one call away even without using it yet. */
const FORBIDDEN_IMPORT = /(?:^|\/)(?:lib\/)?(?:gateway|risk-control)$|api\/gateway/;

const { files, packages } = closure(ENTRY);

describe("the promotion panel's import closure cannot reach execution", () => {
  it("resolves a closure worth checking", () => {
    // A resolver that silently returned nothing would make every assertion
    // below pass for the wrong reason. These two are the panel's own imports,
    // one component and one library, so a broken resolver cannot fake them.
    assert.ok(files.length > 5, `only ${files.length} files in the closure`);
    assert.ok(
      files.some((f) => f.endsWith("lib/format.ts")),
      "the closure walker did not resolve `@/lib/format`, so it is not really walking",
    );
    assert.ok(
      files.some((f) => f.endsWith("components/common/NumberTicker.tsx")),
      "the closure walker did not resolve `@/components/common/NumberTicker`",
    );
  });

  it("the reach scanner actually detects reach", () => {
    // The positive control. `lib/risk-control.ts` is the module on the far side
    // of the boundary — it submits halt, resume and flatten to the gateway. If
    // the patterns below cannot see it, they cannot see anything, and the whole
    // file is a green light with no bulb in it.
    const control = code(readFileSync(join(root, "lib/risk-control.ts"), "utf8"));
    const seen = REACH.filter(([, pattern]) => pattern.test(control)).map(([name]) => name);
    assert.ok(
      seen.length >= 2,
      `the scanner found only ${seen.length} kinds of reach in risk-control.ts, so it is blind`,
    );
  });

  it("no module the panel imports makes a network call", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = code(readFileSync(file, "utf8"));
      for (const [what, pattern] of REACH) {
        const hit = source.match(pattern);
        if (hit) offenders.push(`${file.slice(root.length)} — ${what}: ${hit[0]}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "promotion is a research surface and must stay one; something it imports now reaches "
        + `the network:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("no module the panel imports pulls in the gateway or risk control", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of specifiers(code(readFileSync(file, "utf8")))) {
        if (FORBIDDEN_IMPORT.test(spec)) offenders.push(`${file.slice(root.length)} imports ${spec}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `order submission, sizing and the kill switch stay behind the authenticated gateway:\n  `
        + offenders.join("\n  "),
    );
  });

  it("stops at react and nothing else", () => {
    // The closure's only external edge. A new package here is either a new
    // dependency — banned outright — or a transport, which is the thing this
    // file exists to prevent.
    assert.deepEqual(
      packages,
      ["react"],
      `the panel's closure now reaches packages beyond react: ${packages.join(", ")}`,
    );
  });
});

describe("the panel cannot describe an order", () => {
  const panel = readFileSync(ENTRY, "utf8");

  it("its only outward action is a callback that takes no arguments", () => {
    // `onHandOff: (ticket: OrderTicket) => void` would be the first move toward
    // submission, and it would look like a harmless prop change.
    assert.match(
      code(panel),
      /onHandOff:\s*\(\)\s*=>\s*void;/,
      "onHandOff now carries a payload — a panel that can describe an order is one edit from sending it",
    );
    const props = code(panel).slice(code(panel).indexOf("interface PromotionPanelProps"));
    assert.doesNotMatch(
      props.slice(0, props.indexOf("}")),
      /\bon(?:Submit|Order|Cancel|Flatten|Halt|Kill)\w*\s*[?:]/,
      "the panel grew a prop that names an execution action",
    );
  });

  it("the button is the hand-off and nothing else", () => {
    // One button, one handler, and the handler is the prop. An onClick that did
    // its own work would sidestep every assertion above.
    assert.match(code(panel), /onClick=\{onHandOff\}/);
    assert.equal(
      (code(panel).match(/onClick=/g) ?? []).length,
      1,
      "the promotion card has more than one click handler now — check what the new one does",
    );
  });
});

describe("the call site hands promotion nothing that can execute", () => {
  // The call site moved from page.tsx into Research ▸ Decision when the shell
  // was split. It is still the research/execution boundary; the shell hands
  // the sleeve setter down as `onStageSleeve` and its cross-link helper as
  // `onOpenSection`, so the two statements below are the same two acts.
  const page = code(readFileSync(join(root, "components/research/DecisionSection.tsx"), "utf8"));
  const body = page.match(/onHandOff=\{\(\) => \{([\s\S]*?)\n\s*\}\}/)?.[1];

  it("the hand-off callback is found", () => {
    // Held separately so a rename of the prop fails loudly here rather than
    // making the assertions below vacuously pass on an empty string.
    assert.ok(body, "no `onHandOff={() => { … }}` in components/research/DecisionSection.tsx — has the prop been renamed?");
  });

  it("it stages a sleeve and navigates, and does nothing else", () => {
    const statements = (body ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    assert.deepEqual(
      statements,
      [
        "onStageSleeve(data.request.strategy);",
        'onOpenSection("live", "trade");',
      ],
      "the promotion hand-off does something beyond staging the strategy and opening the "
        + "execution ticket — anything else here crosses the research/execution boundary",
    );
  });

  it("it names no execution verb", () => {
    // The belt to the braces above: if the statement list is ever relaxed, this
    // still catches the specific thing that must never appear in this callback.
    assert.doesNotMatch(
      body ?? "",
      /\b(?:fetch|submit|placeOrder|sendOrder|cancel|flatten|halt|kill)/i,
      "the promotion hand-off reaches an execution action",
    );
  });
});
