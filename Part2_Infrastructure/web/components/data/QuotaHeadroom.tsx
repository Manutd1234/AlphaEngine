"use client";

/**
 * Quota as a proportion of its own window, tightest first.
 *
 * Deliberately not a second copy of `QuotaMeters` (Providers section), which
 * draws absolute counts with the window countdown: there, 5/5 and 5/5000 are
 * two bars of the same length and one of them is an emergency. Here every row
 * is normalised to its own limit, so the question "which supplier runs out
 * first" is answered by reading down the list rather than by dividing in your
 * head.
 *
 * The reserve is drawn as its own band rather than folded into the free space,
 * because it is not free: background polling is fenced out as soon as
 * `remaining <= reserve`, so a desk reading "245 left" may already be refusing
 * every automatic refresh.
 */

import CategoryBars, { type BarRow } from "@/components/charts/CategoryBars";
import type { SystemHealth } from "@/components/systems/types";
import { deriveQuotaHeadroom } from "@/lib/data-trust";

export default function QuotaHeadroom({ health }: { health: SystemHealth | null }) {
  const rows = deriveQuotaHeadroom(health);
  const unmetered = (health?.providers ?? []).filter(
    (provider) => provider.configured && (!provider.quota || provider.quota.limit <= 0),
  );
  const fenced = rows.filter((row) => row.tone !== "good").length;

  const bars: BarRow[] = rows.map((row) => ({
    label: row.label,
    note: `${row.used} of ${row.limit} per ${row.window}; ${row.reserve} held in reserve`,
    segments: [
      { label: "spent", value: row.spentPct, color: "var(--series-1)" },
      { label: "free for background", value: row.freePct, color: "var(--status-good)" },
      { label: "reserved for interactive", value: row.reservedPct, color: "var(--status-warning)" },
    ],
  }));

  return (
    <section className="card" aria-labelledby="trust-quota-heading">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Budget</span>
          <h2 id="trust-quota-heading">Quota headroom</h2>
        </div>
        <span className="section-note">
          {rows.length ? `${rows.length} metered, tightest first` : "no metered provider"}
        </span>
      </div>

      {/* A shared 0–100 denominator: each row is a share of its OWN window, and
          `max` fixes the scale so two providers with different limits are still
          comparable side by side. */}
      <CategoryBars
        rows={bars}
        max={100}
        ariaLabel="Each metered provider's quota window: the share spent, the share free for background polling, and the share reserved for interactive lookups."
        emptyNote="No provider in this environment keeps a local quota ledger, so there is no headroom to report."
      />

      {/* Only over a populated chart. With zero metered rows the all-clear
          sentence would be comfort over an empty set, and the bars' own
          emptyNote already reports the emptiness honestly.

          The keyless exclusion is NOT restated here. The footnote below names
          those providers, says why they keep no ledger and says their absence
          is not headroom — so a clause here saying the same thing unnamed was
          the same caveat twice on one pane, and the weaker of the two. */}
      {rows.length > 0 && (
        <>
          <p className="research-note">
            {fenced
              ? <><strong>{fenced}</strong> provider{fenced === 1 ? " is" : "s are"} at or past the
                reserve, so background refreshes there are refused while interactive lookups still
                work.</>
              : "No provider has reached its reserve, so background and interactive traffic are both funded."}
          </p>
          {/* A split, not a move. The middle clause of the paragraph above is a
              figure a reader acts on — background polling already being
              refused — and it stays on screen. What folds is a reading rule
              over a fact already printed on every row ("{used} of {limit} per
              {window}") and a pointer to where the clock is drawn. */}
          <details className="disclosure">
            <summary>How should a bar&rsquo;s length be read, and where is the reset clock?</summary>
            <p className="research-note">
              Each bar is a share of its own window; the absolute count sits beside it. The window
              countdown and per-call ledger live in Providers.
            </p>
          </details>
        </>
      )}

      {/* The chart's excluded half, named. These providers ARE configured, so
          the paragraph above does not cover them: `deriveQuotaHeadroom` drops
          them for keeping no local ledger, which is not the same fact as a
          ledger with room in it. Unnamed, they are indistinguishable from
          providers this deployment does not have. */}
      {unmetered.length > 0 && (
        <p className="console-footnote">
          Unmetered: {unmetered.map((provider) => provider.label).join(", ")} — keyless or billed by
          request weight, not by call count, so no local ledger is kept. Their absence from the
          chart is not headroom.
        </p>
      )}
    </section>
  );
}
