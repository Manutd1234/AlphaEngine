/**
 * Run the retrieval metrics against the LIVE index.
 * ================================================
 *
 * `lib/retrieval-eval.ts` scores the FUSION — it takes two rankings and asks
 * whether combining them helped. It says so itself, and names this file as the
 * thing that closes the gap: the rankings it scores come from whatever produced
 * them, so a regression in gte-small shows up there only as worse input.
 *
 * This runs the real query path. It asks the gateway's RAG search for each
 * labelled case, takes the ranking the deployment actually returns, and scores
 * it with the same four metrics — so a change to the embedder, the migration,
 * the RRF constant or the corpus itself moves a number here.
 *
 * Usage:
 *
 *   ALPHAENGINE_GATEWAY_URL=... ALPHAENGINE_GATEWAY_TOKEN=... \
 *     node scripts/rag-eval.mjs
 *   node scripts/rag-eval.mjs --cases path/to/cases.json
 *   node scripts/rag-eval.mjs --json out.json     # for CI to diff
 *
 * The case file is a list of { query, relevant: [source_ref, …] }. There is no
 * committed default: labels are a judgement about this desk's own corpus, and a
 * fabricated answer key would produce a number that looks like evidence and is
 * not. Absent a case file the script says so and exits non-zero rather than
 * inventing one.
 */

import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const GATEWAY = process.env.ALPHAENGINE_GATEWAY_URL;
const TOKEN = process.env.ALPHAENGINE_GATEWAY_TOKEN;
const CASES = args.cases;
const TOP_K = Number(args.k ?? 10);

function die(message) {
  console.error(`rag-eval: ${message}`);
  process.exit(1);
}

if (!GATEWAY) die("ALPHAENGINE_GATEWAY_URL is not set; there is no live index to measure");
if (!CASES) {
  die(
    "no --cases file given.\n" +
      "  Labels are a judgement about this desk's own corpus and none is committed:\n" +
      "  a fabricated answer key produces a number that looks like evidence and is not.\n" +
      "  Write [{ \"query\": \"…\", \"relevant\": [\"<source_ref>\", …] }, …] and pass it.",
  );
}

const cases = JSON.parse(readFileSync(CASES, "utf8"));
if (!Array.isArray(cases) || !cases.length) die(`${CASES} holds no cases`);

/** nDCG@k with binary relevance — the same definition lib/retrieval-eval.ts uses. */
function ndcgAt(ranking, relevant, k) {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranking.length); i++) {
    if (relevant.has(ranking[i])) dcg += 1 / Math.log2(i + 2);
  }
  let ideal = 0;
  for (let i = 0; i < Math.min(k, relevant.size); i++) ideal += 1 / Math.log2(i + 2);
  return ideal > 0 ? dcg / ideal : 0;
}

function reciprocalRank(ranking, relevant) {
  const at = ranking.findIndex((id) => relevant.has(id));
  return at === -1 ? 0 : 1 / (at + 1);
}

function recallAt(ranking, relevant, k) {
  if (!relevant.size) return 0;
  const hits = ranking.slice(0, k).filter((id) => relevant.has(id)).length;
  return hits / relevant.size;
}

async function search(query) {
  const response = await fetch(new URL("/research/rag/search", GATEWAY), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { "X-AlphaEngine-Token": TOKEN } : {}),
    },
    body: JSON.stringify({ query, match_count: TOP_K }),
  });
  if (!response.ok) die(`gateway answered HTTP ${response.status} for ${JSON.stringify(query)}`);
  return response.json();
}

const rows = [];
let unavailable = 0;

for (const testCase of cases) {
  const payload = await search(testCase.query);
  // `unavailable` is a state, never an empty list — the gateway is explicit
  // about this and so is the score. Counting these as a zero would report a
  // missing Supabase as a retrieval regression.
  if (payload.state !== "ok") {
    unavailable += 1;
    rows.push({ query: testCase.query, state: payload.state, ndcg10: null, mrr: null, recall5: null });
    continue;
  }
  const ranking = (payload.matches ?? []).map((m) => String(m.source_ref ?? m.id));
  const relevant = new Set(testCase.relevant.map(String));
  rows.push({
    query: testCase.query,
    state: "ok",
    returned: ranking.length,
    ndcg10: ndcgAt(ranking, relevant, 10),
    mrr: reciprocalRank(ranking, relevant),
    recall5: recallAt(ranking, relevant, 5),
  });
}

const scored = rows.filter((r) => r.state === "ok");
const mean = (key) =>
  scored.length ? scored.reduce((a, r) => a + r[key], 0) / scored.length : 0;

const summary = {
  generatedOn: new Date().toISOString().slice(0, 10),
  gateway: new URL(GATEWAY).host,
  cases: cases.length,
  scored: scored.length,
  unavailable,
  ndcg10: mean("ndcg10"),
  mrr: mean("mrr"),
  recall5: mean("recall5"),
};

console.log(`\nlive retrieval — ${summary.scored}/${summary.cases} cases scored` +
  (unavailable ? `, ${unavailable} unavailable` : ""));
console.log("query".padEnd(46) + "nDCG@10   MRR   R@5");
for (const row of rows) {
  const label = row.query.length > 44 ? `${row.query.slice(0, 43)}…` : row.query;
  if (row.state !== "ok") {
    console.log(label.padEnd(46) + `— ${row.state}`);
    continue;
  }
  console.log(
    label.padEnd(46) +
      `${row.ndcg10.toFixed(3).padStart(7)}${row.mrr.toFixed(3).padStart(6)}${row.recall5.toFixed(3).padStart(6)}`,
  );
}
console.log(
  "\nmean".padEnd(46) +
    `${summary.ndcg10.toFixed(3).padStart(7)}${summary.mrr.toFixed(3).padStart(6)}${summary.recall5.toFixed(3).padStart(6)}`,
);

if (args.json) {
  writeFileSync(args.json, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  console.log(`\nwrote ${args.json}`);
}

// A run where nothing could be scored is not a passing run.
if (!scored.length) process.exit(1);
