"use client";

import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import styles from "./ProofsTargetInstruments.module.css";

export interface MurphyScoreReading {
  key: string;
  label: string;
  value: string;
  equation: string;
  interpretation: string;
}

/** Controlled exact-value rail for the existing Murphy waterfall. */
export default function MurphyScoreInstrument({
  readings,
  selected,
  onSelect,
}: {
  readings: MurphyScoreReading[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const active = readings.find((reading) => reading.key === selected) ?? readings[0] ?? null;
  const activeIndex = readings.findIndex((reading) => reading.key === active?.key);
  const operators = ["", "−", "+", "+", "="] as const;
  const wholeEquation = active?.key === "brier";

  return (
    <section className={styles.scoreInspector} aria-label="Inspect Murphy decomposition terms">
      <header className={styles.equationHead}>
        <span>Exact identity</span>
        <strong>Reliability − Resolution + Uncertainty + Binning = Brier</strong>
      </header>
      <div className={styles.termRail} role="group" aria-label="Murphy score terms">
        {readings.map((reading, index) => (
          <Fragment key={reading.key}>
            {index ? (
              <span
                className={styles.equationOperator}
                data-active={wholeEquation || index === activeIndex || index === readings.length - 1}
                aria-hidden="true"
              >
                {operators[index]}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={styles.termButton}
              data-related={wholeEquation || active?.key === reading.key || reading.key === "brier"}
              data-role={reading.key === "brier" ? "total" : "term"}
              aria-label={`Inspect ${reading.label}, ${reading.value}`}
              aria-pressed={active?.key === reading.key}
              onPointerEnter={() => onSelect(reading.key)}
              onFocus={() => onSelect(reading.key)}
              onClick={() => onSelect(reading.key)}
            >
              <span>{reading.label.replace(/^[+−=]\s*/, "")}</span>
              <code>{reading.value}</code>
            </Button>
          </Fragment>
        ))}
      </div>
      <output className={styles.exactReadout} aria-live="polite" aria-atomic="true">
        {active ? (
          <>
            <strong>{active.label}</strong>
            <code>{active.value}</code>
            <span>{active.equation}</span>
            <span>{active.interpretation}</span>
          </>
        ) : (
          <span>No decomposition term was returned.</span>
        )}
      </output>
    </section>
  );
}
