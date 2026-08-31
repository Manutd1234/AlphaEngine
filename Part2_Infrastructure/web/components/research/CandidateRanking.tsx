import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { ResultsTable } from "@/components/Tables";
import type { ParamResult, SweepResponse } from "@/lib/types";

const MATCHING_LABEL = ["matching", "candidates"].join(" ");

/**
 * A ranking is a primary selection surface, not prose to disclose.
 *
 * The search only projects `topResults`; it never mutates the signed sweep or
 * the selected pair. With an empty query the original array is passed through,
 * so all fifteen ranked candidates remain mounted and selectable at rest.
 */
export default function CandidateRanking({
  data,
  selected,
  onSelect,
}: {
  data: SweepResponse;
  selected: ParamResult | null;
  onSelect: (result: ParamResult) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.topResults;
    return data.topResults.filter((result) =>
      `${result.fast}/${result.slow}`.toLowerCase().includes(needle));
  }, [data.topResults, query]);
  const projected = useMemo(
    () => filtered === data.topResults ? data : { ...data, topResults: filtered },
    [data, filtered],
  );

  const title = "Candidate ranking";
  return (
    <div className="card candidate-ranking">
      <div className="section-heading compact candidate-ranking__heading">
        <div>
          <span className="page-kicker">Grid search</span>
          <h2>{title}</h2>
        </div>
        <div className="candidate-ranking__search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            aria-label={title}
            placeholder={title}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <output className="num" aria-label={MATCHING_LABEL} aria-live="polite">
            {filtered.length}/{data.topResults.length}
          </output>
        </div>
      </div>
      <p className="sub candidate-ranking__instruction">
        The top 15 combinations behind the winner. Select a row to inspect that pair without losing the sweep.
      </p>
      <ResultsTable data={projected} onSelect={onSelect} selected={selected} />
    </div>
  );
}
