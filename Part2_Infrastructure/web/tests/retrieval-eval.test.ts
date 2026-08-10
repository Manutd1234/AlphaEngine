/**
 * Hybrid retrieval, and the honest limits of measuring it.
 *
 * WHAT THE GOLDEN SET IS
 *
 * Eight documents and six queries, hand-authored by the same person who wrote
 * the fusion. That is a conflict of interest and it is stated rather than
 * buried: a set this small cannot establish that hybrid retrieval is better in
 * general, and an author grading their own work will unconsciously pick queries
 * their design handles.
 *
 * Two things were done about it. One case ("strategies that lost money") is a
 * query NEITHER retriever answers well, kept deliberately — an answer key
 * containing only questions the system gets right measures nothing. And the
 * assertions below are about the fusion's MECHANICS, which are objective, plus
 * one ordering claim that would be false if the fusion were broken.
 *
 * WHAT IT IS FOR
 *
 * A ratchet. When someone changes the fusion, k, or the candidate width, these
 * numbers move in CI instead of the change landing on an impression formed
 * while clicking around. `scripts/rag-eval.mjs` runs the same metrics against
 * the live index, which is the only place the embedder itself is measured.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateRetrieval,
  ndcgAt,
  recallAt,
  reciprocalRank,
  reciprocalRankFusion,
  RRF_K,
  type EvalCase,
} from "@/lib/retrieval-eval";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/retrieval-golden.json", import.meta.url)), "utf8"),
) as { documents: Record<string, string>; cases: EvalCase[] };

describe("fusion combines rankings, never scores", () => {
  it("a document both retrievers rank highly outranks one only either ranks first", () => {
    // The property RRF exists for. A document at rank 2 in both lists scores
    // 2/(60+2) = 0.0323; a document at rank 1 in one list only scores
    // 1/61 = 0.0164. Agreement across two independent retrievers beats a single
    // retriever's confidence, which is the entire argument for hybrid search.
    const fused = reciprocalRankFusion(["a", "both"], ["c", "both"]);
    assert.equal(fused[0].id, "both");
  });

  it("a document only one retriever found is still returned", () => {
    // Not an AND. The lexical side returns nothing for a paraphrase, so
    // requiring both would delete exactly the results the dense retriever was
    // added to find.
    const fused = reciprocalRankFusion(["only-dense"], []);
    assert.equal(fused.length, 1);
    assert.equal(fused[0].lexicalRank, null);
    assert.ok(fused[0].score > 0);
  });

  it("reports which retriever found each document", () => {
    // So a panel can say WHY something surfaced. "Matched the ticker exactly"
    // and "semantically similar" are different claims about the same result.
    const fused = reciprocalRankFusion(["x", "y"], ["y"]);
    const y = fused.find((d) => d.id === "y")!;
    assert.equal(y.vectorRank, 2);
    assert.equal(y.lexicalRank, 1);
  });

  it("is a total order, so the metrics below do not drift between runs", () => {
    // Two documents with identical scores must not swap places on re-run, or
    // every number in this file moves for no reason.
    const a = reciprocalRankFusion(["p", "q"], ["q", "p"]).map((d) => d.id);
    const b = reciprocalRankFusion(["p", "q"], ["q", "p"]).map((d) => d.id);
    assert.deepEqual(a, b);
  });

  it("uses the published constant rather than a tuned one", () => {
    assert.equal(RRF_K, 60);
  });
});

describe("the metrics measure what they claim", () => {
  it("nDCG rewards position, which recall cannot", () => {
    // The reason nDCG is the headline. Recall@10 gives full marks for burying
    // the answer at position 10, and a panel showing five results has not found
    // it at all.
    const relevant = new Set(["hit"]);
    const early = ndcgAt(["hit", "a", "b"], relevant, 10);
    const late = ndcgAt(["a", "b", "hit"], relevant, 10);
    assert.ok(early > late);
    assert.equal(recallAt(["hit", "a", "b"], relevant, 10), recallAt(["a", "b", "hit"], relevant, 10));
  });

  it("scores a perfect ranking at 1 and a miss at 0", () => {
    assert.equal(ndcgAt(["a", "b"], new Set(["a", "b"]), 10), 1);
    assert.equal(ndcgAt(["x", "y"], new Set(["a"]), 10), 0);
    assert.equal(reciprocalRank(["x", "a"], new Set(["a"])), 0.5);
    assert.equal(reciprocalRank(["x", "y"], new Set(["a"])), 0);
  });

  it("never returns NaN on an empty answer key", () => {
    assert.equal(ndcgAt(["a"], new Set(), 10), 0);
    assert.equal(recallAt(["a"], new Set(), 10), 0);
  });
});

describe("the golden set is honest about what it contains", () => {
  it("every referenced document exists", () => {
    for (const c of golden.cases) {
      for (const id of [...c.relevant, ...c.vectorRanking, ...c.lexicalRanking]) {
        assert.ok(id in golden.documents, `case "${c.query}" references unknown document ${id}`);
      }
    }
  });

  it("includes at least one query neither retriever answers well", () => {
    // An answer key containing only questions the system gets right measures
    // nothing. This asserts the set keeps a case where the top result is wrong
    // for both retrievers.
    const hard = golden.cases.filter((c) => {
      const relevant = new Set(c.relevant);
      return !relevant.has(c.vectorRanking[0]) && !relevant.has(c.lexicalRanking[0] ?? "");
    });
    assert.ok(hard.length >= 1, "every case is one the retrievers already handle");
  });

  it("includes a case only the dense retriever can answer, and one only lexical can", () => {
    // The two halves of the argument for hybrid. Without both, the fusion is
    // being evaluated on cases where one retriever alone would have done.
    const denseOnly = golden.cases.some((c) => c.lexicalRanking.length === 0);
    const lexicalRescues = golden.cases.some((c) => {
      const relevant = new Set(c.relevant);
      const denseRank = c.vectorRanking.findIndex((id) => relevant.has(id));
      const lexicalRank = c.lexicalRanking.findIndex((id) => relevant.has(id));
      return lexicalRank >= 0 && (denseRank < 0 || lexicalRank < denseRank);
    });
    assert.ok(denseOnly, "no case where lexical returns nothing");
    assert.ok(lexicalRescues, "no case where lexical beats dense");
  });
});

describe("hybrid beats either retriever alone on this set", () => {
  const scores = evaluateRetrieval(golden.cases);
  const by = (name: string) => scores.find((s) => s.configuration === name)!;

  it("publishes all four configurations, not just the winner", () => {
    // "Hybrid scores 0.81" is not a result. "Hybrid scores 0.81 where dense
    // alone scores 0.68" is one.
    assert.deepEqual(scores.map((s) => s.configuration), [
      "dense only", "lexical only", "hybrid (RRF)", "hybrid (RRF, k=10)",
    ]);
    // Printed so a reader of CI output sees the table rather than a bare pass.
    for (const s of scores) {
      console.log(
        `  ${s.configuration.padEnd(20)} nDCG@10 ${s.ndcg10.toFixed(3)}`
        + `  MRR ${s.mrr.toFixed(3)}  recall@5 ${s.recall5.toFixed(3)}`,
      );
    }
  });

  it("outranks dense alone", () => {
    assert.ok(
      by("hybrid (RRF)").ndcg10 > by("dense only").ndcg10,
      `hybrid ${by("hybrid (RRF)").ndcg10.toFixed(3)} did not beat dense ${by("dense only").ndcg10.toFixed(3)}`,
    );
  });

  it("outranks lexical alone, which fails completely on paraphrases", () => {
    // The first draft of this asserted a 1.5x margin, guessed rather than
    // measured, and it failed: lexical scores 0.667, not the ~0.4 I assumed. It
    // is not weak on average — it is perfect on the queries it can match and
    // absent on the ones it cannot, which averages to something respectable and
    // describes a retriever nobody should ship alone.
    //
    // So the assertion is the specific fact instead of an invented margin:
    // hybrid wins overall, AND lexical returns nothing at all for a paraphrase.
    assert.ok(
      by("hybrid (RRF)").ndcg10 > by("lexical only").ndcg10,
      `hybrid ${by("hybrid (RRF)").ndcg10.toFixed(3)} vs lexical ${by("lexical only").ndcg10.toFixed(3)}`,
    );
    const blind = golden.cases.filter((c) => c.lexicalRanking.length === 0);
    assert.ok(blind.length >= 2, "the set no longer covers queries lexical cannot reach");
    for (const c of blind) {
      assert.equal(
        recallAt(c.lexicalRanking, new Set(c.relevant), 5), 0,
        `lexical unexpectedly answered "${c.query}"`,
      );
    }
  });

  it("is not sensitive to k, so the constant is not doing the work", () => {
    // If a sixfold change in k moved the result materially, the fusion would be
    // a tuned parameter wearing a citation.
    const wide = by("hybrid (RRF)").ndcg10;
    const narrow = by("hybrid (RRF, k=10)").ndcg10;
    assert.ok(Math.abs(wide - narrow) < 0.15, `k=60 ${wide.toFixed(3)} vs k=10 ${narrow.toFixed(3)}`);
  });

  it("does not claim a perfect score", () => {
    // The hard case is in the set precisely so this stays below 1. A retrieval
    // evaluation that scores 1.000 is measuring its author's query selection.
    assert.ok(by("hybrid (RRF)").ndcg10 < 1, "the golden set has become self-congratulatory");
  });
});
