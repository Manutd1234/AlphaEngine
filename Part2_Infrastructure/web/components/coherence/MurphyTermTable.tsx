import { decimalLabel } from "@/lib/coherence/decimals";

import type { Term } from "./murphy-terms";

/** Compact glossary for the signed terms in Murphy's decomposition. */
export default function MurphyTermTable({
  terms,
  places,
}: {
  terms: Term[];
  places: number;
}) {
  return (
    <details className="disclosure">
      <summary>{`What each of the ${terms.length} terms means, and which way it is good`}</summary>
      <div
        className="table-wrap coh-calib__terms-wrap"
        role="region"
        aria-label="Murphy decomposition term definitions"
        tabIndex={0}
      >
        <table className="coh-table coh-calib__terms">
          <caption className="coh-table__caption sr-only">
            Signs, exact values, preferred directions, and definitions for the Murphy decomposition terms.
          </caption>
          <thead>
            <tr>
              <th scope="col">Sign</th>
              <th scope="col">Term</th>
              <th scope="col" className="num">Value</th>
              <th scope="col">Good direction</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {terms.map((term) => (
              <tr key={term.key}>
                <td className="coh-calib__term-sign">
                  <span aria-hidden="true">{term.sign < 0 ? "−" : "+"}</span>
                  <span className="sr-only">{term.sign < 0 ? "Subtract" : "Add"}</span>
                </td>
                <th scope="row">{term.name}</th>
                <td className="num">{decimalLabel(term.raw, places)}</td>
                <td>{term.direction}</td>
                <td>{term.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
