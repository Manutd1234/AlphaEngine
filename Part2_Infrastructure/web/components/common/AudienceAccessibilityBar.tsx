"use client";

import { useState } from "react";

interface AudienceAccessibilityBarProps {
  fontSize: "normal" | "large" | "xlarge" | "huge";
  onFontSizeChange: (size: "normal" | "large" | "xlarge" | "huge") => void;
  plainEnglishMode: boolean;
  onTogglePlainEnglish: () => void;
}

export default function AudienceAccessibilityBar({
  fontSize,
  onFontSizeChange,
  plainEnglishMode,
  onTogglePlainEnglish,
}: AudienceAccessibilityBarProps) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="accessibility-bar-trigger"
        title="Accessibility & High Legibility Controls (Elderly / Beginners)"
        aria-label="Accessibility controls"
        style={{
          background: "rgba(255, 255, 255, 0.06)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          color: "var(--text-secondary)",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span>👁️</span>
        <span className="hidden sm:inline">Legibility</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "120%",
            right: 0,
            width: "260px",
            background: "#111827",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: "8px",
            padding: "12px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.6)",
            zIndex: 9999,
            fontSize: "11px",
            color: "#f8fafc",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: "8px", color: "#38bdf8", fontSize: "12px" }}>
            👁️ High-Legibility &amp; Accessibility Controls
          </div>

          <div style={{ marginBottom: "10px" }}>
            <label style={{ display: "block", color: "#9ca3af", fontSize: "10.5px", marginBottom: "4px" }}>
              Text Size Scaling (Elderly / High Legibility)
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px" }}>
              {(["normal", "large", "xlarge", "huge"] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onFontSizeChange(size)}
                  style={{
                    background: fontSize === size ? "#38bdf8" : "rgba(255,255,255,0.06)",
                    color: fontSize === size ? "#090d12" : "#f8fafc",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "4px",
                    padding: "3px 0",
                    fontWeight: 700,
                    fontSize: "10px",
                    cursor: "pointer",
                    textTransform: "uppercase",
                  }}
                >
                  {size === "normal" ? "13px" : size === "large" ? "15px" : size === "xlarge" ? "17px" : "19px"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={onTogglePlainEnglish}
              style={{
                width: "100%",
                background: plainEnglishMode ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.06)",
                border: plainEnglishMode ? "1px solid #10b981" : "1px solid rgba(255, 255, 255, 0.1)",
                color: plainEnglishMode ? "#a7f3d0" : "#f8fafc",
                borderRadius: "4px",
                padding: "6px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>Plain-English Summaries</span>
              <span>{plainEnglishMode ? "ON ✅" : "OFF ⚪"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
