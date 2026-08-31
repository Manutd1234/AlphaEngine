import styles from "./BasketInstruments.module.css";

function barWidth(value: number, scale: number): string {
  return `${Math.min(100, Math.max(0, Math.abs(value) / scale * 100))}%`;
}

/** One half of a basket capacity row, kept separate from the data join. */
export default function BasketCapacityMeasure({
  label,
  wire,
  value,
  scale,
  kind,
  unavailable,
}: {
  label: string;
  wire: string | null;
  value: number | null;
  scale: number;
  kind: "requirement" | "available";
  unavailable: string;
}) {
  return (
    <span className={styles.capacityMeasure}>
      <span className={styles.capacityMeasureHead}>
        <span>{label}</span>
        <strong className="num">{wire ?? unavailable}</strong>
      </span>
      <span className={styles.capacityTrack} aria-hidden="true">
        {value === null ? (
          <span className={styles.capacityUnavailable} data-kind={kind} />
        ) : (
          <span
            className={styles.capacityFill}
            data-kind={kind}
            data-zero={value === 0 ? "true" : "false"}
            style={{ inlineSize: barWidth(value, scale) }}
          />
        )}
      </span>
    </span>
  );
}
