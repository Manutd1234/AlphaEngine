/**
 * Fusing two retrievers, and measuring whether it helped.
 *
 * WHY FUSE BY RANK RATHER THAN BY SCORE
 *
 * A cosine similarity of 0.86 and a `ts_rank_cd` of 0.19 are numbers on
 * unrelated scales with unrelated distributions. Combining them into a weighted
 * sum requires choosing a normalisation, every choice of normalisation is a
 * thumb on the scale, and nobody reading the results six months later can audit
 * which thumb was used. Reciprocal Rank Fusion asks each retriever only for an
 * ordering, which is the one thing both are competent to state.
 *
 * WHY MEASURE AT ALL
 *
 * Adding a reranker or a second retriever without an evaluation replaces a
 * pipeline whose quality is unknown with a pipeline whose quality is unknown
 * and more complicated. These metrics are the standard ones and they are
 * computed offline from committed fixtures, so a change to the fusion is a
 * number that moves in CI rather than an impression someone formed while
 * clicking around.
 *
 * WHAT THIS DOES NOT MEASURE
 *
 * The embedder. The rankings that go in are produced by whatever ran the query;
 * this scores the FUSION of two orderings against a labelled answer key. A
 * regression in gte-small itself would show up here only as worse input, which
 * is a real limitation. `scripts/rag-eval.mjs` closes it: same four metrics,
 * run against the live index through the real query path, so a change to the
 * embedder, the migration, the RRF constant or the corpus moves a number
 * there. It needs a case file — labels are a judgement about this desk's own
 * corpus, and none is committed, because a fabricated answer key produces a
 * figure that looks like evidence and is not.
 */

/** Cormack et al.'s original constant. Not tuned — see the migration comment. */
export const RRF_K = 60;

export interface FusedDocument {
  id: string;
  /** 1-based; null when this retriever did not return the document at all. */
  vectorRank: number | null;
  lexicalRank: number | null;
  score: number;
}

/**
 * Fuse two ranked id lists.
 *
 * A retriever that did not return a document contributes nothing for it, rather
 * than a large penalty. Penalising absence turns the fusion into an AND across
 * two retrievers with very different recall — and the lexical side returns
 * nothing at all for a paraphrased query, so an AND would delete exactly the
 * results the dense retriever was added to find.
 */
export function reciprocalRankFusion(
  vectorRanking: string[],
  lexicalRanking: string[],
  k: number = RRF_K,
): FusedDocument[] {
  const vector = new Map(vectorRanking.map((id, i) => [id, i + 1]));
  const lexical = new Map(lexicalRanking.map((id, i) => [id, i + 1]));

  const ids = [...new Set([...vectorRanking, ...lexicalRanking])];
  return ids
    .map((id) => {
      const vectorRank = vector.get(id) ?? null;
      const lexicalRank = lexical.get(id) ?? null;
      return {
        id,
        vectorRank,
        lexicalRank,
        score: (vectorRank ? 1 / (k + vectorRank) : 0) + (lexicalRank ? 1 / (k + lexicalRank) : 0),
      };
    })
    // Ties broken by the vector rank, then by id. An unstable order across runs
    // would make the evaluation numbers below move for no reason and destroy
    // the point of measuring them.
    .sort((a, b) =>
      b.score - a.score
      || (a.vectorRank ?? Infinity) - (b.vectorRank ?? Infinity)
      || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Normalised Discounted Cumulative Gain at k.
 *
 * The headline metric because it is the only one of the three that cares about
 * WHERE a relevant document landed. Recall@10 gives full marks for burying the
 * right answer at position 10, and for a panel that shows five results that is
 * the same as not finding it.
 *
 * Binary relevance: a document is either in the answer key or it is not. Graded
 * relevance would be more informative and would require someone to have graded
 * it, and inventing grades to make a metric richer is inventing data.
 */
export function ndcgAt(ranking: string[], relevant: Set<string>, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranking.length); i++) {
    if (relevant.has(ranking[i])) dcg += 1 / Math.log2(i + 2);
  }
  let ideal = 0;
  for (let i = 0; i < Math.min(k, relevant.size); i++) ideal += 1 / Math.log2(i + 2);
  return ideal > 0 ? dcg / ideal : 0;
}

/** Reciprocal rank of the FIRST relevant document; 0 when none appears. */
export function reciprocalRank(ranking: string[], relevant: Set<string>): number {
  for (let i = 0; i < ranking.length; i++) {
    if (relevant.has(ranking[i])) return 1 / (i + 1);
  }
  return 0;
}

export function recallAt(ranking: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  const found = ranking.slice(0, k).filter((id) => relevant.has(id)).length;
  return found / relevant.size;
}

export interface EvalCase {
  query: string;
  /** Document ids a human would accept as answers. */
  relevant: string[];
  vectorRanking: string[];
  lexicalRanking: string[];
}

export interface EvalScore {
  configuration: string;
  ndcg10: number;
  mrr: number;
  recall5: number;
}

/** Mean of a metric across cases; an empty set scores 0 rather than NaN. */
function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Score every configuration on the same cases.
 *
 * All four are reported, including the two single-retriever baselines, because
 * "hybrid scores 0.81" is not a result. "Hybrid scores 0.81 where dense alone
 * scores 0.68 and lexical alone scores 0.44" is one, and the day hybrid stops
 * beating dense alone is the day this table earns its keep.
 */
export function evaluateRetrieval(cases: EvalCase[]): EvalScore[] {
  const configurations: Array<[string, (c: EvalCase) => string[]]> = [
    ["dense only", (c) => c.vectorRanking],
    ["lexical only", (c) => c.lexicalRanking],
    ["hybrid (RRF)", (c) => reciprocalRankFusion(c.vectorRanking, c.lexicalRanking).map((d) => d.id)],
    // The ablation that proves the constant is not doing the work. If k mattered
    // this much, the fusion would be a tuned parameter wearing a citation.
    ["hybrid (RRF, k=10)", (c) => reciprocalRankFusion(c.vectorRanking, c.lexicalRanking, 10).map((d) => d.id)],
  ];

  return configurations.map(([configuration, rank]) => ({
    configuration,
    ndcg10: mean(cases.map((c) => ndcgAt(rank(c), new Set(c.relevant), 10))),
    mrr: mean(cases.map((c) => reciprocalRank(rank(c), new Set(c.relevant)))),
    recall5: mean(cases.map((c) => recallAt(rank(c), new Set(c.relevant), 5))),
  }));
}
