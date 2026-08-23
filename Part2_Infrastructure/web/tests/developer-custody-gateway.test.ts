/**
 * The gateway OpenAPI custody chain, held against the artefacts it draws.
 *
 * WHY THIS SUITE IS SEPARATE FROM `developer-custody.test.ts`. That file pins
 * the numerics chain and the shortening this tab may never do. This one pins a
 * different property, and it is the property a drawn chain fails at: a diagram
 * whose boxes are not the real files is worse than no diagram, because a reader
 * who trusts a picture stops opening the files. `SignalDAGViewer` once drew a
 * "FIX Protocol Execution Engine" into a system with no FIX in it, and that is
 * the failure this file exists to make impossible for this chain.
 *
 * So the assertions below do not check that the component says the right words.
 * They OPEN THE ARTEFACTS — main.py, tools/export_openapi.py, tools/openapi.json,
 * the checker, the two generated modules, package.json and the CI workflow —
 * and check that what the chain draws is what those files do. Every one of them
 * is outside `web/`, which is the whole point: this chain crosses a deployment
 * boundary, and a suite that only read `web/` could not tell whether the other
 * side of the contract still existed.
 *
 * THE STRONGEST ASSERTION HERE RUNS THE REAL GATE. Rather than reimplementing
 * the canonicalisation and hoping it matches, this suite executes
 * `scripts/check-gateway-openapi-digest.mjs` — the same script `prebuild` runs —
 * and requires exit 0 and the committed digest on stdout. That makes the suite
 * a second verifier of the same claim rather than a paraphrase of it, and it
 * means a stale digest fails here, in a file that prints the remedy, instead of
 * surfacing later as a panel confidently drawing a chain to a wrong value.
 *
 * WHAT IT REFUSES TO ACCEPT. A tick the panel has not earned. `next dev` never
 * runs `prebuild`, so under the dev server nothing has verified the committed
 * digest, and the derivations are asserted to report that as an absence with a
 * reason rather than as a pass. The same for a live comparison held in a
 * five-minute cache after the gateway stopped answering: the digest must dash.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type { SystemHealthView } from "../lib/use-system-health";
import { GATEWAY_CONTRACT_PATHS } from "../lib/gateway-contract.generated";
import { COMMITTED_GATEWAY_OPENAPI_SHA256 } from "../lib/gateway-openapi-digest.generated";
import {
  buildGate,
  contractPill,
  contractReading,
  gatewayContractChain,
  type ContractReading,
} from "../components/developer/GatewayContractCustodyChain";

import { readSource } from "./helpers/source-files";

const WEB = fileURLToPath(new URL("../", import.meta.url));
const GATEWAY_ROOT = join(WEB, "..");
const REPO_ROOT = join(GATEWAY_ROOT, "..");

const PANEL = "components/developer/GatewayContractCustodyChain.tsx";
const TRACK = "components/developer/CustodyChainTrack.tsx";
const INTERFACES = "components/developer/DeveloperInterfaces.tsx";

/** Comments blanked: a comment quoting a sentence is not the sentence rendering. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/[^\n]*/g, "$1");
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const rendered = (file: string) => collapse(code(readSource(file)));

/** A file outside `web/`, read from the repository rather than described. */
function artefact(relativeToGateway: string): string {
  const text = readFileSync(join(GATEWAY_ROOT, relativeToGateway), "utf8");
  assert.ok(
    text.trim().length > 0,
    `${relativeToGateway} read as empty — the chain draws it, so a scan over nothing would pass here and mislead there`,
  );
  return text;
}

/** The health view the derivation reads, with only the fields it reads. */
function view(health: unknown): SystemHealthView {
  return { health } as unknown as SystemHealthView;
}

const SCHEMA_EVIDENCE = {
  kind: "gateway_openapi" as const,
  algorithm: "sha256" as const,
  expectedDigest: COMMITTED_GATEWAY_OPENAPI_SHA256,
};

const LIVE_DIGEST = "b".repeat(64);
const PLATFORM = { version: "1.0.0", environment: "test", status: "healthy" };

// ---------------------------------------------------------------------------

describe("the chain drawn is the contract in the repository", () => {
  const chain = gatewayContractChain({ phase: "waiting" }, buildGate("development"));

  it("names five artefacts, and every one of them is a file that exists", () => {
    assert.equal(chain.length, 5, "the chain changed shape — the artefacts below are the path, not a sample");
    const paths: Record<string, string> = {
      "main.py": "main.py",
      "tools/export_openapi.py": "tools/export_openapi.py",
      "tools/openapi.json": "tools/openapi.json",
      "scripts/check-gateway-openapi-digest.mjs": "web/scripts/check-gateway-openapi-digest.mjs",
      "lib/gateway-openapi-digest.generated.ts": "web/lib/gateway-openapi-digest.generated.ts",
    };
    for (const link of chain) {
      const onDisk = paths[link.artefact];
      assert.ok(onDisk, `the chain draws "${link.artefact}", which is not one of the five artefacts on this path`);
      artefact(onDisk);
    }
  });

  it("labels every edge with the operation that produces the next artefact", () => {
    assert.deepEqual(
      chain.map((link) => link.operation),
      ["app.openapi()", "sorted-key JSON", "canonicalise, then SHA-256", "compare", null],
      "the edges are the difference between a chain and a row of boxes; the terminal node carries null",
    );
  });

  it("draws the snapshot's second consumer instead of leaving it to prose", () => {
    // One committed snapshot feeds two artefacts. A diagram that drew only the
    // digest leg would say the snapshot has one consumer when it has two, and a
    // reader who regenerated it without the client would learn that from a red
    // test rather than from the picture in front of them.
    const snapshot = chain.find((link) => link.id === "snapshot");
    assert.equal(snapshot?.branch?.artefact, "lib/gateway-contract.generated.ts");
    const generator = readSource("scripts/generate-gateway-client.ts");
    assert.match(generator, /lib\/gateway-contract\.generated\.ts/);
    assert.match(generator, /writeFileSync\(outPath, rendered\)/);
  });

  it("the exporter really renders sorted keys and really has a --check mode", () => {
    // Both are load-bearing on the node's text: sorted keys are why a router
    // re-order in main.py cannot move the digest, and --check is what makes an
    // accidental contract change a diff rather than a client's 500.
    const exporter = artefact("tools/export_openapi.py");
    assert.match(exporter, /json\.dumps\(schema, indent=2, sort_keys=True\)/);
    assert.match(exporter, /"--check" in argv/);
    assert.match(exporter, /ENABLE_MARKET_DATA/, "the node says the exporter neutralises the local .env");
  });

  it("main.py really assembles the routers the first node names", () => {
    const main = artefact("main.py");
    const registered = main.match(/for _router in \(([\s\S]*?)\):/);
    assert.ok(registered, "main.py no longer registers its routers in one loop — the node's text describes one");
    const routers = registered[1].split(",").map((line) => line.trim()).filter(Boolean);
    assert.equal(routers.length, 9, `the chain's first node says nine routers; main.py registers ${routers.length}`);
    assert.match(main, /app\.openapi\(\)|FastAPI\(/, "main.py is the application object the exporter imports");
  });

  it("the checker really canonicalises by sorting keys and really uses SHA-256", () => {
    const checker = readSource("scripts/check-gateway-openapi-digest.mjs");
    assert.match(checker, /Object\.keys\(value\)\.sort\(\)/);
    assert.match(checker, /createHash\("sha256"\)/);
    assert.match(checker, /\.\.\/\.\.\/tools\/openapi\.json/, "the checker reads the gateway's snapshot, not a copy");
  });
});

describe("the gate the panel claims is the gate that runs", () => {
  it("prebuild runs the checker, so npm run build cannot reach Next.js with a stale digest", () => {
    const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts.prebuild, /node scripts\/check-gateway-openapi-digest\.mjs/);
    assert.equal(pkg.scripts.build, "next build");
  });

  it("CI runs each half in the unit that owns it", () => {
    // The two halves are checked by two different jobs on two different
    // runtimes, which is the shape of the claim: the gateway proves the
    // snapshot still describes its own routes, the web build proves the digest
    // still describes the snapshot. Neither job can cover for the other.
    const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const gatewayJob = ci.slice(ci.indexOf("  gateway:"), ci.indexOf("  openbb-service:"));
    const webJob = ci.slice(ci.indexOf("  web:"), ci.indexOf("  live-smoke:"));
    assert.match(gatewayJob, /python tools\/export_openapi\.py --check/);
    assert.match(webJob, /run: npm run build/);
    assert.doesNotMatch(gatewayJob, /npm run build/);
  });

  it("the committed digest still describes the committed snapshot", () => {
    /**
     * The real gate, executed rather than paraphrased. Reimplementing the
     * canonicalisation here would give this suite a second opinion that could
     * quietly disagree with the one `prebuild` enforces; running the script
     * means the panel's "verified at build time" claim and this assertion are
     * about the same computation.
     */
    let stdout: string;
    try {
      stdout = execFileSync(process.execPath, [join(WEB, "scripts/check-gateway-openapi-digest.mjs")], {
        encoding: "utf8",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      assert.fail(
        "The gateway OpenAPI digest is stale, so npm run build is red and the panel is drawing a chain to a "
          + "value that no longer describes tools/openapi.json. Remedy: run python tools/export_openapi.py, then "
          + `write the digest the checker prints into lib/gateway-openapi-digest.generated.ts.\n${detail}`,
      );
    }
    assert.match(stdout, new RegExp(`Gateway OpenAPI digest verified: ${COMMITTED_GATEWAY_OPENAPI_SHA256}`));
  });

  it("the path count printed on the snapshot node is counted, not asserted", () => {
    const document = JSON.parse(artefact("tools/openapi.json")) as { paths: Record<string, unknown> };
    assert.equal(
      GATEWAY_CONTRACT_PATHS.length,
      Object.keys(document.paths).length,
      "the node prints GATEWAY_CONTRACT_PATHS.length as the snapshot's path count; the two have drifted, which "
        + "means the typed client is stale — regenerate it with node --import tsx scripts/generate-gateway-client.ts",
    );
  });
});

describe("the panel states what it knows, and separates the two things it knows", () => {
  it("a dev session has not verified anything, and says so without a tick", () => {
    const gate = buildGate("development");
    assert.equal(gate.ran, false);
    assert.match(gate.why, /next dev does not run prebuild/);
    const link = gatewayContractChain({ phase: "waiting" }, gate).find((item) => item.id === "gate");
    assert.equal(link?.state, "unknown");
    assert.equal(link?.word, "not run this session");
    assert.equal(link?.produced, null, "a gate that did not run produced no digest");
    assert.equal(link?.absence, "no build in this session", "and it must not say 'nothing yet' — there is no 'yet'");
  });

  it("a production bundle names the inference rather than claiming a measurement", () => {
    const gate = buildGate("production");
    assert.equal(gate.ran, true);
    // The distinction the whole panel turns on. `next build` invoked directly
    // skips prebuild, and the bundle cannot see how it was invoked, so the
    // sentence has to say which kind of knowledge this is.
    assert.match(gate.why, /an inference from the build, not a hash taken now/);
    assert.match(gate.why, /node scripts\/check-gateway-openapi-digest\.mjs/);
  });

  it("refuses to reprint a cached live verdict after the gateway went quiet", () => {
    /**
     * `lib/delivery-readiness.ts` holds the comparison for five minutes so a
     * 30s poll is not a six-figure transfer, and that cache outlives the
     * gateway. `platform` is present only when the gateway answered this poll.
     * The same rule `schemaCompatibilityState` bought after the panel reported
     * "Drift detected" against a port that was refusing connections.
     */
    const cached = contractReading(view({
      delivery: { schema: { ...SCHEMA_EVIDENCE, state: "match", passed: true, observedDigest: LIVE_DIGEST, detail: "" } },
    }));
    assert.equal(cached.phase, "unmeasured");
    assert.ok(
      cached.phase === "unmeasured" && !cached.why.includes(LIVE_DIGEST),
      "the held digest leaked into the reason — the row would print sixty-four characters nothing read",
    );
    assert.match(cached.phase === "unmeasured" ? cached.why : "", /Nothing read the live contract this poll/);
  });

  it("distinguishes no snapshot, no evidence, no document and a real reading", () => {
    assert.equal(contractReading(view(null)).phase, "waiting");
    assert.equal(contractReading(view({ platform: PLATFORM })).phase, "unmeasured");
    assert.equal(
      contractReading(view({
        platform: PLATFORM,
        delivery: { schema: { ...SCHEMA_EVIDENCE, state: "unavailable", passed: false, observedDigest: null, detail: "No gateway is configured." } },
      })).phase,
      "unmeasured",
      "an unavailable comparison is an absence with a cause, never a quiet pass",
    );
    const live = contractReading(view({
      platform: PLATFORM,
      delivery: { schema: { ...SCHEMA_EVIDENCE, state: "match", passed: true, observedDigest: LIVE_DIGEST, detail: "" } },
    }));
    assert.deepEqual(live, { phase: "match", observed: LIVE_DIGEST });
  });

  it("wears no tick anywhere before a poll has answered", () => {
    const chain = gatewayContractChain({ phase: "waiting" }, buildGate("development"));
    const terminal = chain[chain.length - 1];
    assert.equal(terminal.state, "unknown");
    assert.equal(terminal.word, "waiting on the poll");
    const unmeasured = gatewayContractChain({ phase: "unmeasured", why: "x" }, buildGate("development"));
    assert.equal(unmeasured[unmeasured.length - 1].word, "not verified this session");
    // The two links no browser can run are grey in every reading, because they
    // are grey in every reading. A state that changed with the poll would be
    // this panel inventing a measurement out of an unrelated one.
    for (const reading of [{ phase: "match" as const, observed: LIVE_DIGEST }, { phase: "waiting" as const }]) {
      const link = gatewayContractChain(reading, buildGate("development")).find((item) => item.id === "export");
      assert.equal(link?.state, "unknown");
      assert.equal(link?.word, "not run here");
    }
  });

  it("drift outranks the build gate in the pill, and drift is never called a build failure", () => {
    const drift: ContractReading = { phase: "mismatch", observed: LIVE_DIGEST };
    assert.equal(contractPill(drift, buildGate("production")).tone, "bad");
    assert.equal(contractPill(drift, buildGate("production")).label, "Drift detected");
    assert.equal(contractPill({ phase: "waiting" }, buildGate("production")).label, "Checking");
    const dev = contractPill({ phase: "unmeasured", why: "x" }, buildGate("development"));
    assert.equal(dev.unmeasured, true, "a session that verified nothing may not be counted as a pass or a failure");
  });
});

describe("the digest is shown whole, and the fault is shown with its remedy", () => {
  const panel = rendered(PANEL);

  it("prints all sixty-four characters through the row the first chain established", () => {
    assert.equal(COMMITTED_GATEWAY_OPENAPI_SHA256.length, 64);
    assert.match(panel, /hex=\{COMMITTED_GATEWAY_OPENAPI_SHA256\}/);
    assert.equal(panel.match(/<CustodyDigestRow/g)?.length, 2, "both digests, in the shared row");
    // No second digest renderer, and no truncation anywhere.
    assert.doesNotMatch(panel, /groupDigest|fontSize: "var\(--fs-h1\)"/);
    assert.deepEqual([...panel.matchAll(/(\w*(?:DIGEST|SHA256|Digest|digest)\w*)\.slice\(/g)].map((m) => m[0]), []);
  });

  it("borrows the shared track rather than growing a second custody visual", () => {
    assert.match(panel, /<CustodyChainTrack chain=\{chain\} label="Gateway OpenAPI custody chain" \/>/);
    // The markup lives in one file. If these class names appear here too, the
    // near-duplicate this extraction existed to prevent has been written anyway.
    for (const className of ["signal-workflow__track", "signal-workflow__stage", "signal-workflow__node"]) {
      assert.ok(!panel.includes(className), `${className} is being drawn again in ${PANEL}`);
      assert.ok(rendered(TRACK).includes(className), `${className} left the shared track`);
    }
  });

  it("says the remedy, not only the fault, and the remedy is the real sequence", () => {
    assert.match(panel, /python tools\/export_openapi\.py/);
    assert.match(panel, /node scripts\/check-gateway-openapi-digest\.mjs prints/);
    assert.match(panel, /node --import tsx scripts\/generate-gateway-client\.ts/);
    assert.match(panel, /deliberate edit/, "the digest module has no generator; the update is an edit a reviewer reads");
    // And the remedy is on screen before there is drift: it is on the build
    // gate node, which is always drawn, not only in the mismatch branch.
    const gateLink = gatewayContractChain({ phase: "waiting" }, buildGate("production")).find((l) => l.id === "gate");
    assert.match(gateLink?.detail ?? "", /python tools\/export_openapi\.py/);
  });

  it("never lets colour carry the verdict, and never ticks an unverified digest", () => {
    assert.match(panel, /word=\{gate\.ran \? "verified at build time" : "not verified this session"\}/);
    assert.match(panel, /glyph=\{gate\.ran \? STAGE_GLYPH\.ok : STAGE_GLYPH\.unknown\}/);
    assert.match(panel, /glyph=\{STAGE_GLYPH\[terminal\.state\]\}/);
    // And no pulsing dot: the card's pill reports the build gate, which is
    // committed evidence. A pulse there would claim the 30s poll produced it.
    assert.doesNotMatch(panel, /<StatusPill[^>]*live=/);
    // Tint is applied beside the glyph and the word, never instead of them.
    assert.match(panel, /tint=\{gate\.ran \? TINT\.ok : TINT\.unknown\}/);
  });

  it("adds no npm dependency", () => {
    /**
     * Anchored to a line that STARTS with `import`, unlike the numerics suite's
     * sweep over `from "…"` anywhere. Two of this file's node details end a
     * wrapped string with the word "from", and `… from " + "…` reads as an
     * import specifier to a scan that does not care where the line began.
     */
    const inTree = /^(react|react-dom|next(\/.+)?|node:.+|@\/.+|\.{1,2}\/.+)$/;
    for (const file of [PANEL, TRACK]) {
      for (const [, specifier] of readSource(file).matchAll(/^import[\s\S]*?from "([^"]+)";$/gm)) {
        assert.match(specifier, inTree, `${file} imports "${specifier}", which is neither this tree nor the framework`);
      }
    }
  });
});

describe("the capability has a caller", () => {
  it("the Contracts pane mounts it once, beside the row it expands", () => {
    // A capability with no caller is the defect this repository keeps a scar
    // about. It belongs in Contracts, not Numerics: the schema table's Gateway
    // OpenAPI row names a baseline and a candidate and cannot show the path
    // between them, and a reader who found drift should not have to hold two
    // sections in their head to say which side moved.
    const interfaces = rendered(INTERFACES);
    assert.match(interfaces, /<GatewayContractCustodyChain view=\{view\} stagger=\{2\} \/>/);
    assert.equal(interfaces.match(/<GatewayContractCustodyChain /g)?.length, 1);
    assert.match(interfaces, /pane === "contracts" && \(/);
    assert.ok(
      interfaces.indexOf("<SchemaGateTable") < interfaces.indexOf("<GatewayContractCustodyChain"),
      "the chain reads as the expansion of the table above it, so it follows the table",
    );
  });
});
