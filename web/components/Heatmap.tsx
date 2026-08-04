"use client";

/**
 * Sharpe surface over the parameter grid.
 *
 * Sharpe is signed around a meaningful zero, so this is a *diverging* scale:
 * blue ↔ neutral grey ↔ red, with grey meaning "no edge". (A red-yellow-green
 * ramp would put a hue at the midpoint, so zero reads as a value rather than as
 * nothing — and yellow/green is the pair colour-blind readers lose first.)
 *
 * The shape is the message: a broad plateau means the edge survives small
 * parameter changes; a lone bright cell surrounded by grey is an overfit, and
 * seeing that is worth more than any single number.
 */

import { CellKind, ParamResult, StabilityCell } from "@/lib/types";
import { fmt, pct } from "@/lib/format";
import { useMeasuredWidth } from "./chart-kit";
import { useEffect, useState } from "react";

/** Interpolate in sRGB between the diverging poles and the neutral midpoint. */
function divergingColor(v: number, absMax: number, dark: boolean): string {
  const pos = dark ? [57, 135, 229] : [42, 120, 214];
  const neg = dark ? [230, 103, 103] : [227, 73, 72];
  const mid = dark ? [56, 56, 53] : [240, 239, 236];
  const t = Math.max(-1, Math.min(1, absMax ? v / absMax : 0));
  const end = t >= 0 ? pos : neg;
  const k = Math.abs(t);
  const rgb = mid.map((m, i) => Math.round(m + (end[i] - m) * k));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/**
 * Categorical fill for the neighbourhood view.
 *
 * Categorical, not a ramp: "plateau" and "cliff" are kinds, not two ends of one
 * quantity, and colouring them along a gradient would invite reading a cliff as
 * "a bit less plateau". Each kind also carries a glyph in the cell label and the
 * legend, because these five are exactly the sort of set colour alone cannot
 * carry.
 */
const KIND_STYLE: Record<CellKind, { fill: string; darkFill: string; glyph: string; label: string }> = {
  plateau: { fill: "#2f8f66", darkFill: "#35c48f", glyph: "▰", label: "plateau — neighbours hold up" },
  slope: { fill: "#c08a1f", darkFill: "#e8ab3d", glyph: "◪", label: "slope — degrading" },
  cliff: { fill: "#c2454f", darkFill: "#f0737c", glyph: "▲", label: "cliff — neighbours collapse" },
  dead: { fill: "#8fa0b5", darkFill: "#40526a", glyph: "·", label: "no edge" },
  isolated: { fill: "#c9d3e0", darkFill: "#22344b", glyph: "◌", label: "grid edge — cannot judge" },
};

export default function Heatmap({
  results,
  best,
  onSelect,
  selected,
  mode = "sharpe",
  stability,
}: {
  results: ParamResult[];
  best: ParamResult;
  onSelect?: (r: ParamResult) => void;
  selected?: { fast: number; slow: number } | null;
  /** `stability` recolours the same grid by neighbourhood behaviour. */
  mode?: "sharpe" | "stability";
  stability?: StabilityCell[];
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<ParamResult | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const resolveTheme = () => {
      const resolved = document.documentElement.dataset.theme ?? (media.matches ? "dark" : "light");
      setIsDark(resolved === "dark");
    };
    const observer = new MutationObserver(resolveTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", resolveTheme);
    resolveTheme();
    return () => {
      observer.disconnect();
      media.removeEventListener("change", resolveTheme);
    };
  }, []);

  const fasts = [...new Set(results.map((r) => r.fast))].sort((a, b) => a - b);
  const slows = [...new Set(results.map((r) => r.slow))].sort((a, b) => a - b);
  const lookup = new Map(results.map((r) => [`${r.fast}:${r.slow}`, r]));
  const absMax = Math.max(...results.map((r) => Math.abs(r.sharpe)), 0.1);
  const kinds = new Map((stability ?? []).map((c) => [`${c.fast}:${c.slow}`, c]));
  const showKinds = mode === "stability" && kinds.size > 0;

  const padL = 44;
  const padB = 34;
  const padT = 18; // room for the "fast ↓" caption above the first row
  const padR = 8;
  const cellW = Math.max(8, (width - padL - padR) / Math.max(1, slows.length));
  const cellH = 26;
  const height = padT + fasts.length * cellH + padB;

  const active = hover ?? (selected ? lookup.get(`${selected.fast}:${selected.slow}`) ?? null : null);

  return (
    <div ref={ref}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          fontSize: 12,
          color: "var(--text-secondary)",
          flexWrap: "wrap",
        }}
      >
        <span>{showKinds ? "Neighbourhood" : "Annualised Sharpe"}</span>
        {showKinds && (
          <span className="legend" style={{ gap: 12 }}>
            {(Object.keys(KIND_STYLE) as CellKind[]).map((kind) => (
              <span key={kind} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <i
                  aria-hidden
                  style={{
                    background: isDark ? KIND_STYLE[kind].darkFill : KIND_STYLE[kind].fill,
                    borderRadius: 3,
                  }}
                />
                <span style={{ fontSize: 11 }}>
                  <span aria-hidden>{KIND_STYLE[kind].glyph} </span>
                  {kind}
                </span>
              </span>
            ))}
          </span>
        )}
        <span style={{ display: showKinds ? "none" : "flex", alignItems: "center", gap: 6 }}>
          <span className="num" style={{ fontSize: 11 }}>
            {fmt(-absMax, 1)}
          </span>
          <span
            aria-hidden
            style={{
              width: 120,
              height: 9,
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: `linear-gradient(90deg, ${divergingColor(-absMax, absMax, isDark)}, ${divergingColor(0, absMax, isDark)}, ${divergingColor(absMax, absMax, isDark)})`,
            }}
          />
          <span className="num" style={{ fontSize: 11 }}>
            +{fmt(absMax, 1)}
          </span>
        </span>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {showKinds
            ? "click a cell to inspect those parameters"
            : "grey = no edge · click a cell to inspect those parameters"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Sharpe ratio across ${results.length} parameter combinations`}
      >
        {fasts.map((f, fi) =>
          slows.map((s, si) => {
            const r = lookup.get(`${f}:${s}`);
            if (!r) return null;
            const isBest = r.fast === best.fast && r.slow === best.slow;
            const isSel = selected && r.fast === selected.fast && r.slow === selected.slow;
            return (
              <rect
                key={`${f}-${s}`}
                /* 2px surface gap between cells — separation by spacer, never a
                   drawn border around every mark. */
                x={padL + si * cellW + 1}
                y={padT + fi * cellH + 1}
                width={Math.max(1, cellW - 2)}
                height={cellH - 2}
                rx={3}
                fill={
                  showKinds
                    ? (() => {
                        const style = KIND_STYLE[kinds.get(`${f}:${s}`)?.kind ?? "isolated"];
                        return isDark ? style.darkFill : style.fill;
                      })()
                    : divergingColor(r.sharpe, absMax, isDark)
                }
                stroke={isSel || isBest ? "var(--text-primary)" : "none"}
                strokeWidth={isSel ? 2 : isBest ? 1.4 : 0}
                strokeDasharray={isBest && !isSel ? "3 2" : undefined}
                style={{ cursor: onSelect ? "pointer" : "default" }}
                tabIndex={onSelect ? 0 : undefined}
                role={onSelect ? "button" : undefined}
                aria-label={
                  showKinds
                    ? `Fast ${f}, slow ${s}, ${KIND_STYLE[kinds.get(`${f}:${s}`)?.kind ?? "isolated"].label}, Sharpe ${fmt(r.sharpe, 2)}`
                    : `Fast ${f}, slow ${s}, Sharpe ${fmt(r.sharpe, 2)}, return ${pct(r.totalReturn)}`
                }
                onPointerEnter={() => setHover(r)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(r)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect?.(r)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect?.(r);
                  }
                }}
              >
                <title>
                  {showKinds
                    ? `fast ${f} / slow ${s} — ${KIND_STYLE[kinds.get(`${f}:${s}`)?.kind ?? "isolated"].label}; Sharpe ${fmt(r.sharpe, 2)}, neighbours retain ${
                        kinds.get(`${f}:${s}`)?.retention == null
                          ? "n/a"
                          : `${Math.round((kinds.get(`${f}:${s}`)!.retention as number) * 100)}%`
                      }`
                    : `fast ${f} / slow ${s} — Sharpe ${fmt(r.sharpe, 2)}, return ${pct(r.totalReturn)}`}
                </title>
              </rect>
            );
          }),
        )}

        {fasts.map((f, fi) => (
          <text
            key={f}
            x={padL - 8}
            y={padT + fi * cellH + cellH / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10.5}
            fontFamily="var(--mono)"
            fill="var(--text-muted)"
          >
            {f}
          </text>
        ))}
        {slows.map((s, si) =>
          si % Math.ceil(slows.length / 10) === 0 || si === slows.length - 1 ? (
            <text
              key={s}
              x={padL + si * cellW + cellW / 2}
              y={padT + fasts.length * cellH + 15}
              textAnchor="middle"
              fontSize={10.5}
              fontFamily="var(--mono)"
              fill="var(--text-muted)"
            >
              {s}
            </text>
          ) : null,
        )}
        <text x={padL} y={height - 3} fontSize={10.5} fill="var(--text-muted)">
          slow period →
        </text>
        <text x={0} y={11} fontSize={10.5} fill="var(--text-muted)">
          fast period ↓
        </text>
      </svg>

      <div
        style={{
          minHeight: 34,
          marginTop: 8,
          fontSize: 12.5,
          fontFamily: "var(--mono)",
          color: active ? "var(--text-primary)" : "var(--text-muted)",
        }}
      >
        {active ? (
          <>
            <strong>
              {active.fast}/{active.slow}
            </strong>{" "}
            · Sharpe {fmt(active.sharpe, 2)} · return {pct(active.totalReturn)} · maxDD{" "}
            {pct(active.maxDrawdown)} · {active.trades} trades
            {active.fast === best.fast && active.slow === best.slow ? " · ← grid winner" : ""}
          </>
        ) : (
          "Hover a cell for its metrics."
        )}
      </div>
    </div>
  );
}
