"use client";

/**
 * The custody chain behind the numerics digest, drawn as the path it actually is.
 *
 * WHAT THIS PANEL USED TO SAY. The whole result of the parity check was a
 * status pill and one sentence: `Byte-exact — this browser reproduced sha256
 * 009be58f34bb… exactly.` The digest is the end of a five-link chain of
 * artefacts in this repository and none of the links were on screen, so a
 * reader who wanted to know what had been hashed, by what, and against what had
 * to open four files to find out. The panel asserted custody and showed none.
 *
 * The idiom is `components/research/SignalDAGViewer.tsx`, deliberately: this
 * tree already has one honest way of drawing a path — a node per artefact, the
 * state and the state's word printed inside it, a click opening the detail and
 * naming the source it was read from — and a second dialect for the same job
 * would be a second thing to keep true. The classes are that panel's classes,
 * unchanged, so no stylesheet edit was needed and none was made.
 *
 * WHAT IS DRAWN IS THE REAL CHAIN, confirmed against the files rather than
 * assumed. Each arrow is the operation that produces the artefact after it:
 *
 *   lib/mc-parity.ts        --run the bootstrap-->
 *   lib/mc-distribution.ts  --canonicalise-->
 *   lib/canonical-json.ts   --SHA-256-->
 *   crypto.subtle           --compare-->
 *   lib/mc-parity-reference.generated.ts   (the terminal node: digest and verdict)
 *
 * The committed end is written by `scripts/generate-mc-parity.ts` and pinned by
 * `tests/mc-parity.test.ts`, which is the third verifier of the same claim: the
 * committed reference, this deployment's Node runtime, and the browser reading
 * this page.
 *
 * WHAT IT REFUSES TO SAY. Before anyone presses the button the chain does not
 * wear a row of ticks. Every computing link reads "not run", because nothing
 * ran — a tick there would be the panel congratulating itself on a measurement
 * it never took. The one thing knowable at rest is whether the committed module
 * is self-consistent, and the panel re-hashes it on load rather than assuming.
 */

import { useState, type CSSProperties } from "react";

import { canonicalJson } from "@/lib/canonical-json";
import { MC_PARITY_HORIZON_BARS, MC_PARITY_PATHS } from "@/lib/mc-parity";
import {
  MC_PARITY_REFERENCE_JSON,
  MC_PARITY_REFERENCE_SHA256,
} from "@/lib/mc-parity-reference.generated";
import { STAGE_GLYPH } from "@/lib/signal-path";
import type { McDistributionState } from "@/lib/use-mc-distribution";

import {
  CustodyDigestRow,
  digestAbsenceReason,
  digestHex,
  firstDifference,
  useSha256,
  type DigestReading,
} from "./NumericsCustodyDigest";

/** Where this browser's run got to, as a state rather than four loose booleans. */
export type BrowserRun =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "failed"; reason: string }
  | { phase: "complete"; engine: "worker" | "main-thread"; json: string; matches: boolean };

/** The run's engine in words, for a sentence rather than a field name. */
export function engineWord(engine: "worker" | "main-thread"): string {
  return engine === "worker" ? "worker thread" : "main thread";
}

/**
 * The simulation hook's state, read as a custody run.
 *
 * The byte comparison lives here rather than in the digest hook because it IS
 * the claim: two byte sequences are equal or they are not, and that answer
 * needs no hash. The digests are the identity of those bytes, printed so a
 * reader can carry one to a terminal — evidence, not the test.
 */
export function browserRun(requested: boolean, simulation: McDistributionState): BrowserRun {
  if (!requested) return { phase: "idle" };
  if (simulation.status === "error") {
    return { phase: "failed", reason: simulation.error ?? "The simulation did not complete." };
  }
  if (simulation.status !== "done" || !simulation.result) return { phase: "running" };
  const json = canonicalJson(simulation.result);
  return {
    phase: "complete",
    engine: simulation.engine === "main-thread" ? "main-thread" : "worker",
    json,
    matches: json === MC_PARITY_REFERENCE_JSON,
  };
}

type LinkState = "ok" | "degraded" | "down" | "absent" | "unknown";

const TINT: Record<LinkState, string> = {
  ok: "var(--success-text)",
  degraded: "var(--warning-text)",
  down: "var(--critical-text)",
  absent: "var(--text-muted)",
  unknown: "var(--text-muted)",
};

export interface CustodyLink {
  id: string;
  /** What this artefact IS, printed as the node's kicker. */
  role: string;
  artefact: string;
  /** The operation on the edge leaving this node; null on the terminal node. */
  operation: string | null;
  /** What this link produced, or null when it produced nothing and says why. */
  produced: string | null;
  state: LinkState;
  /** The state in this chain's own words. "healthy" would mean nothing here. */
  word: string;
  detail: string;
  /** The repository path a reader opens to check the claim. */
  source: string;
}

/** The computing links share one state, because one run either happened or did not. */
function runState(run: BrowserRun): { state: LinkState; word: string } {
  if (run.phase === "idle") return { state: "unknown", word: "not run" };
  if (run.phase === "running") return { state: "degraded", word: "running" };
  if (run.phase === "failed") return { state: "down", word: "failed" };
  return { state: "ok", word: "ran here" };
}

/**
 * The chain, with every link's state derived from what is actually known.
 *
 * A pure function over three readings and no DOM, so the states are assertable
 * without rendering anything — the argument `lib/signal-path.ts` makes for
 * `deriveSignalPath`, and the reason this file has a test that touches no JSX.
 */
export function custodyChain(
  run: BrowserRun,
  committed: DigestReading,
  observed: DigestReading,
): CustodyLink[] {
  const ran = runState(run);
  const observedHex = digestHex(observed);
  const committedHex = digestHex(committed);
  const stale = committedHex !== null && committedHex !== MC_PARITY_REFERENCE_SHA256;

  const terminal: { state: LinkState; word: string } = stale
    ? { state: "down", word: "stale digest" }
    : run.phase === "complete"
      ? run.matches
        ? { state: "ok", word: "byte-exact" }
        : { state: "down", word: "differs" }
      : committedHex
        ? { state: "unknown", word: "not verified here" }
        : { state: "unknown", word: "not checked yet" };

  return [
    {
      id: "fixture",
      role: "fixture",
      artefact: "lib/mc-parity.ts",
      operation: "run the bootstrap",
      state: ran.state === "down" ? "ok" : ran.state,
      word: ran.state === "down" ? "ran here" : ran.word,
      produced: `${MC_PARITY_PATHS.toLocaleString()} paths, ${MC_PARITY_HORIZON_BARS} bars`,
      detail:
        "mcParityFixture draws 96 deterministic returns from mulberry32 at a pinned seed, then fixes the "
        + "request: 2,000 paths, a 30-bar horizon and 1,000,000 of equity. Nothing about the machine it "
        + "runs on enters the fixture, which is what makes everything downstream a fair test.",
      source: "lib/mc-parity.ts",
    },
    {
      id: "simulate",
      role: "simulation",
      artefact: "lib/mc-distribution.ts",
      operation: "canonicalise",
      state: ran.state,
      word: ran.word,
      produced: run.phase === "complete" ? "terminal distribution" : null,
      detail:
        "createMcSimulation runs the fixture to completion. In this tab that happens inside the same Blob "
        + "worker the Risk tab simulates with; where a worker cannot be constructed the identical factory "
        + "runs on the main thread in chunks, which is slower and is not a different answer.",
      source: "lib/mc-distribution.ts",
    },
    {
      id: "canonicalise",
      role: "canonical bytes",
      artefact: "lib/canonical-json.ts",
      operation: "SHA-256",
      state: ran.state,
      word: ran.word,
      produced: run.phase === "complete" ? `${run.json.length.toLocaleString()} bytes` : null,
      detail:
        "canonicalJson sorts every key and refuses cycles, sparse arrays and non-finite numbers, so two "
        + "engines holding the same doubles emit the same bytes. ECMAScript specifies shortest round-trip "
        + "number formatting, which is what makes byte equality a fair demand across engines at all.",
      source: "lib/canonical-json.ts",
    },
    {
      id: "hash",
      role: "digest of this run",
      artefact: "crypto.subtle",
      operation: "compare",
      state: run.phase === "complete" ? (observedHex ? "ok" : "absent") : ran.state,
      word: run.phase === "complete" ? (observedHex ? "hashed here" : "no digest here") : ran.word,
      produced: observedHex ? "64 hex characters" : null,
      detail:
        "Web Crypto hashes the bytes this tab produced. The committed side was hashed by node:crypto inside "
        + "scripts/generate-mc-parity.ts, same algorithm over the same UTF-8 bytes. On an insecure origin "
        + "crypto.subtle is undefined; this link then reports no digest rather than substituting a hash "
        + "function written for a panel, which would only ever agree with itself.",
      source: "scripts/generate-mc-parity.ts",
    },
    {
      id: "committed",
      role: "committed reference and verdict",
      artefact: "lib/mc-parity-reference.generated.ts",
      operation: null,
      state: terminal.state,
      word: terminal.word,
      produced: "reference and its digest",
      detail:
        "The generated module carries the reference bytes and their digest together, so the pair can be "
        + "checked without a network, and this panel re-hashes the committed JSON on load to say whether it "
        + "still does. Two further verifiers make the same comparison: this deployment's Node runtime, "
        + "reported by the Monte Carlo numerics row in Contracts, and tests/mc-parity.test.ts on every push.",
      source: "lib/mc-parity-reference.generated.ts",
    },
  ];
}

const ARROW_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "2px",
  flex: "0 0 auto",
  maxWidth: "92px",
  textAlign: "center",
};

const EDGE_LABEL: CSSProperties = {
  fontSize: "var(--fs-2xs)",
  fontWeight: 650,
  lineHeight: "var(--lh-snug)",
  color: "var(--text-muted)",
};

/**
 * The panel: the chain, both digests in full, and the remedy when one is wrong.
 *
 * Wired from `DeveloperInterfaces`, which owns the button and the pill. A
 * capability with no caller is the defect this repository keeps a scar about,
 * so nothing here is exported for a pane that might exist later.
 */
export default function NumericsCustodyChain({ run }: { run: BrowserRun }) {
  const [open, setOpen] = useState<string | null>(null);
  const committed = useSha256(MC_PARITY_REFERENCE_JSON, "The committed module has not been re-hashed yet.");
  const observed = useSha256(
    run.phase === "complete" ? run.json : null,
    run.phase === "idle"
      ? "No run in this session, so nothing has been hashed in this browser yet."
      : run.phase === "failed"
        ? "The simulation did not finish, so there were no bytes to hash."
        : "The simulation is still running.",
  );

  const chain = custodyChain(run, committed, observed);
  const opened = chain.find((link) => link.id === open) ?? null;
  const observedHex = digestHex(observed);
  const committedHex = digestHex(committed);
  const stale = committedHex !== null && committedHex !== MC_PARITY_REFERENCE_SHA256;
  const divergence = observedHex ? firstDifference(observedHex, MC_PARITY_REFERENCE_SHA256) : null;
  const terminal = chain[chain.length - 1];

  return (
    <div style={{ marginTop: "var(--space-3)" }}>
      <ol className="signal-workflow__track" aria-label="Numerics custody chain">
        {chain.map((link, index) => (
          <li key={link.id} className="signal-workflow__stage">
            <button
              type="button"
              className={`signal-workflow__node${open === link.id ? " is-selected" : ""}`}
              aria-pressed={open === link.id}
              data-state={link.state}
              onClick={() => setOpen(open === link.id ? null : link.id)}
            >
              <span className="signal-workflow__step">
                Link {index + 1}: {link.role}
              </span>
              <strong>{link.artefact}</strong>
              <span className="signal-workflow__meta">
                {/* A link that produced nothing says so, rather than borrowing
                    the figure from the link beside it. */}
                <span className="num">{link.produced ?? "nothing yet"}</span>
                <em>
                  <span aria-hidden>{STAGE_GLYPH[link.state]}</span> {link.word}
                </em>
              </span>
            </button>
            {/* The edge is labelled with the operation that makes the next
                artefact, which is the difference between a chain and a row of
                boxes. Rendered on every stage and hidden on the last, for the
                reason SignalDAG records: a stage with no arrow gets the gap and
                the glyph's width back and comes out wider than its neighbours. */}
            <span
              className="signal-workflow__arrow"
              style={link.operation ? ARROW_STYLE : { ...ARROW_STYLE, visibility: "hidden" }}
            >
              <span aria-hidden>→</span>
              <small style={EDGE_LABEL}>{link.operation ?? "end"}</small>
            </span>
          </li>
        ))}
      </ol>

      {opened && (
        <div className="signal-workflow__detail" role="status">
          <strong>{opened.artefact}</strong>
          <p>{opened.detail}</p>
          <p className="signal-workflow__source">
            Read from <code>{opened.source}</code>
          </p>
        </div>
      )}

      <div className="signal-workflow__detail" style={{ marginTop: "var(--space-3)" }}>
        <CustodyDigestRow
          caption="Committed in this repository"
          hex={MC_PARITY_REFERENCE_SHA256}
          glyph={stale ? STAGE_GLYPH.down : committedHex ? STAGE_GLYPH.ok : STAGE_GLYPH.unknown}
          word={stale ? "stale" : committedHex ? "self-consistent" : "not checked yet"}
          tint={stale ? TINT.down : committedHex ? TINT.ok : TINT.unknown}
          note={
            stale
              ? "The digest in that module no longer describes the reference bytes beside it. Regenerate the "
                + "snapshot with node --import tsx scripts/generate-mc-parity.ts, then update the digest module "
                + "deliberately and review the diff — a digest edited to match is a check switched off."
              : committedHex
                ? "Re-hashed on load: the digest committed in lib/mc-parity-reference.generated.ts still describes the reference bytes it ships with."
                : (digestAbsenceReason(committed) ?? "Waiting on the Web Crypto digest.")
          }
        />
        <CustodyDigestRow
          caption="Computed in this browser"
          hex={observedHex}
          glyph={STAGE_GLYPH[terminal.state]}
          word={terminal.word}
          tint={TINT[terminal.state]}
          note={
            run.phase === "complete" && !run.matches
              ? (observedHex
                  ? `The two part company at character ${divergence ?? 1}. `
                  : "This browser could not hash its own bytes, so only the byte comparison is evidence here. ")
                + "If the simulation was changed on purpose, run node --import tsx scripts/generate-mc-parity.ts "
                + "and review the diff before committing a new reference; if it was not, this is a real divergence."
              : run.phase === "complete"
                ? `Hashed in the ${engineWord(run.engine)} from the bytes this tab produced, and equal to the committed digest above.`
                : (digestAbsenceReason(observed) ?? "Waiting on the Web Crypto digest.")
          }
        />
      </div>
    </div>
  );
}
