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
import { parseCorpusBody } from "@/lib/corpus-body";
import { fmt } from "@/lib/format";
import type { ResearchRagMatch } from "@/lib/research-rag";
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
        {/* No count chip here. It read `${matches.length} matches`, which the
            status line below already says with the two things the chip could
            not carry — the corpus size the count is out of, and the round trip
            — so on a finished search it was the same fact twice on one card.
            In the other three states it was worse than redundant: idle, error
            and unavailable all hold `matches` at zero, so the chip asserted
            "0 matches" over a search that had not been run, had failed, or had
            reached no index. That is a measured zero standing in for "we did
            not ask" and "we could not ask", which is the substitution
            `describeSearchOutcome` exists to keep apart. Do not restore it;
            the outcome sentence is the panel's status. */}
      </div>

      {/* "every result is something this account produced" was "this desk's own
          backtests and risk incidents" a second time in the same sentence.

          Folded, not dropped: it is a scope caveat about the index rather than
          anything the search returns, and the heading above it already asks
          "Has the desk seen this before?" — so the words a reader needs before
          typing are on screen, and the exact boundary is one labelled click
          away. No result, count or status moves. */}
      <details className="disclosure">
        <summary>What this searches over</summary>
        <p className="sub">
          Similarity search over this desk&rsquo;s own backtests and risk incidents, not the open web.
        </p>
      </details>

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
              <CorpusResultFacts match={match} />
              <ConnectedDocuments documentId={match.id} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * One document's facts as a two-column table: what the index knows about it
 * (kind, instrument, strategy, when) and then the embedded text, one row per
 * line. The text used to print as a paragraph with its newlines kept, which
 * was faithful to what the vector saw and unreadable as evidence — twenty
 * "Label: value" lines in one grey block, the values starting wherever the
 * labels happened to end. The rows keep the same words in the same order;
 * `lib/corpus-body.ts` says what is and is not split.
 *
 * The paragraph survives for a body that has no such lines at all — a
 * free-text incident note, say — because forcing prose into a two-column
 * table would be the inverse mistake.
 */
function CorpusResultFacts({ match }: { match: ResearchRagMatch }) {
  const rows = parseCorpusBody(match.body, match.title);
  const occurred = new Date(match.occurred_at).toLocaleDateString();
  return (
    <div className="table-wrap corpus-result__facts" tabIndex={0}>
      <table className="corpus-result__table">
        <caption className="sr-only">What the corpus holds for {match.title}</caption>
        <tbody>
          <tr>
            <th scope="row">Kind</th>
            <td>{match.kind.replace("_", " ")}</td>
          </tr>
          {match.symbol && (
            <tr>
              <th scope="row">Instrument</th>
              <td>{match.symbol}</td>
            </tr>
          )}
          {match.strategy && (
            <tr>
              <th scope="row">Strategy</th>
              <td>{match.strategy}</td>
            </tr>
          )}
          <tr>
            <th scope="row">Occurred</th>
            <td>{occurred}</td>
          </tr>
          {rows.map((row, index) =>
            row.label ? (
              <tr key={index}>
                <th scope="row">{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ) : (
              <tr key={index}>
                <td colSpan={2} className="corpus-result__prose">{row.value}</td>
              </tr>
            ),
          )}
          {rows.length === 0 && (
            <tr>
              <td colSpan={2}>
                <p className="corpus-result__body">{match.body}</p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
