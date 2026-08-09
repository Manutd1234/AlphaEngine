/**
 * The two statements the Oracle routes run, plus the names they bind.
 *
 * Everything here is exported as data rather than inlined at the call site so
 * `tests/oracle-contract.test.ts` can check it against the committed SQL in
 * `oracle/` — offline, with no database. That is the same trick
 * `tests/test_supabase_schema.py` plays against the Supabase migrations, and it
 * exists for the same reason: a column rename on one side of a boundary should
 * be a red test, not a 500 in production.
 */

/** Must equal the pgvector migration's dimension. The contract test asserts it. */
export const EMBEDDING_DIMENSIONS = 384;

export const RAG_TABLE = "strategy_research_rag";
export const MONTE_CARLO_PROCEDURE = "run_monte_carlo_portfolio";

/** The kinds a caller may filter by — the CHECK constraint's list. */
export const RESEARCH_KINDS = ["backtest_run", "execution_summary", "risk_incident"] as const;
export type ResearchKind = (typeof RESEARCH_KINDS)[number];

/**
 * Similarity search over the research corpus.
 *
 * `embedding_status = 'ready'` is not decoration: a pending row has a NULL
 * vector, and `VECTOR_DISTANCE` against NULL sorts unpredictably rather than
 * being excluded. Filtering on the status is what keeps a half-ingested corpus
 * from returning arbitrary rows as "most similar".
 *
 * Bound as a single JSON array string rather than a vector literal spliced into
 * the text — a 384-element concatenation is both a parse cost on every call and
 * the exact shape SQL injection likes.
 */
export const RAG_SEARCH_SQL = `
  SELECT research_id,
         kind,
         source_ref,
         strategy_name,
         symbol,
         title,
         body,
         metrics,
         TO_CHAR(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occurred_at,
         VECTOR_DISTANCE(embedding, TO_VECTOR(:query_vector), COSINE) AS distance
    FROM ${RAG_TABLE}
   WHERE embedding_status = 'ready'
     AND (:kind IS NULL OR kind = :kind)
     AND VECTOR_DISTANCE(embedding, TO_VECTOR(:query_vector), COSINE) <= :max_distance
   ORDER BY distance ASC
   FETCH FIRST :match_count ROWS ONLY`;

export const RAG_SEARCH_BINDS = ["query_vector", "kind", "match_count", "max_distance"] as const;

/**
 * Terminal-value Monte Carlo VaR. See oracle/02_monte_carlo.sql for why this
 * persists nothing and where the path cap is enforced.
 */
export const MONTE_CARLO_SQL = `
  BEGIN
    ${MONTE_CARLO_PROCEDURE}(
      :initial_equity, :mu, :sigma, :days, :simulations,
      :var_99, :expected, :paths_used);
  END;`;

export const MONTE_CARLO_IN_BINDS = [
  "initial_equity",
  "mu",
  "sigma",
  "days",
  "simulations",
] as const;

export const MONTE_CARLO_OUT_BINDS = ["var_99", "expected", "paths_used"] as const;

/**
 * The route's own ceiling on simulations.
 *
 * The procedure caps independently at 50,000 — this is not belt-and-braces for
 * its own sake. The route is a public endpoint and the database is the only
 * layer an attacker cannot edit; duplicating the limit means neither one alone
 * is load-bearing.
 */
export const MAX_SIMULATIONS = 50_000;
export const DEFAULT_SIMULATIONS = 10_000;

/**
 * Cosine similarity below which a document is not offered as a match.
 *
 * The Supabase side has always had this as `min_similarity` and never had it
 * passed; the Oracle side had no floor at all, so it returned its N nearest
 * rows however far away they were. Ask about something the desk has never done
 * and it confidently answers with its least-unrelated backtests.
 *
 * Must equal `RAG_MIN_SIMILARITY` in `modules/research_rag.py`. Two backends
 * answering the same question behind different floors do not disagree about
 * relevance — they disagree about the question, and the comparison the
 * two-backend design exists to make stops meaning anything.
 */
export const RAG_MIN_SIMILARITY = 0.35;

/** Cosine distance in [0, 2] → similarity in [0, 1], the shape the panel reads. */
export function similarityFromDistance(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance));
}
