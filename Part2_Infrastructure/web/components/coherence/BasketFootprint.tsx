"use client";

/**
 * Whether the basket can actually be put on: each returned leg's requirement
 * against the contracts outstanding at that strike.
 *
 * Open interest is capacity evidence, not executable depth. Missing values,
 * measured zeroes and markets outside the selected family remain different
 * states throughout this component; none is coerced to zero or dropped.
 */

import { useEffect, useState } from "react";

import { money } from "@/lib/coherence/strike-axis";
import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import { pct } from "@/lib/format";

import CapacityMeasure from "./BasketCapacityMeasure";
import Figure, { FigureEmpty } from "./Figure";
import styles from "./BasketInstruments.module.css";

const CAPTION = "Certificate leg requirements against reported market activity";

type CapacityState = "within" | "over" | "missing" | "measured-zero" | "unreadable";

interface Column {
  label: string;
  ticker: string;
  sizeWire: string;
  openInterestWire: string | null;
  volumeWire: string | null;
  size: number | null;
  openInterest: number | null;
  volume: number | null;
  /** Solver requirement as a share of open interest; null when either side is unreadable. */
  share: number | null;
  tradedShare: number | null;
  missingReason: string | null;
  tradedMissingReason: string | null;
  capacityState: CapacityState;
}

function stateFor(size: number | null, openInterest: number | null, offBoard: boolean): CapacityState {
  if (offBoard || openInterest === null) return "missing";
  if (size === null) return "unreadable";
  if (openInterest === 0) return "measured-zero";
  return size > openInterest ? "over" : "within";
}

function statusFor(column: Column): string {
  if (column.capacityState === "within") return "Below reported open interest";
  if (column.capacityState === "over") return "Requirement exceeds open interest";
  if (column.capacityState === "measured-zero") return "Open interest is a measured zero";
  if (column.capacityState === "unreadable") return "Solver requirement is unreadable";
  return column.missingReason ?? "Open interest is not reported";
}

function columnsFor(certificate: CoherenceCertificate, event: CoherenceEventView | null) {
  const markets = event?.markets ?? [];
  const familyUnread = event === null;
  let offBoard = 0;
  const columns: Column[] = certificate.legs.map((leg) => {
    const market = markets.find((market) => market.ticker === leg.ticker) ?? null;
    const isOffBoard = !familyUnread && market === null;
    if (isOffBoard) offBoard += 1;
    const size = money(leg.size);
    const openInterest = market === null ? null : money(market.open_interest);
    const volume = market === null ? null : money(market.volume);
    const missingReason = familyUnread
      ? "the selected family has not been read yet"
      : market === null
        ? "market is outside the selected family"
      : size === null
        ? "the solver size is not readable"
        : openInterest === null
          ? "open interest was not reported"
          : openInterest === 0
            ? "open interest is a measured zero, so a share of it is undefined"
            : null;
    const tradedMissingReason = familyUnread
      ? "the selected family has not been read yet"
      : market === null
        ? "market is outside the selected family"
      : size === null
        ? "the solver size is not readable"
        : volume === null
          ? "traded volume was not reported"
          : volume === 0
            ? "traded volume is a measured zero, so a share of it is undefined"
            : null;

    return {
      label: leg.label || leg.ticker,
      ticker: leg.ticker,
      sizeWire: leg.size,
      openInterestWire: market?.open_interest ?? null,
      volumeWire: market?.volume ?? null,
      size,
      openInterest,
      volume,
      share: size === null || openInterest === null || openInterest === 0 ? null : size / openInterest,
      tradedShare: size === null || volume === null || volume === 0 ? null : size / volume,
      missingReason,
      tradedMissingReason,
      capacityState: stateFor(size, openInterest, isOffBoard),
    };
  });
  return { columns, offBoard };
}

export default function BasketFootprint({ certificate, event }: {
  certificate: CoherenceCertificate;
  /** The family, for the open interest each leg's market reports. Null while it is unread. */
  event: CoherenceEventView | null;
}) {
  const { columns, offBoard } = columnsFor(certificate, event);

  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const columnTickers = columns.map((column) => column.ticker).join("\u0000");
  const selectedMatch = columns.findIndex((column) => column.ticker === selectedTicker);
  const selected = selectedMatch >= 0 ? selectedMatch : 0;
  const firstTicker = columns[0]?.ticker ?? null;

  // Live polls may replace or reorder legs. Preserve the selected market by
  // identity, and retire a selection as soon as that market leaves the read so
  // an old positional index cannot silently migrate or reappear later.
  useEffect(() => {
    if (firstTicker === null) {
      if (selectedTicker !== null) setSelectedTicker(null);
    } else if (selectedMatch < 0) setSelectedTicker(firstTicker);
  }, [columnTickers, firstTicker, selectedMatch, selectedTicker]);
  const drawn = columns.map((column) => column.share).filter((share): share is number => share !== null);

  if (!columns.length) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="This test returned no basket legs to size"
        missing="This test returned no portfolio, so there is nothing to size."
      >
        <FigureEmpty reason="Nothing to size — the solver returned no basket legs." />
      </Figure>
    );
  }

  const unmeasured = columns.length - drawn.length;
  const over = drawn.filter((share) => share > 1).length;
  const refusal = [...new Set(columns.map((column) => column.missingReason).filter(Boolean))].join("; ");

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={
        `${columns.length} basket legs. Each row shows the full leg label and ticker, solver requirement, `
        + "reported open interest, and their ratio."
      }
      reading={
        !drawn.length
          ? `${columns.length} legs returned, but none has a measurable solver-size/open-interest ratio. `
            + "Select any leg to inspect its exact refusal."
          : over
            ? `${over} of ${columns.length} legs exceed reported open interest. This is context, not executable depth.`
            : `Every measured leg is below reported open interest; the largest ratio is ${pct(Math.max(...drawn))}.`
      }
      missing={
        unmeasured
          ? `${unmeasured} of ${columns.length} legs cannot be compared`
            + `${offBoard ? `; ${offBoard} name a market outside this family` : ""}`
            + ` — ${refusal}. The row remains selectable and no unavailable ratio is represented as zero.`
          : null
      }
      notes={[
        "Open interest is outstanding contracts, not executable depth or a fill estimate.",
        "Traded volume is a second activity denominator, never a substitute for depth.",
        "Solver sizes prove the certificate; they are not orders.",
      ]}
      readout={<span className="num">{`${drawn.length}/${columns.length} legs measurable`}</span>}
    >
      <div className={styles.capacityInstrument} data-basket-capacity="">
        <div className={styles.capacityKey} aria-label="Market activity comparison key">
          <span><i data-kind="requirement" aria-hidden="true" /> Required by certificate</span>
          <span><i data-kind="available" aria-hidden="true" /> Reported open interest</span>
          <span><i data-kind="missing" aria-hidden="true" /> Unread / not reported / off-family</span>
        </div>

        <ol className={styles.capacityList} aria-label="Basket capacity by leg">
          {columns.map((column, index) => {
            const scale = Math.max(
              1,
              Math.abs(column.size === null ? 0 : column.size),
              Math.abs(column.openInterest === null ? 0 : column.openInterest),
            );
            const status = statusFor(column);
            return (
              <li key={`${column.ticker}-${index}`} data-capacity-leg={index}>
                <button
                  type="button"
                  className={styles.capacityButton}
                  data-selected={selected === index ? "true" : "false"}
                  data-capacity-state={column.capacityState}
                  aria-label={`Inspect ${column.label}, ${column.ticker}. Requirement ${column.sizeWire}. `
                    + `Open interest ${column.openInterestWire ?? column.missingReason ?? "not reported"}. `
                    + `Share of open interest ${column.share === null ? "not measurable" : pct(column.share)}. ${status}.`}
                  aria-pressed={selected === index}
                  onPointerEnter={() => setSelectedTicker(column.ticker)}
                  onFocus={() => setSelectedTicker(column.ticker)}
                  onClick={() => setSelectedTicker(column.ticker)}
                >
                  <span className={styles.capacityIdentity}>
                    <span className={styles.capacityLegNumber}>{`Leg ${index + 1}`}</span>
                    <strong>{column.label}</strong>
                    <code>{column.ticker}</code>
                  </span>

                  <span className={styles.capacityComparison}>
                    <CapacityMeasure
                      label="Requirement"
                      wire={column.sizeWire}
                      value={column.size}
                      scale={scale}
                      kind="requirement"
                      unavailable="unreadable"
                    />
                    <CapacityMeasure
                      label="Available / open interest"
                      wire={column.openInterestWire}
                      value={column.openInterest}
                      scale={scale}
                      kind="available"
                      unavailable={column.missingReason ?? "not reported"}
                    />
                  </span>

                  <span className={styles.capacityStatus} data-state={column.capacityState}>
                    {column.share === null ? "◇" : column.share > 1 ? "▲" : "●"}
                    <span>{status}</span>
                    <strong className="num">{column.share === null ? "Not measurable" : pct(column.share)}</strong>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div
          className={styles.capacityDetailStack}
          data-selected-detail=""
          aria-live="polite"
          aria-atomic="true"
        >
          {columns.map((column, index) => (
            <section
              className={styles.capacityDetail}
              data-active={selected === index ? "true" : "false"}
              data-state={column.capacityState}
              aria-hidden={selected === index ? undefined : true}
              key={`${column.ticker}-${index}`}
            >
              <header className={styles.capacityDetailHead}>
                <span>{`Selected leg ${index + 1} of ${columns.length}`}</span>
                <h3>{column.label}</h3>
                <code>{column.ticker}</code>
              </header>
              <dl className={styles.capacityMetrics}>
                <div><dt>Solver size</dt><dd className="num">{column.sizeWire}</dd></div>
                <div><dt>Open interest</dt><dd className="num">{column.openInterestWire ?? "not reported"}</dd></div>
                <div><dt>Share of OI</dt><dd className="num">{column.share === null ? "not measurable" : pct(column.share)}</dd></div>
                <div><dt>Traded volume</dt><dd className="num">{column.volumeWire ?? "not reported"}</dd></div>
                <div><dt>Share of traded</dt><dd className="num">{column.tradedShare === null ? "not measurable" : pct(column.tradedShare)}</dd></div>
              </dl>
              <p>
                {column.missingReason
                  ? `Capacity comparison withheld: ${column.missingReason}.`
                  : `${column.sizeWire} required against ${column.openInterestWire} outstanding; `
                    + `${column.share !== null && column.share > 1 ? "the requirement exceeds" : "the requirement fits inside"} reported open interest.`}
                {column.tradedMissingReason ? ` Traded-volume comparison: ${column.tradedMissingReason}.` : ""}
              </p>
            </section>
          ))}
        </div>
      </div>
    </Figure>
  );
}
