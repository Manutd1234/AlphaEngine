"use client";

/**
 * Sharpe surface over the parameter grid.
 *
 * Sharpe is signed around a meaningful zero, so this is a *diverging* scale:
 * blue ↔ neutral grey ↔ red, with grey meaning "no edge". (A red-yellow-green
 * ramp would put a hue at the midpoint, so zero reads as a value rather than as
 * nothing — and yellow/green is the pair colour-blind readers lose first.
 * Viridis is rejected for the same reason: sequential ramps have no neutral
 * anchor.) Interpolation happens in OKLab (`lib/colormap`), so the surface
 * reads as one continuous field instead of muddy sRGB midtones.
 *
 * Cells are contiguous in Sharpe mode — a continuous surface for a continuous
 * quantity — but every cell is still a real backtest: nothing is interpolated
 * across parameter pairs that were never tested, which is why the grid keeps
 * its discrete hit targets, keyboard access and per-cell labels.
 *
 * The shape is the message: a broad plateau means the edge survives small
 * parameter changes; a lone bright cell surrounded by grey is an overfit, and
 * seeing that is worth more than any single number.
 */

import { CellKind, ParamResult, StabilityCell } from "@/lib/types";
import { SHARPE_RAMP_DARK, SHARPE_RAMP_LIGHT, divergingScale } from "@/lib/colormap";
import { fmt, pct } from "@/lib/format";
import { useMeasuredWidth } from "./chart-kit";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

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
  dead: { fill: "#9a9aa1", darkFill: "#3f3f46", glyph: "·", label: "no edge" },
  isolated: { fill: "#d4d4d8", darkFill: "#26262b", glyph: "◌", label: "grid edge — cannot judge" },
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
  const [focusedCell, setFocusedCell] = useState<string | null>(() =>
    selected ? `${selected.fast}:${selected.slow}` : `${best.fast}:${best.slow}`,
  );
  const cellRefs = useRef(new Map<string, SVGRectElement>());

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
  const selectedKey = selected ? `${selected.fast}:${selected.slow}` : null;
  const bestKey = `${best.fast}:${best.slow}`;
  const rovingKey = focusedCell && lookup.has(focusedCell)
    ? focusedCell
    : selectedKey && lookup.has(selectedKey)
      ? selectedKey
      : lookup.has(bestKey)
        ? bestKey
        : `${results[0]?.fast}:${results[0]?.slow}`;

  const focusAt = (fastIndex: number, slowIndex: number): boolean => {
    const key = `${fasts[fastIndex]}:${slows[slowIndex]}`;
    if (!lookup.has(key)) return false;
    setFocusedCell(key);
    cellRefs.current.get(key)?.focus();
    return true;
  };

  const steerCell = (event: KeyboardEvent<SVGRectElement>, fastIndex: number, slowIndex: number) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();

    if (event.key === "Home" || event.key === "End") {
      const start = event.key === "Home" ? 0 : slows.length - 1;
      const step = event.key === "Home" ? 1 : -1;
      for (let nextSlow = start; nextSlow >= 0 && nextSlow < slows.length; nextSlow += step) {
        if (focusAt(fastIndex, nextSlow)) return;
      }
      return;
    }

    const fastStep = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const slowStep = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    let nextFast = fastIndex + fastStep;
    let nextSlow = slowIndex + slowStep;
    while (nextFast >= 0 && nextFast < fasts.length && nextSlow >= 0 && nextSlow < slows.length) {
      if (focusAt(nextFast, nextSlow)) return;
      nextFast += fastStep;
      nextSlow += slowStep;
    }
  };

  const ramp = isDark ? SHARPE_RAMP_DARK : SHARPE_RAMP_LIGHT;
  const sharpeColor = divergingScale(absMax, ramp);
  // Legend gradients sampled from the same eased scale the cells use, split at
  // zero so the neutral anchor is an explicit tick, not an implied midpoint.
  const unitScale = divergingScale(1, ramp);
  const negStops = Array.from({ length: 5 }, (_, i) => unitScale(-1 + i / 4)).join(", ");
  const posStops = Array.from({ length: 5 }, (_, i) => unitScale(i / 4)).join(", ");

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
          fontSize: "var(--fs-md)",
          color: "var(--text-secondary)",
          flexWrap: "wrap",
        }}
      >
        <span>{showKinds ? "Neighbourhood" : "Annualised Sharpe"}</span>
        {showKinds && (
          <span className="legend heatmap-legend__kinds" style={{ gap: 12 }}>
            {(Object.keys(KIND_STYLE) as CellKind[]).map((kind) => (
              <span key={kind} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <i
                  aria-hidden
                  style={{
                    background: isDark ? KIND_STYLE[kind].darkFill : KIND_STYLE[kind].fill,
                    borderRadius: 3,
                  }}
                />
                <span style={{ fontSize: "var(--fs-sm)" }}>
                  <span aria-hidden>{KIND_STYLE[kind].glyph} </span>
                  {kind}
                </span>
              </span>
            ))}
          </span>
        )}
        <span style={{ display: showKinds ? "none" : "flex", alignItems: "center", gap: 5 }}>
          <span className="num" style={{ fontSize: "var(--fs-sm)" }}>
            {fmt(-absMax, 1)}
          </span>
          <span
            aria-hidden
            style={{
              width: 62,
              height: 9,
              borderRadius: "5px 0 0 5px",
              border: "1px solid var(--border)",
              borderRight: "none",
              background: `linear-gradient(90deg, ${negStops})`,
            }}
          />
          <span className="num" style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
            0
          </span>
          <span
            aria-hidden
            style={{
              width: 62,
              height: 9,
              borderRadius: "0 5px 5px 0",
              border: "1px solid var(--border)",
              borderLeft: "none",
              background: `linear-gradient(90deg, ${posStops})`,
            }}
          />
          <span className="num" style={{ fontSize: "var(--fs-sm)" }}>
            +{fmt(absMax, 1)}
          </span>
        </span>
        <span className="muted heatmap-legend__hint" style={{ fontSize: "var(--fs-body)" }}>
          {showKinds
            ? "click a cell to inspect those parameters"
            : "grey = no edge; click a cell to inspect those parameters"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role={onSelect ? "group" : "img"}
        aria-label={`Sharpe ratio across ${results.length} parameter combinations`}
      >
        {/* The wavefront restates the panel's actual message — this grid was
            SEARCHED, cell by cell, along the diagonal. Keyed by the sweep's
            identity (grid size + winner), so hover, selection and resize
            replay nothing. */}
        <g key={`${results.length}:${best.fast}/${best.slow}:${best.sharpe}`}>
        {fasts.map((f, fi) =>
          slows.map((s, si) => {
            const r = lookup.get(`${f}:${s}`);
            if (!r) return null;
            const isBest = r.fast === best.fast && r.slow === best.slow;
            const isSel = selected && r.fast === selected.fast && r.slow === selected.slow;
            /* Stability keeps its 2px surface gap — five categories need
               separation. The Sharpe surface is contiguous: a continuous field
               for a continuous quantity. */
            const gap = showKinds ? 1 : 0;
            return (
              <rect
                key={`${f}-${s}`}
                ref={(node) => {
                  const key = `${f}:${s}`;
                  if (node) cellRefs.current.set(key, node);
                  else cellRefs.current.delete(key);
                }}
                className="heatmap-cell"
                x={padL + si * cellW + gap}
                y={padT + fi * cellH + gap}
                width={Math.max(1, cellW - gap * 2)}
                height={cellH - gap * 2}
                rx={showKinds ? 3 : 0}
                fill={
                  showKinds
                    ? (() => {
                        const style = KIND_STYLE[kinds.get(`${f}:${s}`)?.kind ?? "isolated"];
                        return isDark ? style.darkFill : style.fill;
                      })()
                    : sharpeColor(r.sharpe)
                }
                stroke={isSel || isBest ? "var(--text-primary)" : "none"}
                strokeWidth={isSel ? 2 : isBest ? 1.4 : 0}
                strokeDasharray={isBest && !isSel ? "3 2" : undefined}
                style={{
                  cursor: onSelect ? "pointer" : "default",
                  /* Diagonal wavefront: (row+col) × 12ms, capped at 360ms so
                     a large grid finishes before the reader stops waiting. */
                  "--wave-delay": `${Math.min((fi + si) * 12, 360)}ms`,
                } as React.CSSProperties}
                tabIndex={onSelect ? (`${f}:${s}` === rovingKey ? 0 : -1) : undefined}
                role={onSelect ? "button" : undefined}
                aria-label={
                  showKinds
                    ? `Fast ${f}, slow ${s}, ${KIND_STYLE[kinds.get(`${f}:${s}`)?.kind ?? "isolated"].label}, Sharpe ${fmt(r.sharpe, 2)}`
                    : `Fast ${f}, slow ${s}, Sharpe ${fmt(r.sharpe, 2)}, return ${pct(r.totalReturn)}`
                }
                onPointerEnter={() => setHover(r)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => {
                  setFocusedCell(`${f}:${s}`);
                  setHover(r);
                }}
                onBlur={() => setHover(null)}
                onClick={() => onSelect?.(r)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect?.(r);
                    return;
                  }
                  steerCell(event, fi, si);
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
        </g>

        {fasts.map((f, fi) => (
          <text
            key={f}
            x={padL - 8}
            y={padT + fi * cellH + cellH / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={12.5}
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
              fontSize={12.5}
              fontFamily="var(--mono)"
              fill="var(--text-muted)"
            >
              {s}
            </text>
          ) : null,
        )}
        <text x={padL} y={height - 3} fontSize={12.5} fill="var(--text-muted)">
          slow period →
        </text>
        <text x={0} y={11} fontSize={12.5} fill="var(--text-muted)">
          fast period ↓
        </text>
      </svg>

      <div
        style={{
          minHeight: 34,
          marginTop: 8,
          fontSize: "var(--fs-lg)",
          fontFamily: "var(--mono)",
          color: active ? "var(--text-primary)" : "var(--text-muted)",
        }}
      >
        {active ? (
          <>
            <strong>
              {active.fast}/{active.slow}
            </strong>{" "}
            — Sharpe {fmt(active.sharpe, 2)}, return {pct(active.totalReturn)}, max DD{" "}
            {pct(active.maxDrawdown)}, {active.trades} trades
            {active.fast === best.fast && active.slow === best.slow ? "; ← grid winner" : ""}
          </>
        ) : (
          "Hover a cell for its metrics."
        )}
      </div>
    </div>
  );
}
