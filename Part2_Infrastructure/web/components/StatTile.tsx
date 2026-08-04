"use client";

/** A single number is not a chart. These are stat tiles, not one-bar bar charts. */
export default function StatTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "pos" | "neg" | "muted";
}) {
  const color =
    tone === "pos"
      ? "var(--success-text)"
      : tone === "neg"
        ? "var(--diverging-neg)"
        : "var(--text-primary)";
  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--text-muted)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div className="num" style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em", color }}>
        {value}
      </div>
      {note && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{note}</div>}
    </div>
  );
}
