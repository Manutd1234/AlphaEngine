"use client";

/**
 * The custody chain, drawn once, for both of the chains this repository has.
 *
 * WHY THIS FILE EXISTS. `NumericsCustodyChain.tsx` drew the Monte Carlo chain
 * — a node per artefact, the operation on each edge, a click opening the detail
 * and naming the file the claim was read from — and its own report closed by
 * saying the OTHER chain, the gateway OpenAPI contract, was not drawn. Drawing
 * that one meant a choice between two shapes:
 *
 *   - A second custody visual, written beside the first. Rejected. Two dialects
 *     for the same job is two things to keep true, and this is the exact defect
 *     `components/research/SignalDAGViewer.tsx` was consolidated to remove. It
 *     also does not fit: `NumericsCustodyChain.tsx` was at 368 lines against a
 *     400-line ceiling, so a copy could not have been paid for anyway.
 *   - The renderer lifted out and shared, each chain keeping only its own
 *     derivation. Taken. What differs between the two chains is which artefacts
 *     exist and what is known about them; how a chain LOOKS should not differ
 *     at all, and now cannot.
 *
 * So this file owns the picture and nothing else: no fixture, no digest, no
 * verdict. It receives `CustodyLink[]` — a pure value both chains derive with
 * no DOM, which is why both derivations are assertable in a test that renders
 * nothing — and turns it into the signal path's markup.
 *
 * The classes are `components/research/SignalDAGViewer.tsx`'s classes,
 * unchanged, and the glyph table is `lib/signal-path.ts`'s, imported rather
 * than restated. No stylesheet edit was needed for either chain and none was
 * made.
 */

import { useState, type CSSProperties } from "react";

import { STAGE_GLYPH } from "@/lib/signal-path";

/** The five states a link can be in — the signal path's vocabulary, not a new one. */
export type LinkState = "ok" | "degraded" | "down" | "absent" | "unknown";

/**
 * A colour per state, applied BESIDE the glyph and the word, never instead of
 * them. Nothing on either chain is legible only in colour: a reader on a
 * monochrome screen, in forced colours, or with a colour deficiency gets the
 * same verdict from `STAGE_GLYPH[state]` and the link's own word.
 */
export const TINT: Record<LinkState, string> = {
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
  /**
   * The words used in place of a figure when `produced` is null.
   *
   * Defaulted rather than required, and the default is deliberately the
   * numerics chain's original wording. "nothing yet" is right for a link that
   * has not run and could: press the button and a figure appears. It is WRONG
   * for a link that never runs in a browser at all — a Python exporter, a
   * build-time Node script — where "yet" promises a measurement this page can
   * never take. Those links name their own absence instead.
   */
  absence?: string;
  state: LinkState;
  /** The state in this chain's own words. "healthy" would mean nothing here. */
  word: string;
  detail: string;
  /** The repository path a reader opens to check the claim. */
  source: string;
  /**
   * A second artefact made from this same node, off the path to the digest.
   *
   * The gateway chain needs it and the numerics chain does not: one committed
   * OpenAPI snapshot feeds both the digest that gates the build AND the typed
   * client in `lib/gateway-contract.generated.ts`. Drawing only the digest leg
   * would say the snapshot has one consumer when it has two, and a reader who
   * regenerated the snapshot without the client would find that out from a
   * failing test rather than from this picture.
   */
  branch?: { operation: string; artefact: string } | null;
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

const BRANCH_STYLE: CSSProperties = {
  display: "block",
  marginTop: "2px",
  fontSize: "var(--fs-2xs)",
  lineHeight: "var(--lh-snug)",
  color: "var(--text-muted)",
};

/**
 * One chain, as a track of nodes with the operation printed on every edge.
 *
 * `open` lives here because it is a property of the picture, not of either
 * claim: which node a reader has expanded says nothing about custody, and
 * hoisting it would make two chains on one screen share a selection they have
 * no reason to share.
 */
export default function CustodyChainTrack({ chain, label }: { chain: CustodyLink[]; label: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const opened = chain.find((link) => link.id === open) ?? null;

  return (
    <>
      <ol className="signal-workflow__track" aria-label={label}>
        {chain.map((link, index) => (
          <li key={link.id} className="signal-workflow__stage">
            <button
              type="button"
              className={`signal-workflow__node${open === link.id ? " is-selected" : ""}`}
              aria-pressed={open === link.id}
              data-state={link.state}
              onClick={() => setOpen(open === link.id ? null : link.id)}
            >
              {/* "Step", not "Link": a reader reported the chain unreadable as
                  "LINK 1 … LINK 5" — link is chain-of-custody jargon; step is
                  the word for a position in a flow of data. */}
              <span className="signal-workflow__step">
                Step {index + 1}: {link.role}
              </span>
              <strong>{link.artefact}</strong>
              <span className="signal-workflow__meta">
                {/* A link that produced nothing says so, rather than borrowing
                    the figure from the link beside it. */}
                <span className="num">{link.produced ?? link.absence ?? "nothing yet"}</span>
                <em>
                  <span aria-hidden>{STAGE_GLYPH[link.state]}</span> {link.word}
                </em>
              </span>
              {/* The second consumer of this artefact, drawn inside the node it
                  leaves rather than described in prose underneath the track —
                  a fork a reader has to be told about is a fork the diagram is
                  lying about. */}
              {link.branch && (
                <small style={BRANCH_STYLE}>
                  {link.branch.operation} <span aria-hidden>→</span> {link.branch.artefact}
                </small>
              )}
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
    </>
  );
}
