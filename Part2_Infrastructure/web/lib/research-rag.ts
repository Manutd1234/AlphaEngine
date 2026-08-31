/**
 * Typed view over the gateway's research-RAG routes.
 *
 * The one rule that matters here: `unavailable` is a state, never an empty
 * list. "The desk searched its research and found nothing similar" and "the
 * research index is not reachable in this deployment" are different facts, and
 * a UI that renders the second as the first is quietly lying — the same
 * distinction `gateway_not_configured` vs an empty blotter already draws.
 */

export type ResearchRagState = "ok" | "unavailable" | "embed_failed";

export interface ResearchRagMatch {
  id: string;
  kind: "backtest_run" | "chart" | "execution_summary" | "ml_run" | "risk_incident";
  source_ref: string;
  symbol: string | null;
  strategy: string | null;
  occurred_at: string;
  title: string;
  body: string;
  metrics: Record<string, unknown>;
  /** Cosine score for text retrieval; null when the image arm alone found it. */
  similarity: number | null;
  image_rank?: number | null;
  image_similarity?: number | null;
}

export interface ResearchRagSearchResponse {
  state: ResearchRagState;
  matches: ResearchRagMatch[];
  /**
   * Embedded documents the query could have matched.
   *
   * Optional and nullable on purpose. The Oracle index does not report one,
   * and the Supabase count can fail — in both cases the denominator is
   * UNKNOWN, which is a different thing from zero and must read as silence
   * rather than as "an empty corpus".
   */
  corpus_size?: number | null;
  cache?: Record<string, unknown> | null;
}

export function isResearchRagSearchResponse(value: unknown): value is ResearchRagSearchResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.state === "ok" || record.state === "unavailable" || record.state === "embed_failed")
    && Array.isArray(record.matches)
  );
}

/**
 * The sentence a panel shows for each state. Centralised so no caller can
 * invent a phrasing that blurs unavailable into empty.
 */
export function describeSearchOutcome(response: ResearchRagSearchResponse): string {
  switch (response.state) {
    case "unavailable":
      return "The research index is not configured in this deployment — nothing was searched.";
    case "embed_failed":
      return "The embedding service did not answer, so this query could not be run.";
    case "ok": {
      // "1 similar report found" reads the same whether the index holds one
      // document or four hundred. Say the denominator when it is known, and
      // say nothing about it when it is not.
      const of = typeof response.corpus_size === "number"
        ? ` of ${response.corpus_size} indexed`
        : "";
      return response.matches.length
        ? `${response.matches.length} similar report${response.matches.length === 1 ? "" : "s"} found${of}.`
        : `Searched the desk's research corpus${of} — nothing similar is recorded.`;
    }
  }
}
