"use client";

/**
 * What a research document is CONNECTED to — the question similarity cannot ask.
 *
 * The corpus above this answers "what resembles this". That is the right
 * question most of the time and the wrong one exactly when it matters: a
 * backtest whose verdict was FAIL and the drawdown breach that followed it read
 * nothing alike, share no vocabulary, and will never be near each other in any
 * embedding. They are joined by an edge, not by a distance.
 *
 * So this walks research_edges and reports the relation and the evidence that
 * reached each document. "Shares data hash 9f9602c7" is a claim a reader can
 * check; "is related" is not, which is why the traversal carries both.
 *
 * Collapsed by default. It costs a request, and the reader has not asked the
 * question until they open it.
 */

import { useCallback, useState } from "react";

import { probeGateway } from "@/lib/use-gateway-connection";

interface Neighbour {
  id: string;
  kind: string;
  title: string;
  depth: number;
  arrived_by: string;
  evidence: string | null;
  occurred_at: string;
}

interface GraphPayload {
  state: string;
  connected: Neighbour[];
}

type Load =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; payload: GraphPayload }
  | { status: "error"; message: string };

/** "same_data" → "shares data" reads as a sentence; the enum name does not. */
const RELATION_LABEL: Record<string, string> = {
  same_data: "same bars",
  same_symbol: "same instrument",
  same_strategy: "same strategy",
  same_regime: "same regime",
  followed_by: "happened after",
  promoted_to: "promoted into",
};

export default function ConnectedDocuments({ documentId }: { documentId: string }) {
  const [load, setLoad] = useState<Load>({ status: "idle" });

  const open = useCallback(async () => {
    if (load.status !== "idle") return;
    setLoad({ status: "loading" });
    const outcome = await probeGateway<GraphPayload>(
      `/api/gateway/research/graph/${encodeURIComponent(documentId)}?depth=2`,
    );
    if (outcome.ok) setLoad({ status: "done", payload: outcome.payload });
    else setLoad({ status: "error", message: outcome.failure.message });
  }, [documentId, load.status]);

  return (
    /* `disclosure` as well: that is the house grammar for a fold, and without
       it the summary got no cursor, no sizing and no list marker — the whole
       card lit up with the default focus ring because nothing gave the summary
       a box to be smaller than. */
    <details className="corpus-connected disclosure" onToggle={(event) => {
      if ((event.currentTarget as HTMLDetailsElement).open) void open();
    }}>
      <summary>What is connected to this</summary>

      {load.status === "loading" && <p className="sub">Walking the graph…</p>}

      {load.status === "error" && (
        <p className="sub">
          The graph could not be walked: {load.message.replace(/\.$/, "")}. Not the same as
          nothing being connected.
        </p>
      )}

      {load.status === "done" && load.payload.state !== "ok" && (
        <p className="sub">
          No graph here — either the corpus is unconfigured, or this deployment predates the
          traversal function.
        </p>
      )}

      {load.status === "done" && load.payload.state === "ok"
        && load.payload.connected.length === 0 && (
        <p className="sub">
          Nothing in the corpus shares this document&apos;s bars, instrument, strategy or regime.
        </p>
      )}

      {load.status === "done" && load.payload.connected.length > 0 && (
        <ul className="corpus-connected__list">
          {load.payload.connected.map((node) => (
            <li key={node.id}>
              <span className="corpus-connected__title">{node.title}</span>
              {/* The relation and its evidence, never the bare word "related".
                  "same bars, 9f9602c7" is checkable; "related" is not. Commas
                  rather than middle dots: the separator is a word's job here,
                  and middle-dot.test.ts holds that at zero. */}
              <span className="muted">
                {" "}— {RELATION_LABEL[node.arrived_by] ?? node.arrived_by}
                {node.evidence ? `, ${node.evidence}` : ""}
                {node.depth > 1 ? `, ${node.depth} hops away` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
