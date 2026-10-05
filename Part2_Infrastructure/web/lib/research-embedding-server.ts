/** Server-only query embedding. Uses the corpus's existing gte-small service. */
import { callGateway } from "./gateway";
import { EMBEDDING_DIMENSIONS } from "./oracle/queries";

type EmbeddingResult =
  | { ok: true; vector: number[] }
  | { ok: false; failure: { code: string; error: string; status: number } };

function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === EMBEDDING_DIMENSIONS
    && value.every((n) => typeof n === "number" && Number.isFinite(n))
    && value.some((n) => n !== 0);
}

export async function embedResearchQuery(
  query: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<EmbeddingResult> {
  const origin = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  // Existing deployments without a server-side Supabase credential can keep
  // using the gateway. Configured deployments do not need that extra VM hop.
  if (!origin || !key) {
    const result = await callGateway<{ embeddings: number[][] }>("/api/research/rag/embed", {
      method: "POST", body: { texts: [query] }, subject: "the embedding service",
      validate: (value): value is { embeddings: number[][] } => {
        const vectors = (value as { embeddings?: unknown } | null)?.embeddings;
        return Array.isArray(vectors) && vectors.length === 1 && validVector(vectors[0]);
      },
    });
    return result.ok ? { ok: true, vector: result.data.embeddings[0] } : result;
  }
  const fail = (code: string, error: string, status = 502): EmbeddingResult =>
    ({ ok: false, failure: { code, error, status } });
  let url: URL;
  try {
    url = new URL("/functions/v1/embed-research", origin);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid origin");
  } catch {
    return fail("embedding_misconfigured", "The research embedding service URL is not configured correctly.", 503);
  }
  try {
    const response = await fetcher(url, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ texts: [query] }), signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return fail("embedding_rejected", "The research embedding service rejected the request. Check its server-side configuration.");
    }
    const payload = await response.json();
    if (payload?.model !== "gte-small" || !Array.isArray(payload.embeddings)
      || payload.embeddings.length !== 1 || !validVector(payload.embeddings[0])) {
      return fail("embedding_invalid_payload", "The embedding service returned an incompatible vector; nothing was searched.");
    }
    return { ok: true, vector: payload.embeddings[0] };
  } catch (error) {
    return error instanceof DOMException && error.name === "TimeoutError"
      ? fail("embedding_timeout", "The research embedding service did not answer within 8 seconds.", 504)
      : fail("embedding_unavailable", "The research embedding service could not return a valid response.");
  }
}
