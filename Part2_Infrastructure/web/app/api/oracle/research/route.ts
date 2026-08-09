import { NextRequest, NextResponse } from "next/server";

import { withOracle } from "@/lib/oracle/client";
import {
  EMBEDDING_DIMENSIONS,
  RAG_MIN_SIMILARITY,
  RAG_SEARCH_SQL,
  RESEARCH_KINDS,
  similarityFromDistance,
  type ResearchKind,
} from "@/lib/oracle/queries";
import { callGateway } from "@/lib/gateway";
import type { ResearchRagSearchResponse } from "@/lib/research-rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/oracle/research — similarity search over the desk's research corpus,
 * answered by Oracle 23ai's native VECTOR type instead of Supabase pgvector.
 *
 * The response is the EXISTING `ResearchRagSearchResponse` shape plus a
 * `backend` discriminator, so `isResearchRagSearchResponse`,
 * `describeSearchOutcome` and the research panel are reused rather than
 * duplicated. Two vector stores answering in one shape is what makes them
 * comparable; a second shape would have made them two features.
 *
 * The `unavailable` / `embed_failed` / `ok` distinction is carried through
 * unflattened. "The desk searched and found nothing similar" and "the index is
 * not reachable in this deployment" are different facts, and the panel can only
 * tell them apart if this route refuses to render the second as the first.
 */

/** Rows as Oracle returns them, before they are mapped to the shared shape. */
interface RagRow {
  RESEARCH_ID: number;
  KIND: string;
  SOURCE_REF: string;
  STRATEGY_NAME: string | null;
  SYMBOL: string | null;
  TITLE: string;
  BODY: string;
  METRICS: string | null;
  OCCURRED_AT: string;
  DISTANCE: number;
}

/**
 * Embeds the query through the same service that embedded the corpus.
 *
 * This must not become a second embedding vendor. Vectors are only comparable
 * within one model, so a query embedded by anything other than the `gte-small`
 * session in `supabase/functions/embed-research` would return confident,
 * meaningless neighbours — a failure that looks exactly like success.
 */
async function embed(query: string): Promise<number[] | null> {
  const result = await callGateway<{ embeddings: number[][] }>("/api/research/rag/embed", {
    method: "POST",
    body: { texts: [query] },
    subject: "the embedding service",
    validate: (value): value is { embeddings: number[][] } =>
      typeof value === "object" && value !== null && Array.isArray((value as { embeddings?: unknown }).embeddings),
  });
  if (!result.ok) return null;
  const vector = result.data.embeddings[0];
  // A dimension mismatch means the corpus and the query were embedded by
  // different models. Returning null surfaces it as `embed_failed` rather than
  // as a search that quietly ranked nonsense.
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) return null;
  return vector;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "invalid_json", error: "Body must be JSON" }, { status: 400 });
  }

  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const query = typeof record.query === "string" ? record.query.trim().slice(0, 2000) : "";
  if (!query) {
    return NextResponse.json({ code: "invalid_query", error: "query is required" }, { status: 400 });
  }
  const asked = Number(record.match_count ?? 3);
  const matchCount = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 20) : 3;
  const kind = RESEARCH_KINDS.includes(record.kind as ResearchKind) ? (record.kind as ResearchKind) : null;

  const vector = await embed(query);
  if (!vector) {
    const unavailable: ResearchRagSearchResponse & { backend: string } = {
      state: "embed_failed",
      matches: [],
      backend: "oracle",
    };
    return NextResponse.json(unavailable, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  const result = await withOracle("Research similarity search", async (connection) => {
    const query_ = await connection.execute<RagRow>(RAG_SEARCH_SQL, {
      query_vector: JSON.stringify(vector),
      kind,
      match_count: matchCount,
      // Cosine distance is 1 - similarity, so the floor becomes a ceiling here.
      max_distance: 1 - RAG_MIN_SIMILARITY,
    });
    return query_.rows ?? [];
  });

  if (!result.ok) {
    // `unavailable` is the shared vocabulary for "nothing was searched"; the
    // classified reason rides alongside it so Reliability can show which.
    const payload: ResearchRagSearchResponse & { backend: string; reason: string } = {
      state: "unavailable",
      matches: [],
      backend: "oracle",
      reason: result.failure.code,
    };
    return NextResponse.json(payload, { status: result.failure.status });
  }

  const payload: ResearchRagSearchResponse & { backend: string } = {
    state: "ok",
    backend: "oracle",
    matches: result.data.map((row) => ({
      id: String(row.RESEARCH_ID),
      kind: row.KIND as ResearchRagSearchResponse["matches"][number]["kind"],
      source_ref: row.SOURCE_REF,
      symbol: row.SYMBOL,
      strategy: row.STRATEGY_NAME,
      occurred_at: row.OCCURRED_AT,
      title: row.TITLE,
      body: row.BODY,
      metrics: (() => {
        if (!row.METRICS) return {};
        try {
          return JSON.parse(row.METRICS) as Record<string, unknown>;
        } catch {
          // A malformed metrics blob is a data problem, not a reason to fail the
          // search — the match itself is still valid evidence.
          return {};
        }
      })(),
      similarity: similarityFromDistance(row.DISTANCE),
    })),
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
