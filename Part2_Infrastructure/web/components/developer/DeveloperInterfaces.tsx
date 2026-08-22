"use client";

/**
 * API & Schema, as three panes: which contracts are gated, what the route
 * inventory is, and whether the numerics reproduce.
 *
 * Split out of `DeveloperConsole` when that file passed the length ceiling.
 *
 * Numerics is the third of those, and it stays here as its own pane rather
 * than moving to Readiness beside artifact custody. Two reasons, one of them
 * about meaning and one about the stylesheet.
 *
 * The browser run is one third of a three-way comparison. The other two — the
 * committed reference and this deployment's Node runtime — are the "Monte
 * Carlo numerics" row of the schema table, one pane away in Contracts. Moving
 * the run to Readiness would separate the reading from the row it corroborates,
 * and a reader who found a mismatch would then hold two sections in their head
 * to say which runtime disagreed.
 *
 * And Readiness is a fixed twelve-column grid: its three cards are pinned by
 * `grid-column` spans in globals.css, so a fourth would land alone on a row
 * with half of it empty. Fixing that is a stylesheet edit, and this component
 * does not own the stylesheet.
 */

import { useMemo, useState, type CSSProperties } from "react";

import DeveloperApiCatalog, { API_OPERATIONS } from "@/components/developer/DeveloperApiCatalog";
import GatewayContractCustodyChain from "@/components/developer/GatewayContractCustodyChain";
import { mcParityFixture, MC_PARITY_PATHS } from "@/lib/mc-parity";
import { useMcDistribution } from "@/lib/use-mc-distribution";
import type { SystemHealthView } from "@/lib/use-system-health";

import {
  SchemaGateTable,
  StatusPill,
  schemaCompatibilityState,
  type ControlState,
} from "./DeveloperStatus";
import NumericsCustodyChain, { browserRun, engineWord } from "./NumericsCustodyChain";

/**
 * The third runtime of the numerics-parity claim: the committed reference was
 * authored offline, the server recomputes it per instance (the "Monte Carlo
 * numerics" row of the schema table, one pane away in Contracts), and this
 * button recomputes it in the visitor's own browser — same Blob worker the Risk
 * tab simulates with, same canonical serialisation, compared byte for byte.
 * Nothing is sent anywhere; the comparison is local.
 */
function McBrowserParityCheck() {
  const [runNonce, setRunNonce] = useState(0);
  const requested = runNonce > 0;
  // `nonce` changes request identity so "Run again" genuinely re-runs; the
  // math ignores it, so the result bytes stay comparable.
  const request = useMemo(() => (requested ? { ...mcParityFixture(), nonce: runNonce } : null), [requested, runNonce]);
  const simulation = useMcDistribution(request);
  /* The run as a custody state, so this card and the chain beneath it cannot
     disagree about what happened. The byte comparison and the two digests live
     in `NumericsCustodyChain`; what stays here is the pill's wording, which the
     summarisation and disclosure suites pin to this file. */
  const run = browserRun(requested, simulation);

  let state: ControlState;
  if (run.phase === "idle") {
    state = {
      label: "Not run",
      detail: "Runs entirely in this tab; nothing is uploaded.",
      tone: "off",
    };
  } else if (run.phase === "failed") {
    state = { label: "Failed", detail: run.reason, tone: "bad" };
  } else if (run.phase === "running") {
    state = { label: "Running", detail: "Simulating in this browser…", tone: "info" };
  } else if (run.matches) {
    state = {
      label: "Byte-exact",
      /* No truncated digest in this sentence any more. The full sixty-four
         characters are printed once below — both sides hash to the same value
         when the run matches — and a twelve-character prefix in a pill was the
         whole reported defect: a claim that a digest exists, not a digest a
         reader can check. */
      detail: `This browser (${engineWord(run.engine)}) reproduced the committed reference byte for byte; the digest is below.`,
      tone: "good",
    };
  } else {
    state = {
      label: "Differs",
      detail: "This browser's result does not match the committed reference; a real numerics finding.",
      tone: "bad",
    };
  }

  return (
    <section className="card developer-cp-schema-card">
      <div className="developer-cp-heading">
        <div><span>Numerics custody</span><h2>Parity check in this browser</h2></div>
        <StatusPill state={state} live={requested && simulation.status === "running"} />
      </div>
      {/* Split along the seam between method and result, and only the method
          folds. `state.detail` is the result claim in every run state, and
          before a run it is "Runs entirely in this tab; nothing is uploaded." —
          the sandbox statement for this card, and the only thing keeping the
          card from being blank at rest. So it stays on screen; what the three
          runtimes compare is read once and goes behind the summary. */}
      <p className="developer-cp-disclosure">{state.detail}</p>
      <details className="developer-cp-disclosure disclosure">
        <summary>Which three runtimes have to agree, and on what</summary>
        <p>
          The committed reference, this deployment&apos;s Node and your browser all recompute the
          same {MC_PARITY_PATHS.toLocaleString()}-path bootstrap, and must agree byte for byte.
        </p>
      </details>
      <div className="developer-cp-section-hero__actions">
        <button
          type="button"
          className="primary-action"
          onClick={() => setRunNonce((nonce) => nonce + 1)}
          disabled={run.phase === "running"}
        >
          {run.phase === "running" ? "Simulating…" : requested ? "Run again" : "Run in this browser"}
        </button>
      </div>
      {/* The custody chain, always mounted: at rest it is the only thing on the
          card naming what gets hashed and by what, and its links report "not
          run" rather than pretending a verdict. Wiring it here rather than
          exporting it for a later pane is deliberate — a capability with no
          caller is the defect this repository keeps a scar about. */}
      <NumericsCustodyChain run={run} />
    </section>
  );
}

type InterfacePane = "contracts" | "routes" | "numerics";

const INTERFACE_PANES: Array<{ id: InterfacePane; label: string; hint: string }> = [
  { id: "contracts", label: "Contracts", hint: "Which compatibility gates are automated, and which unverified" },
  { id: "routes", label: "Routes", hint: "Every operation this runtime serves, each with a curl" },
  { id: "numerics", label: "Numerics", hint: "Recompute the Monte Carlo reference and compare byte for byte" },
];

export default function DeveloperInterfaces({ view }: { view: SystemHealthView }) {
  const [pane, setPane] = useState<InterfacePane>("contracts");
  const liveSchema = schemaCompatibilityState(view);
  return (
    <>
      {/* Outside the stack, for the reason recorded above `QUALITY_PANES`:
          `.developer-cp-schema-card` spans six columns for the Readiness grid,
          and a stack holding one of those is a six-column grid. */}
      <div className="seg" role="group" aria-label="API and schema view">
        {INTERFACE_PANES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={pane === option.id}
            title={option.hint}
            onClick={() => setPane(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="developer-cp-stack">
        {/* Conditional renders, never `hidden`. Numerics owns a Blob worker, and
            leaving it mounted behind another pane keeps a simulation the reader
            cannot see holding a thread it cannot stop. */}
        {pane === "contracts" && (
          <>
            <section className="card developer-cp-section-hero stagger-reveal" style={{ "--stagger-i": 0 } as CSSProperties}>
              <div><span>Contract intelligence</span><h2>API &amp; Schema</h2></div>
              <StatusPill state={{ label: `${API_OPERATIONS.length} operations`, detail: "Route handlers indexed from this runtime.", tone: "info" }} />
            </section>
            <section className="card developer-cp-schema-card stagger-reveal" style={{ "--stagger-i": 1 } as CSSProperties}>
              <div className="developer-cp-heading"><div><span>Breaking-change guard</span><h2>Schema compatibility</h2></div><StatusPill state={liveSchema} live={liveSchema.tone === "good"} /></div>
              <SchemaGateTable view={view} />
            </section>
            {/* The chain behind the table's first row, mounted here rather than
                in Numerics. The Gateway OpenAPI row names a baseline and a
                candidate and stops; what it cannot show in four columns is the
                path between them, which crosses a deployment boundary and is
                gated in two places at once. Reading the row and the chain in
                one pane is the point — a reader who found drift would otherwise
                hold two sections in their head to say which side moved. */}
            <GatewayContractCustodyChain view={view} stagger={2} />
          </>
        )}

        {pane === "routes" && <DeveloperApiCatalog />}

        {pane === "numerics" && <McBrowserParityCheck />}
      </div>
    </>
  );
}
