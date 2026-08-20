"use client";

/**
 * "Has this desk seen anything like this before?"
 *
 * The corpus is the desk's own backtests and risk incidents — not the open
 * web. What comes back is evidence this account actually produced, which is the
 * only kind that settles an argument about whether a result has been seen
 * before.
 *
 * `execution_summary` is a third kind in the schema, the enum and the Oracle
 * CHECK constraint, and NOTHING WRITES ONE. `research_rag.py` emits
 * "backtest_run" and "risk_incident" and no producer exists for the third, so
 * naming it here promised a class of document that has never been indexed.
 *
 * Both backends are offered as a choice rather than a fallback chain — but
 * they are NOT two indexes over the same documents, which this comment used to
 * claim. Supabase is written live by the gateway; the Oracle table has one
 * writer, `tools/backfill_oracle_rag.py`, run by hand from a workflow_dispatch
 * job, and it indexes completed backtests only. Ranking the two against each
 * other is still worth doing; expecting the same corpus behind both is not.
 */

import { useState } from "react";

import ConnectedDocuments from "@/components/research/ConnectedDocuments";
import { fmt } from "@/lib/format";
import { SearchBackend, useResearchSearch } from "@/lib/use-research-search";

const EXAMPLES = [
  "moving average crossover drawdown",
  "high slippage on BTCUSDT",
  "walk-forward degradation",
];

export default function ResearchCorpus() {
  const [query, setQuery] = useState("");
  const [backend, setBackend] = useState<SearchBackend>("supabase");
  const { status, matches, outcome, elapsedMs, search } = useResearchSearch();

  const run = (next = query) => {
    setQuery(next);
    void search(next, backend);
  };

  return (
    <section className="card research-corpus" aria-labelledby="research-corpus-title">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Vector search</span>
          <h3 id="research-corpus-title">Has the desk seen this before?</h3>
        </div>
        {/* `data-tone` was doing nothing: `.pill` has no `[data-tone]` rule,
            only the `pill--*` modifiers, so this chip rendered untoned in both
            states. The word already separates them — the tone never added a
            distinction the text was not making. */}
        <span className="pill pill--info">
          {status === "searching" ? "searching" : `${matches.length} match${matches.length === 1 ? "" : "es"}`}
        </span>
      </div>

      <p className="sub">
        Similarity search over this desk&rsquo;s own backtests, execution summaries and risk
        incidents. Not the open web — every result is something this account produced.
      </p>

      <form
        className="corpus-search"
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <label className="sr-only" htmlFor="corpus-query">Search the research corpus</label>
        <input
          id="corpus-query"
          type="search"
          value={query}
          placeholder="e.g. moving average crossover drawdown"
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="sr-only" htmlFor="corpus-backend">Index</label>
        <select
          id="corpus-backend"
          value={backend}
          onChange={(event) => setBackend(event.target.value as SearchBackend)}
        >
          {/* Separate corpora, not two views of one — see the header. */}
          <option value="supabase">Supabase pgvector — live</option>
          <option value="oracle">Oracle 23ai — backfilled</option>
        </select>
        <button type="submit" disabled={status === "searching" || !query.trim()}>
          {status === "searching" ? "Searching…" : "Search"}
        </button>
      </form>

      {status === "idle" && (
        <p className="muted">
          Try{" "}
          {EXAMPLES.map((example, index) => (
            <span key={example}>
              {index > 0 && ", "}
              <button type="button" className="linklike" onClick={() => run(example)}>
                {example}
              </button>
            </span>
          ))}
          .
        </p>
      )}

      {status !== "idle" && (
        <p
          className={status === "error" ? "banner warn" : "muted"}
          role="status"
          aria-live="polite"
        >
          {status === "error" && <span aria-hidden>! </span>}
          {status === "searching" ? "Searching the corpus…" : outcome}
          {elapsedMs != null && status === "done" && ` in ${elapsedMs} ms`}
        </p>
      )}

      {matches.length > 0 && (
        <ol className="corpus-results">
          {matches.map((match) => (
            <li key={match.id}>
              <div className="corpus-result__head">
                <span className="corpus-result__title">{match.title}</span>
                {/*
                  Similarity is shown, not hidden behind a rank. A 0.86 and a
                  0.31 are both "the closest thing we have" and a reader who
                  only sees the ordering cannot tell those apart.
                */}
                <span className="num corpus-result__score" title="Cosine similarity">
                  {fmt(match.similarity, 3)}
                </span>
              </div>
              <div className="corpus-result__meta muted">
                <span>{match.kind.replace("_", " ")}</span>
                {match.symbol && <span>, {match.symbol}</span>}
                {match.strategy && <span>, {match.strategy}</span>}
                <span>, {new Date(match.occurred_at).toLocaleDateString()}</span>
              </div>
              <p className="corpus-result__body">{match.body}</p>
              <ConnectedDocuments documentId={match.id} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
