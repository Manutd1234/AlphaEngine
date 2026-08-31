"use client";

/**
 * Feeds & Contracts, contracts half: the exact payload's contract result, the
 * per-provider totals this function instance holds, and the operator path.
 *
 * The operator path travels with this pane rather than with Freshness because
 * "Next evidence to inspect" is composed from the same contract and quota risk
 * the monitor above it prints; on the other pane it would be three
 * recommendations with none of their reasoning on screen.
 *
 * The empty state is the point of the whole pane. Serverless routes do not
 * reliably share module memory, so an empty aggregate here is NOT evidence that
 * every payload passed, and it says so rather than rendering a clean count.
 */

import type { InspectResponse } from "@/components/systems/types";
import type { ValidationCounts } from "@/components/systems/types";
import WorkspaceEntityLink from "@/components/workspace/WorkspaceEntityLink";
import {
  type DataTrustDestination,
  type DataTrustModel,
  type DataTrustTone,
} from "@/lib/data-trust";
import { DATA_SECTIONS } from "@/lib/sections";

import { absoluteTime } from "./trust-time";

/**
 * The rail's own label for a destination.
 *
 * `DataTrustAction.destination` is a section id — `quality`, `lineage`,
 * `providers` — and the rail above these buttons reads "Quality",
 * "Lineage & Payloads" and "Providers & Capacity". Printing the id named a
 * destination the reader cannot find on screen. Ids are public deep links and
 * never change, so every destination resolves; the id remains the fallback
 * because a button that still routes correctly should not lose its caption.
 */
function destinationLabel(destination: DataTrustDestination): string {
  return DATA_SECTIONS.find((section) => section.id === destination)?.label ?? destination;
}

interface FeedsContractsPaneProps {
  symbol: string;
  probe?: InspectResponse | null;
  probeError?: string | null;
  probeLoading?: boolean;
  trust: DataTrustModel;
  /** `validation.byProvider`, already sorted by evaluated count descending. */
  providerValidation: Array<[string, ValidationCounts]>;
  onOpenSection?: (section: DataTrustDestination) => void;
}

export default function FeedsContractsPane({
  symbol,
  probe,
  probeError,
  probeLoading,
  trust,
  providerValidation,
  onOpenSection,
}: FeedsContractsPaneProps) {
  const probeContract = probe?.provenance?.contract;
  const probeTone: DataTrustTone = probeLoading
    ? "unknown"
    : probeError || probeContract?.passed === false
      ? "bad"
      : !probeContract
        ? "unknown"
        : probeContract.violations.length || probeContract.notEvaluated.length
          ? "warn"
          : "good";

  return (
    <>
      <section className="card data-trust-monitor" aria-labelledby="contract-monitor-heading">
        {/* portfolio-card-heading — same reasoning as the feeds monitor. */}
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Validation</span>
            <h2 id="contract-monitor-heading">Exact payload &amp; instance sample</h2>
          </div>
          <span className="section-note">quote, bars, news and fundamentals</span>
        </div>

        <div className={`data-trust-probe is-${probeTone}`}>
          <span>Active quote</span>
          <strong>
            {probeLoading
              ? `checking ${symbol}`
              : probeError
                ? "probe failed"
                : probe?.provenance?.contract
                  ? `${probe.provenance.provider}, cache ${probe.cache.state}, contract attached`
                  : "no exact-payload contract result"}
          </strong>
          <small>
            {probe?.provenance?.contract
              ? `${probe.provenance.contract.violations.length} findings; ${probe.provenance.contract.notEvaluated.length} checks not evaluated; fetched ${absoluteTime(probe.provenance.fetchedAt)}`
              : probeError ?? "Withheld until this response carries validation evidence."}
          </small>
        </div>

        {providerValidation.length ? (
          <div className="table-wrap" tabIndex={0}>
            <table>
              <caption className="sr-only">Bounded contract-validation evidence by provider.</caption>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Evaluated</th>
                  <th scope="col">No fatal</th>
                  <th scope="col">Fatal</th>
                  <th scope="col">Warn / drift</th>
                </tr>
              </thead>
              <tbody>
                {providerValidation.map(([provider, counts]) => (
                  <tr key={provider}>
                    <td><strong><WorkspaceEntityLink kind="provider" value={provider}>{provider}</WorkspaceEntityLink></strong></td>
                    <td className="num">{counts.evaluated}</td>
                    <td className="num">{counts.passed}</td>
                    <td className="num">{counts.fatal}</td>
                    <td className="num">{counts.warn} / {counts.drift}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="data-trust-empty">
            <strong>No aggregate in the health-route instance.</strong>
            <p>
              Serverless routes do not reliably share module memory. An empty aggregate is not
              evidence that every payload passed.
            </p>
          </div>
        )}

        <p className="console-footnote">
          Window {trust.validation ? `${trust.validation.retained}/${trust.validation.capacity}` : "not exposed"}
          {trust.validation?.windowStart ? `; since ${absoluteTime(trust.validation.windowStart)}` : ""}
          {trust.validation?.lastValidationAt ? `; last ${absoluteTime(trust.validation.lastValidationAt)}` : ""}.
        </p>
        {/* The measured half of the footnote stays above. Only the scope
            caveat folds, and the summary states its exact doubt as a question
            so a reader who leaves it closed is still warned the totals may
            not be about the symbol in the heading. The pane's empty state
            carries the harder half of this claim and is untouched. */}
        <details className="disclosure">
          <summary>Do these totals belong to the instrument in the heading?</summary>
          <p className="console-footnote">
            Aggregate counts reset with the function instance and are not tied to {symbol}.
          </p>
        </details>
      </section>

      <section className="data-trust-section" aria-labelledby="trust-actions-heading">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Operator path</span>
            <h2 id="trust-actions-heading">Next evidence to inspect</h2>
          </div>
          <span className="section-note">read-only diagnostics</span>
        </div>
        <div className="data-trust-actions">
          {trust.actions.map((action) => (
            <button
              key={action.destination}
              type="button"
              className={`card data-trust-action is-${action.priority}`}
              onClick={() => onOpenSection?.(action.destination)}
              disabled={!onOpenSection}
            >
              <span>{action.priority}</span>
              <strong>{action.label}</strong>
              <small>{action.detail}</small>
              <i aria-hidden>Open {destinationLabel(action.destination)} →</i>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
