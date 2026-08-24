"use client";

/**
 * The Universe section: the watched families, and the index they settle on.
 *
 * Three named views of one section behind a `.seg`, which is the only
 * in-section switcher this tab allows: a nested `<WorkspaceSubtabs>` would put
 * a second rail instance in front of the `--rail-h` publisher, as
 * `CoherenceConsole`'s header comment records.
 *
 * The head is the desk's own card grammar — kicker, `<h2>`, section note, one
 * `.sub` line — rather than the bare `<h4>` this tab used to open every pane
 * with. That was not a style preference: `panel-heading-rung.test.ts` records
 * a defect reported five times, where the first heading under a subtab rail
 * changed size between tabs. Every other tab renders it at the card-title rung;
 * this one rendered it four rungs down.
 *
 * The asset filter lives here, above the switcher, because it selects the
 * NOUN — which families are in view — while the switcher selects the question
 * asked about them. It reads Kalshi's own `category` off the universe payload
 * and never a ticker prefix: `KXBTCD` means Crypto because the exchange says
 * so, and a series it declines to categorise is grouped as unlabelled rather
 * than guessed at.
 *
 * The unreadable states stay OUTSIDE the switch. A reader who picks Settlement
 * and is shown a working feed while `COHERENCE_SERIES` is unset has been told
 * the section is fine when the watchlist behind it is empty, so `UniversePane`
 * reports its own failure whichever view is selected.
 *
 * The universe read itself is NOT gated on the view. It lives in the console
 * and is shared with the lattice section and the Coherence tab's certificate,
 * so a view predicate here would starve two other sections of their data.
 */

import { useMemo, useState } from "react";

import type { CoherenceUniverse } from "@/lib/coherence/types";
import PaneHead from "./PaneHead";
import SettlementPane from "./SettlementPane";
import UniversePane from "./UniversePane";

export type UniverseView = "baskets" | "settlement" | "formation";

/** The option every category filter opens on. Never a category's own name. */
const ALL = "__all__";
/** Where a family whose series Kalshi would not categorise is grouped. */
export const UNLABELLED = "__none__";

export interface UniverseSectionProps {
  /** The shared universe read, passed straight through from the console. */
  universe: CoherenceUniverse | null;
  error: string | null;
  /** False while another tab or another section is in front. */
  active: boolean;
}

export default function UniverseSection({ universe, error, active }: UniverseSectionProps) {
  const [view, setView] = useState<UniverseView>("baskets");
  const [category, setCategory] = useState<string>(ALL);

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

  return (
    <section className="card console-card coh-universe" aria-labelledby="markets-universe-heading">
      <PaneHead
        kicker="Universe"
        title="Watched families & what settles them"
        id="markets-universe-heading"
        note={universe
          ? `${events.length} ${events.length === 1 ? "family" : "families"} read live from `
            + `${universe.watchlist.length} series`
          : "reading the exchange"}
        lede={
          <>
            A mutually exclusive family is one dollar sold in pieces, so what the pieces cost reads directly on
            whether its prices admit a probability. Settlement is the published number that decides the payout —
            not the price on screen — and Formation is how it is made.
          </>
        }
      />

      <div className="coh-universe__controls">
        <div className="seg" role="group" aria-label="Universe view">
          <button type="button" aria-pressed={view === "baskets"} onClick={() => setView("baskets")}>
            Baskets
          </button>
          <button type="button" aria-pressed={view === "settlement"} onClick={() => setView("settlement")}>
            Settlement
          </button>
          <button type="button" aria-pressed={view === "formation"} onClick={() => setView("formation")}>
            Formation
          </button>
        </div>

        {/* Drawn only on Baskets: it filters families, and the other two views
            show one published index that no family selects. A control that
            stayed on screen doing nothing would be worse than none. */}
        {view === "baskets" && options.length > 1 ? (
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
      </div>

      <UniversePane
        universe={universe}
        events={shown}
        error={error}
        showBaskets={view === "baskets"}
        filtered={category !== ALL}
      />
      {/* The settlement feed owns its own poll, so it is mounted on every view
          and reads on only the two that show it — and it renders nothing at all
          on Baskets, since a "Reading…" line would describe a read that is not
          happening. */}
      <SettlementPane active={active} view={view === "baskets" ? null : view} />
    </section>
  );
}
