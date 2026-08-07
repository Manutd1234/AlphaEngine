"use client";

import { useState } from "react";

interface QuantEducationalTooltipProps {
  term: string;
  definition: string;
  formula?: string;
  plainEnglish: string;
}

export default function QuantEducationalTooltip({
  term,
  definition,
  formula,
  plainEnglish,
}: QuantEducationalTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="quant-tooltip-trigger"
        aria-label={`Learn about ${term}`}
        style={{
          background: "rgba(56, 189, 248, 0.12)",
          color: "var(--series-1)",
          border: "1px solid rgba(56, 189, 248, 0.3)",
          borderRadius: "4px",
          padding: "1px 5px",
          fontSize: "10px",
          fontWeight: 600,
          cursor: "pointer",
          marginLeft: "4px",
          lineHeight: "1.2",
        }}
      >
        ℹ️ {term}
      </button>

      {open && (
        <div
          className="quant-tooltip-popover"
          style={{
            position: "absolute",
            bottom: "125%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "280px",
            background: "#1e293b",
            color: "#f8fafc",
            border: "1px solid #334155",
            borderRadius: "8px",
            padding: "10px 12px",
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.5)",
            zIndex: 9999,
            fontSize: "11px",
            lineHeight: "1.4",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, color: "#38bdf8", marginBottom: "4px", fontSize: "12px" }}>
            {term}
          </div>
          <div style={{ color: "#cbd5e1", marginBottom: "6px" }}>{definition}</div>
          {formula && (
            <div style={{ fontFamily: "monospace", background: "#0f172a", padding: "3px 6px", borderRadius: "4px", color: "#38bdf8", marginBottom: "6px", fontSize: "10.5px" }}>
              {formula}
            </div>
          )}
          <div style={{ background: "rgba(16, 185, 129, 0.15)", borderLeft: "3px solid #10b981", padding: "4px 8px", borderRadius: "0 4px 4px 0", color: "#a7f3d0", fontSize: "10.5px" }}>
            <strong>In plain English:</strong> {plainEnglish}
          </div>
        </div>
      )}
    </span>
  );
}
