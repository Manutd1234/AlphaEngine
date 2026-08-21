"use client";

/**
 * Trust Summary's Composition pane: what was contract-checked, and where each
 * answer came from.
 *
 * Everything here reads the counters incremented inside `dispatch()`, which
 * runs in the `/api/quote`-family lambdas rather than in the health route that
 * fills the rest of the snapshot. On a fully warm, heavily-trafficked
 * deployment they are still near-empty, which is why every chart on this pane
 * carries an empty note that says so instead of drawing a clean bill of health
 * out of no evidence.
 *
 * Split out of `DataTrustOverview` at the pane boundary; the pane state and the
 * segmented control stay in the parent.
 */

import CategoryBars, { type BarRow } from "@/components/charts/CategoryBars";
import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import type { SystemHealth, ValidationCounts } from "@/components/systems/types";

interface TrustCompositionPaneProps {
  health: SystemHealth | null;
  /** `validation.byProvider`, already sorted by evaluated count descending. */
  providerValidation: Array<[string, ValidationCounts]>;
}

export default function TrustCompositionPane({ health, providerValidation }: TrustCompositionPaneProps) {
  // One row per capability that has actually answered something. Cache hits are
  // counted separately from validated fetches because a cached answer was never
  // re-checked — folding them together would report contract coverage the
  // instance never performed.
  const validationWindow = health?.validation ?? null;
  const provenanceRows: BarRow[] = Object.entries(health?.cache.byCapability ?? {})
    .map(([capability, counters]) => {
      const checks = validationWindow?.byCapability?.[capability];
      const flagged = (checks?.fatal ?? 0) + (checks?.warn ?? 0) + (checks?.drift ?? 0);
      const hits = counters?.hits ?? 0;
      const rate = counters?.hitRate;
      return {
        label: capability,
        note: rate == null ? `${hits} cached` : `${Math.round(rate * 100)}% cached`,
        segments: [
          { label: "served from cache", value: hits, color: "var(--series-3)" },
          { label: "fetched, contract passed", value: checks?.passed ?? 0, color: "var(--series-1)" },
          { label: "fetched, flagged", value: flagged, color: "var(--status-warning)" },
          { label: "fetched, not evaluated", value: checks?.notEvaluated ?? 0, color: "var(--axis)" },
        ],
      };
    })
    .filter((row) => row.segments.some((segment) => segment.value > 0));

  /**
   * The composition ring. Same numbers as the per-capability bars, asked as
   * one question instead of N: of everything this instance answered, how much
   * was re-checked against a contract and how much was replayed from cache.
   * Cache hits stay their own slice — folding them into "passed" would report
   * contract coverage the instance never performed.
   */
  const provenanceTotals = provenanceRows.reduce(
    (acc, row) => {
      for (const segment of row.segments) {
        acc[segment.label] = (acc[segment.label] ?? 0) + segment.value;
      }
      return acc;
    },
    {} as Record<string, number>,
  );
  const provenanceSlices: DonutSlice[] = [
    { label: "served from cache", value: provenanceTotals["served from cache"] ?? 0, colour: "var(--series-3)" },
    { label: "contract passed", value: provenanceTotals["fetched, contract passed"] ?? 0, colour: "var(--series-1)" },
    { label: "flagged", value: provenanceTotals["fetched, flagged"] ?? 0, colour: "var(--status-warning)" },
    { label: "not evaluated", value: provenanceTotals["fetched, not evaluated"] ?? 0, colour: "var(--axis)" },
  ];
  const provenanceAnswers = provenanceSlices.reduce((acc, slice) => acc + slice.value, 0);

  return (
    <>

      {/* ------------------------------------------------------------------
          Payload verdict and findings composition — TWO MARKS, TWO DENOMINATORS.

          The obvious chart, "passed vs fatal+warn+drift", cannot be drawn:
          `ValidationCounts` documents that `passed` is a PAYLOAD count while
          fatal/warn/drift are FINDING counts — one payload can carry three
          warnings — so a single ring mixing them would not sum to `evaluated`.
          That is exactly the arithmetic this tab exists to be trusted about.

          So: a ring over payloads, bars over findings, and a sentence saying a
          green ring means no FATAL finding rather than a clean one.
          ------------------------------------------------------------------ */}
      <section className="card data-trust-verdict-ring" aria-labelledby="trust-verdict-ring-heading">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Contract validation</span>
            <h2 id="trust-verdict-ring-heading">Payload verdict &amp; findings</h2>
          </div>
          <span className="section-note">
            {validationWindow ? `${validationWindow.evaluated} evaluated` : "nothing evaluated yet"}
          </span>
        </div>

        <div className="data-trust-verdict-ring__grid">
          <DonutChart
            slices={[
              { label: "no fatal finding", value: validationWindow?.passed ?? 0, colour: "var(--status-good)" },
              {
                label: "fatal finding",
                value: Math.max(0, (validationWindow?.evaluated ?? 0) - (validationWindow?.passed ?? 0)),
                colour: "var(--status-critical)",
              },
            ]}
            total={validationWindow?.evaluated || undefined}
            centreValue={String(validationWindow?.evaluated ?? 0)}
            centreLabel="payloads"
            emptyNote="Nothing evaluated in this function instance. Zero evidence is not a clean bill of health."
            ariaLabel="Evaluated payloads by verdict"
          />

          <CategoryBars
            rows={[
              {
                label: "Findings",
                note: `${validationWindow?.fatal ?? 0} fatal, ${validationWindow?.warn ?? 0} warn, ${validationWindow?.drift ?? 0} drift`,
                segments: [
                  { label: "fatal", value: validationWindow?.fatal ?? 0, color: "var(--status-critical)" },
                  { label: "warn", value: validationWindow?.warn ?? 0, color: "var(--status-warning)" },
                  { label: "drift", value: validationWindow?.drift ?? 0, color: "var(--series-2)" },
                  { label: "not evaluated", value: validationWindow?.notEvaluated ?? 0, color: "var(--axis)" },
                ],
              },
            ]}
            ariaLabel="Validation findings by severity"
            emptyNote="No finding in this window."
          />
        </div>

        {/* Methodology, not measurement, so it folds. Both denominators are
            already printed beside their own mark — the section note says
            "{n} evaluated", the bars' row note says "{n} fatal, {n} warn,
            {n} drift", and the legend names every state in words — so nothing
            measured leaves the screen with this paragraph. What must NOT be
            folded is the doubt, and the summary is where it stays: a reader
            who never opens this is still asked whether green means clean. */}
        <details className="disclosure">
          <summary>Does a green ring mean this instance passed cleanly?</summary>
          <p className="research-note">
            Green means <strong>no fatal finding</strong>; warnings and drift may remain. The ring
            counts payloads, the bar findings, and one payload can carry several.
          </p>
        </details>
      </section>

      {/* `byProvider` is `Record<string, ValidationCounts>` — the same shape
          as `byCapability`, which is drawn as bars above, and already sorted
          by `evaluated` descending. It was reaching the browser and being
          rendered only as a table in the other view. Drawn when non-empty;
          a bar chart of nothing is not an honest empty state. */}
      {providerValidation.length > 0 && (
        <section className="card" aria-labelledby="trust-provider-validation-heading">
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">Contract validation</span>
              <h2 id="trust-provider-validation-heading">Checked payloads by provider</h2>
            </div>
            <span className="section-note">
              {providerValidation.length} provider{providerValidation.length === 1 ? "" : "s"} represented
            </span>
          </div>
          <CategoryBars
            rows={providerValidation.map(([provider, counts]) => ({
              label: provider,
              note: `${counts.evaluated} evaluated, ${counts.fatal} fatal, ${counts.warn} warn, ${counts.drift} drift`,
              segments: [
                { label: "no fatal finding", value: counts.passed, color: "var(--status-good)" },
                {
                  label: "fatal finding",
                  value: Math.max(0, counts.evaluated - counts.passed),
                  color: "var(--status-critical)",
                },
              ],
            }))}
            ariaLabel="Evaluated payloads per provider, split by fatal finding."
            emptyNote="No provider payload evaluated on this instance."
          />
          {/* No prose note: the card above states the payload/finding split
              in full, and a second statement of it on the same pane was the
              clutter this pass removed. */}
        </section>
      )}

      <section className="card data-trust-provenance" aria-labelledby="trust-provenance-heading">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Evidence composition</span>
            <h2 id="trust-provenance-heading">Where each answer came from</h2>
          </div>
          <span className="section-note">
            {validationWindow
              ? `${validationWindow.retained}/${validationWindow.capacity} of the instance window retained`
              : "no validation window yet"}
          </span>
        </div>
        {/* The ring answers the whole question at a glance; the bars answer it
            per capability. Same counters, two altitudes. */}
        <div className="data-trust-composition">
          <DonutChart
            slices={provenanceSlices}
            centreValue={provenanceAnswers ? String(provenanceAnswers) : undefined}
            centreLabel="answers"
            ariaLabel="Answers served, by contract-checked against replayed from cache."
            emptyNote="Nothing served yet."
          />
          <CategoryBars
            ariaLabel="Answers per capability, cached against contract-checked."
            rows={provenanceRows}
            emptyNote="No capability has served a request yet."
          />
        </div>
      </section>
    </>
  );
}
