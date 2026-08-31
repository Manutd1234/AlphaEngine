"use client";

/**
 * The gateway OpenAPI custody chain — the second of this repository's two, and
 * the one the numerics chain's own report named as undrawn.
 *
 * WHY IT IS THE INTERESTING ONE. The Monte Carlo chain is a claim one unit
 * makes about itself: the workspace recomputes a fixture it also ships, and
 * three runtimes of the same code have to agree. This chain crosses a
 * deployment boundary. The gateway is a Python process on its own host; the
 * workspace is a Next.js build on another; `tools/openapi.json` is the only
 * thing either of them has that describes the other. So a mismatch here is not
 * a build failure — it is the contract between two separately deployed units
 * asserting itself, which is the argument CLAUDE.md makes and the reason this
 * picture is worth drawing at all.
 *
 * WHAT IS DRAWN IS THE REAL CHAIN, read out of the files rather than described
 * from memory. Each arrow is the operation that produces the artefact after it:
 *
 *   main.py                     --app.openapi()-->
 *   tools/export_openapi.py     --sorted-key JSON-->
 *   tools/openapi.json          --canonicalise, then SHA-256-->
 *   scripts/check-gateway-openapi-digest.mjs --compare-->
 *   lib/gateway-openapi-digest.generated.ts  (the terminal node)
 *
 * and the snapshot forks: `scripts/generate-gateway-client.ts` turns the same
 * file into `lib/gateway-contract.generated.ts`, the typed bindings this
 * workspace actually calls the gateway through. That fork is drawn inside its
 * node rather than written underneath the track, because a fork a reader has to
 * be told about in prose is a fork the diagram is lying about.
 *
 * WHAT IT REFUSES TO SAY, which is more here than on the numerics chain.
 * Nothing in this browser can re-hash the snapshot: it is a quarter of a
 * megabyte, it is not in the bundle, and shipping it to a page so the page
 * could confirm a hash the page already ships would be a transfer paid by every
 * visitor for no new fact. So two links say "not run here" always, and the two
 * halves that CAN be known are reported separately, because they are separate
 * facts:
 *
 *   1. BUILD TIME. `npm run build` runs the checker in `prebuild`, so a
 *      production bundle is one the gate let through. Under `next dev` that
 *      never ran, and the panel says "not verified this session" rather than
 *      inheriting a tick from a build that did not happen.
 *   2. THIS POLL. The health route fetches the live gateway's document and
 *      hashes it server-side against the same committed digest. That reading is
 *      cached for five minutes and the cache outlives the gateway, so when the
 *      gateway did not answer THIS poll the digest row dashes and says so —
 *      repeating the held verdict would claim a document nothing read.
 */

import { type CSSProperties } from "react";

import { GATEWAY_CONTRACT_PATHS } from "@/lib/gateway-contract.generated";
import { COMMITTED_GATEWAY_OPENAPI_SHA256 } from "@/lib/gateway-openapi-digest.generated";
import { STAGE_GLYPH } from "@/lib/signal-path";
import type { SystemHealthView } from "@/lib/use-system-health";

import CustodyChainTrack, { TINT, type CustodyLink, type LinkState } from "./CustodyChainTrack";
import GatewayContractDigestTable from "./GatewayContractDigestTable";
import { StatusPill, type ControlState } from "./DeveloperStatus";
import { firstDifference } from "./NumericsCustodyDigest";

/** The paths the committed snapshot publishes, counted from the artefact off it. */
const CONTRACT_PATHS = GATEWAY_CONTRACT_PATHS.length;

/**
 * The remedy for a stale digest, written once and quoted where a reader meets
 * the fault: on the build-gate node, which is always on screen, and in the
 * live-drift note, which only appears when there is drift to remedy. A fault
 * stated without its remedy is half a report, and this one has a real sequence
 * behind it rather than "regenerate something".
 */
const REMEDY =
  "Regenerate the snapshot with python tools/export_openapi.py, write the digest that "
  + "node scripts/check-gateway-openapi-digest.mjs prints into lib/gateway-openapi-digest.generated.ts — "
  + "it is the one generated file in this tree with no generator, so that update is a deliberate edit and "
  + "the diff is what a reviewer reads — then regenerate the typed client with "
  + "node --import tsx scripts/generate-gateway-client.ts, which comes off the same snapshot.";

/**
 * What the live half of the claim is known to be, as a state rather than three
 * loose fields off the health payload.
 *
 * `unmeasured` carries its own reason instead of being one silent member,
 * because the three ways to arrive there are genuinely different: no snapshot
 * yet, no evidence in the payload, and a gateway that did not answer this poll
 * while a cached verdict is still in the object.
 */
export type ContractReading =
  | { phase: "waiting" }
  | { phase: "unmeasured"; why: string }
  | { phase: "match"; observed: string }
  | { phase: "mismatch"; observed: string };

/**
 * The live reading, derived from the health view and nothing else.
 *
 * The stale-cache guard is `schemaCompatibilityState`'s, restated here because
 * this panel needs the DIGEST and that function returns a pill. It is the same
 * rule and it must not drift: `lib/delivery-readiness.ts` holds a comparison
 * for five minutes so a 30s poll is not a six-figure transfer, and that cache
 * outlives the gateway. `platform` is present only when the gateway answered
 * this poll, so its absence is what turns a held verdict back into an absence.
 */
export function contractReading(view: SystemHealthView): ContractReading {
  if (!view.health) return { phase: "waiting" };
  const evidence = view.health.delivery?.schema;
  if (!evidence) {
    return {
      phase: "unmeasured",
      why: "This health route carries no live contract evidence, so nothing has compared the deployed gateway "
        + "with the committed digest. The digest above is what this build ships, and no more than that.",
    };
  }
  if (evidence.state === "unavailable" || evidence.observedDigest === null) {
    return { phase: "unmeasured", why: `${evidence.detail} Nothing was hashed, so there is no live digest to print.` };
  }
  if (!view.health.platform) {
    const earlier = evidence.state === "match" ? "an exact match" : "drift";
    return {
      phase: "unmeasured",
      why: `Nothing read the live contract this poll; an earlier reading found ${earlier}. That comparison is held `
        + "for five minutes in lib/delivery-readiness.ts and the cache outlives the gateway, so printing its digest "
        + "here would hand you sixty-four characters nothing read.",
    };
  }
  return { phase: evidence.state === "match" ? "match" : "mismatch", observed: evidence.observedDigest };
}

/** Whether the build gate ran, and the sentence saying how that is known. */
export type BuildGate = { ran: boolean; why: string };

/**
 * What this bundle can honestly say about the gate that produced it.
 *
 * `next dev` does not run `prebuild`, so under the dev server nothing has
 * checked the digest and the answer is a clean negative — not a hedge. A
 * production bundle is the other way round: `npm run build` runs the checker
 * first and a stale digest exits 1 before Next.js starts, so the bundle could
 * not exist if the gate had failed. That is an inference from the build rather
 * than a measurement taken now, and the sentence says which it is, because
 * `next build` invoked directly skips `prebuild` and the panel cannot see how
 * it was invoked.
 */
export function buildGate(mode: string | undefined): BuildGate {
  if (mode === "production") {
    return {
      ran: true,
      why: "npm run build runs the digest checker in prebuild, so this bundle is one the gate let "
        + "through — an inference from the build, not a hash taken now. Re-measure with "
        + "node scripts/check-gateway-openapi-digest.mjs.",
    };
  }
  return {
    ran: false,
    why: "next dev does not run prebuild, so nothing in this session has checked this digest against "
      + "tools/openapi.json — the value below is the committed one. Verify it with "
      + "node scripts/check-gateway-openapi-digest.mjs.",
  };
}

/** The terminal node's verdict: the live comparison, or a named absence. */
function terminalState(reading: ContractReading): { state: LinkState; word: string } {
  if (reading.phase === "mismatch") return { state: "down", word: "contract drift" };
  if (reading.phase === "match") return { state: "ok", word: "match this poll" };
  if (reading.phase === "waiting") return { state: "unknown", word: "waiting on the poll" };
  return { state: "unknown", word: "not verified this session" };
}

/**
 * The chain, every link's state derived from what is actually known.
 *
 * Pure over two readings and no DOM, for the reason `lib/signal-path.ts` gives
 * for `deriveSignalPath` and the numerics chain repeats: the states are then
 * assertable without rendering anything.
 */
export function gatewayContractChain(reading: ContractReading, gate: BuildGate): CustodyLink[] {
  const served = reading.phase === "match" || reading.phase === "mismatch";
  const terminal = terminalState(reading);

  return [
    {
      id: "routes",
      role: "gateway routes",
      artefact: "main.py",
      operation: "app.openapi()",
      produced: served ? "one live document, hashed" : null,
      absence: "not read this poll",
      state: served ? "ok" : "unknown",
      word: served ? "answered this poll" : "not read this poll",
      detail:
        "The FastAPI application object, assembled in main.py from twelve routers under modules/api/. The same "
        + "process serves this document live at GET /openapi.json, which is what the health route fetches and "
        + "hashes. main.py registers its routers in historical order rather than alphabetically, and records why "
        + "that cannot move the digest by itself: the exporter renders with sorted keys, so if the digest changes "
        + "after a re-order, something other than the order changed with it.",
      source: "main.py",
    },
    {
      id: "export",
      role: "exporter",
      artefact: "tools/export_openapi.py",
      operation: "sorted-key JSON",
      produced: null,
      absence: "runs in CI, not here",
      state: "unknown",
      word: "not run here",
      detail:
        "Imports main.app with ENABLE_MARKET_DATA=0 and an empty Telegram token — the schema has to describe the "
        + "code, not one developer's .env, which would otherwise bake a symbol list and a webhook path into the "
        + "snapshot — then writes json.dumps(schema, indent=2, sort_keys=True) with a trailing newline. It needs "
        + "no running server and no network. Its --check mode re-renders and compares the text, and CI's gateway "
        + "job runs exactly that, so an accidental contract change is a diff a reviewer sees rather than a "
        + "client's runtime error.",
      source: "tools/export_openapi.py",
    },
    {
      id: "snapshot",
      role: "committed snapshot",
      artefact: "tools/openapi.json",
      operation: "canonicalise, then SHA-256",
      produced: `${CONTRACT_PATHS} paths, typed in this bundle`,
      state: "ok",
      word: "committed",
      branch: { operation: "generate the typed client", artefact: "lib/gateway-contract.generated.ts" },
      detail:
        "The committed contract, and the only description either unit has of the other. Nothing re-hashes it in "
        + "this browser: it is a quarter of a megabyte, it is not in the bundle, and shipping it to a page so the "
        + "page could confirm a digest it already ships would be a transfer paid by every visitor for no new "
        + `fact. What the bundle does carry off it is the typed client, and the ${CONTRACT_PATHS} paths beside `
        + "this node are counted from that file rather than asserted here.",
      source: "tools/openapi.json",
    },
    {
      id: "gate",
      role: "the build gate",
      artefact: "scripts/check-gateway-openapi-digest.mjs",
      operation: "compare",
      produced: gate.ran ? "64 hex characters" : null,
      absence: "no build in this session",
      state: gate.ran ? "ok" : "unknown",
      word: gate.ran ? "ran at build" : "not run this session",
      detail:
        "Parses the snapshot and re-serialises it with every object key sorted and no whitespace — its own "
        + "canonical form, not the file's two-space rendering, so the digest survives a reformat and moves only "
        + "when the contract does — SHA-256s those bytes with node:crypto, and compares them against the "
        + "sixty-four hex characters it reads out of the digest module. It is the first half of prebuild, so npm "
        + `run build never reaches Next.js with a stale digest. When it does exit 1: ${REMEDY} ${gate.why}`,
      source: "scripts/check-gateway-openapi-digest.mjs",
    },
    {
      id: "digest",
      role: "committed digest, where both units meet",
      artefact: "lib/gateway-openapi-digest.generated.ts",
      operation: null,
      produced: "one 64-character digest",
      state: terminal.state,
      word: terminal.word,
      detail:
        "The pivot, and the reason this chain is worth drawing. Two comparisons land on this single value from "
        + "opposite directions: the build gate hashes the committed snapshot against it, and the running "
        + "workspace hashes the document the live gateway is serving against it — compareGatewayOpenApi in "
        + "lib/delivery-readiness.ts, reported by the schema table above. So a mismatch is not a build failure. "
        + "It is the contract between two separately deployed units asserting itself: the gateway is serving a "
        + "shape this workspace was not built against, and whichever side moved, one of the two is running from "
        + "a commit the other has not seen.",
      source: "lib/gateway-openapi-digest.generated.ts",
    },
  ];
}

/** The card's pill: live drift outranks everything, then what the build knows. */
export function contractPill(reading: ContractReading, gate: BuildGate): ControlState {
  if (reading.phase === "mismatch") {
    return {
      label: "Drift detected",
      detail: "The live gateway serves a contract that does not canonicalise to the committed digest.",
      tone: "bad",
    };
  }
  if (reading.phase === "waiting") {
    return { label: "Checking", detail: "Waiting for the first health snapshot.", tone: "info" };
  }
  if (gate.ran) {
    return { label: "Gated at build", detail: gate.why, tone: "good" };
  }
  return { label: "Unverified here", detail: gate.why, tone: "warn", unmeasured: true };
}

/**
 * The panel: the chain, both digests in full, and the remedy when one is wrong.
 *
 * Wired from the Contracts pane of `DeveloperInterfaces`, beside the schema
 * table whose Gateway OpenAPI row this expands. A capability with no caller is
 * the defect this repository keeps a scar about, so nothing here is exported
 * for a pane that might exist later.
 */
export default function GatewayContractCustodyChain({
  view,
  stagger,
}: {
  view: SystemHealthView;
  stagger: number;
}) {
  const reading = contractReading(view);
  const gate = buildGate(process.env.NODE_ENV);
  const chain = gatewayContractChain(reading, gate);
  const pill = contractPill(reading, gate);
  const terminal = terminalState(reading);
  const served = reading.phase === "match" || reading.phase === "mismatch" ? reading.observed : null;
  const divergence = served ? firstDifference(served, COMMITTED_GATEWAY_OPENAPI_SHA256) : null;
  const liveEvidence = reading.phase === "mismatch"
    ? `The live contract and the committed digest part company at character ${divergence ?? 1}. `
      + `If a route changed on purpose: ${REMEDY} If nothing changed on purpose, the two units are out `
      + "of step and one of them is deployed from a commit the other has not seen."
    : reading.phase === "match"
      ? "GET /openapi.json as served this poll hashes to the digest above — on the server, in "
        + "lib/delivery-readiness.ts, so only these sixty-four characters reach this browser."
      : reading.phase === "waiting"
        ? "No health snapshot has landed yet, so nothing has read the live contract in this session."
        : reading.why;

  return (
    <section
      className="card developer-cp-schema-card gateway-contract-custody stagger-reveal"
      style={{ "--stagger-i": stagger } as CSSProperties}
    >
      <div className="developer-cp-heading">
        <div>
          <span>Gateway contract custody</span>
          <h2>OpenAPI snapshot and its digest</h2>
        </div>
        {/* No pulse. This pill reports the BUILD gate — committed evidence, not
            a reading the 30s poll takes — and a pulsing dot on it would be the
            impersonation `tests/live-motion.test.ts` exists to stop. The live
            half of the claim pulses one card up, on the schema table's own
            pill, where it is actually fed by the poll. */}
        <StatusPill state={pill} />
      </div>
      {/* At rest this is the only sentence on the card naming what the chain is
          a chain OF, so it stays outside every fold. The detail behind each
          node is where the argument is made at length. */}
      <p className="developer-cp-disclosure">
        The gateway exports this contract and the web build verifies it, from two separate deployments; a
        mismatch is the contract asserting itself, not a build failure.
      </p>

      <CustodyChainTrack chain={chain} label="Gateway OpenAPI custody chain" />

      <GatewayContractDigestTable
        rows={[
          {
            source: "Committed in this repository",
            hex: COMMITTED_GATEWAY_OPENAPI_SHA256,
            glyph: gate.ran ? STAGE_GLYPH.ok : STAGE_GLYPH.unknown,
            word: gate.ran ? "verified at build time" : "not verified this session",
            tint: gate.ran ? TINT.ok : TINT.unknown,
            evidence: gate.why,
          },
          {
            source: "Served by the live gateway",
            hex: served,
            glyph: STAGE_GLYPH[terminal.state],
            word: terminal.word,
            tint: TINT[terminal.state],
            evidence: liveEvidence,
          },
        ]}
      />
    </section>
  );
}
