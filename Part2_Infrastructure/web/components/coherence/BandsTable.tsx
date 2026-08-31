"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { probLabel, toUnit } from "@/lib/coherence/decimals";
import { priceLabel } from "@/lib/coherence/fixed-point";
import { parlayName } from "@/lib/coherence/parlay-name";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import styles from "./CombosTables.module.css";
import FrechetInstrument from "./FrechetInstrument";

type BandFilter = "all" | "inside" | "outside" | "missing";
type SortDirection = "ascending" | "descending";
type SortKey = "name" | "legs" | "lower" | "quote" | "reading";

function readingOf(combo: CoherenceCombo): BandFilter {
  if (combo.inside_band == null) return "missing";
  return combo.inside_band ? "inside" : "outside";
}

function readingLabel(combo: CoherenceCombo): string {
  const reading = readingOf(combo);
  if (reading === "inside") return "● inside";
  if (reading === "outside") return "▲ outside";
  return "◌ missing";
}

function rangeLabel(combo: CoherenceCombo): string {
  const lower = probLabel(combo.lower_bound);
  const upper = probLabel(combo.upper_bound);
  return lower === "—" || upper === "—" ? "—" : `${lower}–${upper}`;
}

function numericValue(combo: CoherenceCombo, key: SortKey): number | null {
  switch (key) {
    case "legs": return combo.legs.length;
    case "lower": return toUnit(combo.lower_bound);
    case "quote": return toUnit(combo.price);
    default: return null;
  }
}

function compareOptional(a: number | null, b: number | null, direction: SortDirection): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "ascending" ? a - b : b - a;
}

const READING_ORDER: Record<BandFilter, number> = { outside: 0, inside: 1, missing: 2, all: 3 };

function compareCombos(a: CoherenceCombo, b: CoherenceCombo, key: SortKey, direction: SortDirection): number {
  let result: number;
  if (key === "name") {
    result = parlayName(a).localeCompare(parlayName(b));
  } else if (key === "reading") {
    result = READING_ORDER[readingOf(a)] - READING_ORDER[readingOf(b)];
  } else {
    result = compareOptional(numericValue(a, key), numericValue(b, key), direction);
    return result || a.ticker.localeCompare(b.ticker);
  }
  const directed = direction === "ascending" ? result : -result;
  return directed || a.ticker.localeCompare(b.ticker);
}

function matchesQuery(combo: CoherenceCombo, query: string): boolean {
  if (!query) return true;
  return [
    parlayName(combo), combo.ticker, combo.label, combo.collection_ticker,
    combo.scope, combo.price_basis, combo.dependence,
  ].join(" ").toLowerCase().includes(query);
}

/** A dense local lens over the already-loaded payload; it never issues a read. */
export default function BandsTable({
  combos,
  selectedTicker,
  onSelectTicker,
}: {
  combos: CoherenceCombo[];
  selectedTicker: string | null;
  onSelectTicker: (ticker: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BandFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return combos
      .filter((combo) => matchesQuery(combo, needle))
      .filter((combo) => filter === "all" || readingOf(combo) === filter)
      .slice()
      .sort((a, b) => compareCombos(a, b, sortKey, sortDirection));
  }, [combos, filter, query, sortDirection, sortKey]);

  const selected = rows.find((combo) => combo.ticker === selectedTicker) || rows[0] || null;
  const visibleTicker = selected?.ticker ?? null;
  useEffect(() => {
    if (visibleTicker && visibleTicker !== selectedTicker) onSelectTicker(visibleTicker);
  }, [onSelectTicker, selectedTicker, visibleTicker]);

  const ariaSort = (key: SortKey): "none" | SortDirection => sortKey === key ? sortDirection : "none";
  const direction = (key: SortKey): "none" | SortDirection => sortKey === key ? sortDirection : "none";
  const sortBy = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => current === "ascending" ? "descending" : "ascending");
    } else {
      setSortKey(key);
      setSortDirection("ascending");
    }
  };
  const sortHandler = (key: SortKey) => () => sortBy(key);

  return (
    <section className={styles.tableShell} aria-label="Search and inspect loaded Fréchet bands">
      <div className={styles.localControls}>
        <div className={styles.localControl}>
          <Label htmlFor="coh-bands-local-search">Find parlay</Label>
          <Input
            id="coh-bands-local-search"
            type="search"
            value={query}
            placeholder="Name or ticker"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className={styles.localControl}>
          <Label htmlFor="coh-bands-local-state">Position</Label>
          <select
            id="coh-bands-local-state"
            value={filter}
            onChange={(event) => setFilter(event.target.value as BandFilter)}
          >
            <option value="all">All positions</option>
            <option value="outside">Outside range</option>
            <option value="inside">Inside range</option>
            <option value="missing">Unavailable</option>
          </select>
        </div>
        <p className={styles.resultCount} aria-live="polite">
          <strong>{rows.length} / {combos.length}</strong>
          <span>shown</span>
        </p>
      </div>

      <div
        className="table-wrap"
        role="region"
        aria-label="Loaded parlays and Fréchet bounds"
        tabIndex={0}
      >
        <table className="coh-table">
          <caption className="coh-table__caption">
            Choose a row to inspect its full range below.
          </caption>
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort("name")}><button type="button" className={styles.sortButton} data-direction={direction("name")} aria-label="Sort by parlay" onClick={sortHandler("name")}>Parlay</button></th>
              <th scope="col" className="num" aria-sort={ariaSort("legs")}><button type="button" className={styles.sortButton} data-direction={direction("legs")} aria-label="Sort by leg count" onClick={sortHandler("legs")}>Legs</button></th>
              <th scope="col" className="num" aria-sort={ariaSort("lower")}><button type="button" className={styles.sortButton} data-direction={direction("lower")} aria-label="Sort by allowed range" onClick={sortHandler("lower")}>Allowed range</button></th>
              <th scope="col" className="num" aria-sort={ariaSort("quote")}><button type="button" className={styles.sortButton} data-direction={direction("quote")} aria-label="Sort by quoted price" onClick={sortHandler("quote")}>Quote</button></th>
              <th scope="col" aria-sort={ariaSort("reading")}><button type="button" className={styles.sortButton} data-direction={direction("reading")} aria-label="Sort by position" onClick={sortHandler("reading")}>Position</button></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((combo) => (
              <tr className={selected?.ticker === combo.ticker ? "is-chosen" : undefined} key={combo.ticker}>
                <th scope="row">
                  <button
                    type="button"
                    className={styles.rowSelect}
                    aria-pressed={selected?.ticker === combo.ticker}
                    onPointerEnter={() => onSelectTicker(combo.ticker)}
                    onFocus={() => onSelectTicker(combo.ticker)}
                    onClick={() => onSelectTicker(combo.ticker)}
                  >
                    <span>{parlayName(combo)}</span>
                    <code className="coh-combo__ticker">{combo.ticker}</code>
                  </button>
                </th>
                <td className="num">{combo.legs.length}</td>
                <td className="num">{rangeLabel(combo)}</td>
                <td className="num">{priceLabel(combo.price)}</td>
                <td>{readingLabel(combo)}</td>
              </tr>
            ))}
            {rows.length ? null : (
              <tr><td className={styles.emptyCell} colSpan={5}>No parlay matches both filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <FrechetInstrument combo={selected} />
    </section>
  );
}
