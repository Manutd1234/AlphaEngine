"use client";

/**
 * The distribution a family's prices imply, as the exchange quotes it.
 *
 * The survival function the strikes sample, the mass differencing leaves
 * between two strikes, and the moments of that mass. This view reads and
 * decides nothing: what follows from the measure is the stake view's question.
 *
 * The decimal helper and the fact table are exported from here because this is
 * the first of the three views to need them and the other two read them from
 * here — one spelling of "truncate, never round" for the whole section.
 */

import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import { StateChip } from "../Figure";
import PmfChart from "../PmfChart";
import SurvivalChart from "../SurvivalChart";

/**
 * A wire decimal for display, truncated and never rounded.
 *
 * A standard deviation arrives as `1.599804675577615631316479364` — 27 places
 * that `toCenticents` refuses outright, being finer than a centicent. Cutting
 * the string is exact where rounding a float is not, and the ellipsis says a
 * digit was cut rather than pretending the value ended there.
 */
export function decimalLabel(raw: string | null | undefined, places = 4): string {
  if (raw == null) return "—";
  const text = raw.trim();
  if (!/^-?\d*(?:\.\d*)?$/.test(text) || text === "" || text === "-") return "—";
  const [whole, fraction = ""] = text.split(".");
  const head = whole === "" || whole === "-" ? `${whole}0` : whole;
  if (!fraction) return head;
  const kept = fraction.slice(0, places);
  const cut = /[1-9]/.test(fraction.slice(places));
  return `${head}.${kept}${cut ? "…" : ""}`;
}

export interface Fact {
  label: string;
  value: string;
  says: string;
}

export function FactTable({ caption, facts }: { caption: string; facts: Fact[] }) {
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Reading</th>
            <th scope="col" className="num">Value</th>
            <th scope="col">What it says</th>
          </tr>
        </thead>
        <tbody>
          {facts.map((fact) => (
            <tr key={fact.label}>
              <th scope="row">{fact.label}</th>
              <td className="num">{fact.value}</td>
              <td>{fact.says}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One row of a fact table: the reading, the figure, what it lets you say. */
export function row(label: string, value: string, says: string): Fact {
  return { label, value, says };
}

/**
 * `absent` is two words on purpose. It used to carry the sentence that now sits
 * under the table, which rendered it in up to six of these seven cells AND
 * again in the note — the same explanation seven times on one screen.
 */
function moments(surface: CoherenceSurface): Fact[] {
  const absent = "Not computed.";
  return [
    row("Mean", decimalLabel(surface.mean, 4),
      surface.mean ? "The centre of the mass sitting between the outermost quoted strikes." : absent),
    row("Standard deviation", decimalLabel(surface.standard_deviation, 4),
      surface.standard_deviation ? "The spread of that same interior mass, in the units the strikes are quoted in." : absent),
    row("Skewness", decimalLabel(surface.skewness, 4),
      surface.skewness ? "Positive means the interior mass leans to the low strikes with a long tail up." : absent),
    row("Excess kurtosis", decimalLabel(surface.excess_kurtosis, 4),
      surface.excess_kurtosis ? "Above zero means more mass in the shoulders than a normal of the same width." : absent),
    row("Total quoted mass", decimalLabel(surface.total_mass, 4),
      "What every bin sums to. On a ladder the differences telescope, so this confirms the arithmetic, never the prices."),
    row("Low tail", decimalLabel(surface.tail_mass_low, 4),
      surface.tail_mass_low
        ? "Mass below the lowest quoted strike. The exchange quotes no width down there, so it is excluded from the moments above."
        : absent),
    row("High tail", decimalLabel(surface.tail_mass_high, 4),
      surface.tail_mass_high ? "Mass above the highest quoted strike, excluded from the moments for the same reason." : absent),
  ];
}

export default function DistributionView({ surface }: { surface: CoherenceSurface }) {
  return (
    <>
      <h4>The distribution these prices imply</h4>

      {/* No "Intervals" chip: PmfChart draws one bar per interval and names the
          number in its own description, so the chip stood above the figure
          counting the figure. */}
      <div className="coh-status__chips">
        <StateChip mark="◇" word={surface.engine === "ladder" ? "Strike ladder" : `${surface.engine} family`} value={surface.event_ticker} tone="muted" />
        <StateChip mark="→" word="Strikes probed" value={String(surface.probes.length)} tone="muted" />
        <StateChip mark="◌" word="Priced from" value={surface.basis ?? "no side"} tone={surface.basis ? "muted" : "warn"} />
        {surface.negative_bins.length ? (
          <StateChip mark="▽" word="Negative mass" value={`${surface.negative_bins.length} interval(s)`} tone="critical" />
        ) : (
          <StateChip mark="✓" word="No negative mass" tone="good" />
        )}
      </div>

      <SurvivalChart surface={surface} />
      <PmfChart surface={surface} />

      <FactTable caption="The moments of the implied distribution, and the mass they are taken over" facts={moments(surface)} />
      <p className="coh-surface__moments-note">
        <span aria-hidden="true">◌</span> Every moment above is {surface.moments_note}. &ldquo;Not
        computed.&rdquo; means the mass leaves it undefined — missing, never zero.
      </p>
    </>
  );
}
