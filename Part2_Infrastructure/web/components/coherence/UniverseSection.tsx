"use client";

/**
 * The Universe section: the watched families, priced against the dollar they pay.
 *
 * ONE subject, TWO views — and since the split of 2026-08-25 the subject and
 * the switcher finally agree. Baskets is the one figure that compares every family
 * against the dollar it pays — the section's headline question, so it is the
 * default. Families is the per-family detail, and since the THIRD review of
 * 2026-08-24 it is ONE family at a time: the second pass drew every family
 * card in a packed grid, and with each card's outcome disclosure open that was
 * three 188-row tables side by side, running under each other's borders. "we
 * can split these three boxes into three subtabs for families" — so the view
 * is now a family picker (the shared `FamilyPicker`, the same control the
 * Coherence tab's certificate uses) over a single card. The asset-type filter
 * stays and filters the PICKER's options, not the overview: a comparison
 * figure that silently dropped rows under a filter set on another view would
 * read as a complete picture of a smaller watchlist.
 *
 * The switcher is a `.seg` with `aria-pressed`, never a nested
 * `<WorkspaceSubtabs>` — a second rail instance fights the first over the
 * `--rail-h` publisher, as `ReliabilityConsole` records.
 *
 * ONE CONTROL ROW, from the fifth review of 2026-08-24 ("now it is so ugly").
 * The asset filter and the family picker used to stack, so Families opened on
 * THREE rows of chrome before any data — the same defect the same review named
 * on the lattice. They are not two decisions: the filter narrows the picker's
 * options and the picker chooses one of them, so they are two halves of "which
 * family", and they share the row.
 *
 * SINCE 2026-08-25 THAT ROW IS `SectionFrame`'S, and the pair goes into its
 * `subject` slot together. This section's own `.coh-universe__controls` box was
 * the first place the rule was implemented and it is not rendered any more —
 * the rule outgrew one section, which is what `.coh-section__controls` in
 * `14x-markets-frame.css` is. The stale rule in `10h-universe-overview.css` now
 * matches nothing and is another session's file to remove; `dead-css` cannot
 * see it, because the class name still appears in prose like this sentence.
 *
 * The filter reads Kalshi's own `category` off the universe payload, never a
 * ticker prefix, and that provenance is ON SCREEN beside the control because
 * it is the kind of claim a reader has to be able to check.
 *
 * The unreadable states stay in `UniversePane`, below the switcher: a reader
 * shown controls while `COHERENCE_SERIES` is unset has been told the section
 * is fine when the watchlist behind it is empty.
 *
 * The universe read lives in the console, shared with the lattice and the
 * certificate, so this component takes it as a prop and owns no poll.
 *
 * SETTLEMENT LEFT AGAIN ON 2026-08-25, and this time it is a rail section with
 * its own file. It rode here as three of five views for a day, on the argument
 * that the families are priced against an outcome and the published variable
 * that outcome is read from is the next question the baskets raise. That is
 * still true, and it is still the wrong shape: the next question is a DIFFERENT
 * question, and a switcher holds views of ONE. The reader counted what the
 * difference cost — "the universe section has too many subtabs" — and three of
 * the five were the settlement feed's.
 *
 * So this section is two views over one read, and `SettlementSection` is three
 * views over another. What is left here is one question: a mutually exclusive
 * family is a dollar sold in pieces, and what the pieces cost is the answer.
 */

import { useMemo, useState } from "react";

import type { CoherenceUniverse } from "@/lib/coherence/types";
import FamilyPicker from "./FamilyPicker";
import PaneHead from "./PaneHead";
import SectionFrame from "./SectionFrame";
import UniversePane, { type UniverseView } from "./UniversePane";

/** The two views, in the order they are pressed. */
const VIEWS: ReadonlyArray<[UniverseView, string]> = [
  ["baskets", "Baskets"],
  ["families", "Families"],
];

/** The option every category filter opens on. Never a category's own name. */
const ALL = "__all__";
/** Where a family whose series Kalshi would not categorise is grouped. */
export const UNLABELLED = "__none__";

export interface UniverseSectionProps {
  /** The shared universe read, passed straight through from the console. */
  universe: CoherenceUniverse | null;
  error: string | null;
}

export default function UniverseSection({ universe, error }: UniverseSectionProps) {
  const [view, setView] = useState<UniverseView>("baskets");
  const [category, setCategory] = useState<string>(ALL);
  const [picked, setPicked] = useState<string | null>(null);

  const events = universe?.events ?? [];
  const categories = universe?.categories ?? {};

  /** Each category the watchlist actually carries, with how many families. */
  const options = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) {
      const key = categories[event.series_ticker] || UNLABELLED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => (a[0] === UNLABELLED ? 1 : b[0] === UNLABELLED ? -1 : a[0].localeCompare(b[0])));
  }, [events, categories]);

  const shown = useMemo(
    () => (category === ALL
      ? events
      : events.filter((event) => (categories[event.series_ticker] || UNLABELLED) === category)),
    [events, categories, category],
  );

  // The one family the Families view draws. Derived, not stored alone: when
  // the filter changes and the picked ticker leaves the shown set, the view
  // falls back to the first family of the new set instead of a blank card.
  const family = shown.find((event) => event.event_ticker === picked) ?? shown[0] ?? null;

  /* The subject, and it is TWO halves of one choice rather than two decisions:
     the filter narrows the picker's options and the picker chooses one of them.
     Drawn at all only when there is something to choose — one option is no
     choice — and only on the view that draws one family, because a comparison
     figure that silently dropped rows under a filter set on another view would
     read as a complete picture of a smaller watchlist. */
  const subject = view === "families" && (options.length > 1 || shown.length > 1) ? (
    <>
      {options.length > 1 ? (
        /* NOT gated on the shown set: a repoll can empty the selected category,
           and the control to leave it must survive that. */
        <label className="coh-universe__filter">
          <span>Asset type</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value={ALL}>All families ({events.length})</option>
            {options.map(([key, count]) => (
              <option key={key} value={key}>
                {key === UNLABELLED ? "Uncategorised" : key} ({count})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {shown.length > 1 ? (
        <FamilyPicker
          options={shown.map((event) => ({
            ticker: event.event_ticker,
            shard: event.exchange_index,
          }))}
          selected={family?.event_ticker ?? ""}
          onSelect={setPicked}
          label="Choose a family"
        />
      ) : null}
    </>
  ) : null;

  return (
    <SectionFrame
      className="coh-universe"
      aria-labelledby="markets-universe-heading"
      head={
        <PaneHead
          kicker="Universe"
          title="Watched families & what a dollar of one costs"
          id="markets-universe-heading"
          note={universe
            ? `${events.length} ${events.length === 1 ? "family" : "families"} read live from `
              + `${universe.watchlist.length} series`
            : "reading the exchange"}
          lede="A mutually exclusive family is one dollar sold in pieces, so what the pieces cost says whether its prices admit a probability."
        />
      }
      views={VIEWS}
      view={view}
      onView={setView}
      viewsLabel="Universe view"
      subject={subject}
      notes={view === "families" ? {
        /* Provenance — where the categories come from and what happens to a
           series without one. It is the first thing a reader stops needing and
           the last thing they can afford to lose, so it is folded rather than
           cut, and the summary names both halves so nobody opens it to learn
           what is inside. */
        summary: "Where these asset types come from, and what uncategorised means",
        body: (
          <p className="coh-event__meta">
            The filter is Kalshi&rsquo;s own category for each series, never read off the ticker; a series it does
            not categorise is grouped as uncategorised rather than guessed at.
          </p>
        ),
      } : null}
    >
      <UniversePane
        universe={universe}
        view={view}
        events={view === "families" ? (family ? [family] : []) : events}
        error={error}
        filtered={view === "families" && category !== ALL}
      />
    </SectionFrame>
  );
}
