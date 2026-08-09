"use client";

/**
 * Similarity search over the desk's own research corpus.
 *
 * Two backends answer the same question and return the same shape: Supabase
 * pgvector via the gateway, and Oracle 23ai via its own route. Which one is
 * asked is a user choice rather than a fallback chain, because the interesting
 * output of running both is *disagreement* — two indexes over the same
 * documents, embedded by the same model, that rank them differently is a fact
 * about the indexes worth seeing, and a silent failover would hide it.
 *
 * `describeSearchOutcome` is reused rather than restated: "the index is not
 * configured", "the embedding service did not answer" and "nothing similar is
 * recorded" are three different facts and the panel must not flatten them into
 * an empty list.
 */

import { useCallback, useState } from "react";

import {
  ResearchRagMatch,
  ResearchRagSearchResponse,
  describeSearchOutcome,
  isResearchRagSearchResponse,
} from "@/lib/research-rag";

export type SearchBackend = "supabase" | "oracle";

export interface ResearchSearchState {
  /** Idle before the first query — distinct from "searched and found nothing". */
  status: "idle" | "searching" | "done" | "error";
  matches: ResearchRagMatch[];
  /** One sentence naming the outcome, including the unhappy ones. */
  outcome: string;
  backend: SearchBackend;
  /** Round trip, so a slow index is visible rather than merely felt. */
  elapsedMs: number | null;
}

const ROUTES: Record<SearchBackend, string> = {
  supabase: "/api/gateway/research/rag",
  oracle: "/api/oracle/research",
};

const IDLE: ResearchSearchState = {
  status: "idle",
  matches: [],
  outcome: "",
  backend: "supabase",
  elapsedMs: null,
};

export function useResearchSearch() {
  const [state, setState] = useState<ResearchSearchState>(IDLE);

  const search = useCallback(async (query: string, backend: SearchBackend, matchCount = 5) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setState({ ...IDLE, backend });
      return;
    }
    setState((current) => ({ ...current, status: "searching", backend }));
    const started = performance.now();

    let response: Response;
    try {
      response = await fetch(ROUTES[backend], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: trimmed, match_count: matchCount }),
      });
    } catch {
      setState({
        status: "error",
        matches: [],
        outcome: "The search request did not complete. The index was not reached.",
        backend,
        elapsedMs: Math.round(performance.now() - started),
      });
      return;
    }

    const elapsedMs = Math.round(performance.now() - started);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    // Validated rather than trusted. A route that changed shape should surface
    // as an error the reader can see, not as a silently empty result list that
    // reads exactly like "nothing similar is recorded".
    if (!isResearchRagSearchResponse(body)) {
      setState({
        status: "error",
        matches: [],
        outcome: `The ${backend} index returned a response this page could not read.`,
        backend,
        elapsedMs,
      });
      return;
    }

    const payload = body as ResearchRagSearchResponse;
    setState({
      status: "done",
      matches: payload.matches,
      outcome: describeSearchOutcome(payload),
      backend,
      elapsedMs,
    });
  }, []);

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, search, reset };
}
