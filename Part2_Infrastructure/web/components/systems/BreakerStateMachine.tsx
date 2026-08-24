"use client";

/**
 * The circuit breaker as it is actually implemented, with live counts on it.
 *
 * READ THE CODE BEFORE DRAWING THE DIAGRAM. The textbook breaker has four
 * edges and this one has three plus an operator override, because the missing
 * edge is a deliberate design choice in `lib/providers/runtime.ts`:
 *
 *     "Clearing the state rather than tracking a separate half-open flag means
 *      a probe failure re-counts from one — slower to re-open, but it cannot
 *      get stuck open."
 *
 * So there is NO `half_open → open` transition. A failed probe does not slam
 * the circuit back open; it starts a fresh count toward a fresh trip. Drawing
 * the canonical arrow would be inventing a behaviour the system does not have —
 * which is exactly the fabrication that got the old signal-path viewer deleted.
 * The absence is the most interesting thing here, so it is stated rather than
 * left as a gap.
 *
 * NO CONSTANTS IMPORTED FROM THE RUNTIME. That module owns the in-memory store
 * and the emitter and is server-side; the threshold is already on the wire per
 * provider, so it is read from there. The total cooldown is not published, but
 * `openedAt` and `cooldownRemainingMs` both are, and their sum reconstructs it
 * exactly — both are server timestamps, so the arithmetic never touches the
 * browser clock.
 *
 * WHY THIS DRAWING HAS NO viewBox, AND WHY EVERY x IS A PERCENTAGE.
 *
 * It was a 560×208 viewBox scaled to the card and then capped at 660px and
 * centred, which on a desk-width card left the outer two thirds empty and —
 * worse — clipped the half-open caption against the viewport edge: "observed
 * only between cooldown and the", and then nothing. A drawing that truncates
 * its own explanation is losing information, not merely wasting space.
 *
 * Letting that viewBox scale to the full width fixes the margins and breaks
 * everything else: on a 1900px card the same drawing is 706px tall and its
 * 10-unit labels land at 34px, which is a poster, not a diagram. Rejected in
 * order: `preserveAspectRatio="none"` (stretches the type), a wider viewBox
 * (the same magnification, arriving later), and a breakpoint that swaps
 * geometry (attributes are not reachable from a media query, so it means two
 * copies of the markup and a dead-css bill on a sheet with zero headroom).
 *
 * So the viewBox is gone: one user unit is one CSS pixel, the width is 100% of
 * whatever the card gives, and the height is a constant. Horizontal geometry
 * is written in percentages, which SVG resolves against the VIEWPORT rather
 * than against a scaled coordinate system — so the machine spreads to fill a
 * 1900px card and closes up to fill a 700px one, and every label stays exactly
 * the size it was drawn at either way. The node anchors are 15/50/85 per cent
 * and the return edge runs round the outside at 3 and 97 per cent, which is
 * what actually reaches the white space the outer thirds used to be.
 *
 * Captions wrap instead of truncating (`wrap()` below). The type here is chart
 * furniture and does not move with the Text size preference: 10 user units is
 * 10px, the fixed rung --fs-tick names, because every y in this file is an
 * absolute number and a caption that grew a fifth at the Large preset would
 * land on the return edge.
 */

import type { ProviderRow } from "@/components/systems/types";

/** Node boxes: 18% wide on 15/50/85 anchors, so the gap an edge and its label
 *  live in is 17% of the card — 82px at the 480px floor the stylesheet pins,
 *  which is the widest edge label ("consecutive failures") plus a hair. */
const BOX_W = "18%";
const BOX_Y = 74;
const BOX_H = 52;
/** The box's own middle: every horizontal edge and both arrowheads sit on it. */
const MID = BOX_Y + BOX_H / 2;
const CAP_Y = 144;
const CAP_STEP = 13;
/** The return edge's horizontal run, below the deepest caption line (170). */
const RAIL_Y = 196;
/** Characters per caption line. An outer node has 15% of the card to the side
 *  of its anchor; 26 characters is ~127px, and half of that clears 15% of the
 *  480px minimum width. Larger wraps the long caption to one line on a wide
 *  desk but clips it on a laptop, which is the defect this replaced. */
const WRAP = 26;

const NODES = [
  { id: "closed", label: "CLOSED", cx: "15%", boxX: "6%", sub: "calls flow" },
  { id: "open", label: "OPEN", cx: "50%", boxX: "41%", sub: "provider skipped" },
  { id: "half_open", label: "HALF-OPEN", cx: "85%", boxX: "76%", sub: "next call probes" },
] as const;

/** Greedy word wrap, because SVG text does not wrap and the alternative on the
 *  table — `foreignObject` — inherits the page's fluid rungs, which would
 *  reflow the drawing at the Large text preset. A `<tspan dy>` stack was
 *  rejected too: percentage `x` on a tspan is not reliably honoured, and every
 *  x in this drawing is a percentage. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** One straight run of an edge. `<line>` rather than one `<path>`: a path's `d`
 *  takes no percentages, and every horizontal coordinate here is one. */
function Edge({ x1, y1, x2, y2, dashed }: {
  x1: string; y1: number; x2: string; y2: number; dashed?: boolean;
}) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--axis)" strokeWidth={1}
      strokeDasharray={dashed ? "4 3" : undefined} />
  );
}

/** Chevron as a stroked path — `<marker>` fills do not follow `currentColor`,
 *  and the one permitted forced-colors rule only reaches `path[stroke]`.
 *  The path hangs in a 1×1 nested `<svg>` so it can be anchored at a
 *  percentage: `transform="translate()"` takes no percentages either. The
 *  nested viewport is escaped in CSS rather than by this `overflow` attribute
 *  alone, because the UA stylesheet's `svg:not(:root) { overflow: hidden }`
 *  outranks a presentation attribute — see 14h-density-systems.css. */
function Arrow({ x, y, dir = "right" }: { x: string; y: number; dir?: "right" | "left" | "up" }) {
  const d = dir === "right" ? "M-6 -4 L0 0 L-6 4"
    : dir === "left" ? "M6 -4 L0 0 L6 4"
      : "M-4 6 L0 0 L4 6";
  return (
    <svg x={x} y={y} width={1} height={1} overflow="visible">
      <path d={d} stroke="var(--axis)" strokeWidth={1.2} fill="none" />
    </svg>
  );
}

function secs(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${Math.max(0, Math.round(ms))}ms`;
}

export default function BreakerStateMachine({
  providers,
  observedAt,
}: {
  providers: ProviderRow[] | null;
  /** The snapshot's own timestamp, so cooldown maths stays server-side. */
  observedAt: string | null;
}) {
  const rows = providers ?? [];
  const counts = {
    closed: rows.filter((p) => p.breaker?.state === "closed").length,
    open: rows.filter((p) => p.breaker?.state === "open").length,
    half_open: rows.filter((p) => p.breaker?.state === "half_open").length,
  };
  const threshold = rows.find((p) => p.breaker?.threshold)?.breaker?.threshold ?? null;
  const worst = rows
    .filter((p) => p.breaker?.state === "closed" && (p.breaker?.failures ?? 0) > 0)
    .sort((a, b) => (b.breaker?.failures ?? 0) - (a.breaker?.failures ?? 0))[0];

  const snapshotAt = observedAt ? Date.parse(observedAt) : NaN;
  const cooling = rows
    .filter((p) => p.breaker?.state === "open" && p.breaker?.openedAt != null)
    .map((p) => {
      const remaining = p.breaker!.cooldownRemainingMs;
      const elapsed = Number.isFinite(snapshotAt) ? snapshotAt - p.breaker!.openedAt! : NaN;
      const total = Number.isFinite(elapsed) ? elapsed + remaining : NaN;
      return { id: p.id, label: p.label ?? p.id, remaining, total };
    });

  const nodeCount = (id: string) => counts[id as keyof typeof counts];
  const detail = (id: string) =>
    id === "closed"
      ? worst && threshold ? `worst ${worst.breaker!.failures}/${threshold}` : "no failures counted"
      : id === "open"
        ? cooling.length ? `next probe in ${secs(Math.min(...cooling.map((c) => c.remaining)))}` : "none held out"
        : "observed only between cooldown and the next call";

  return (
    <section className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">How recovery works here</span>
          <h2>Circuit breaker states</h2>
        </div>
        <span className="section-note">
          {providers === null ? "registry not observed" : `${rows.length} providers`}
        </span>
      </div>

      <svg
        className="breaker-machine"
        width="100%"
        height={240}
        role="img"
        aria-label={
          `Circuit breaker state machine. ${counts.closed} providers closed, `
          + `${counts.open} open, ${counts.half_open} half-open. `
          + "A failed probe does not reopen the circuit; it restarts the failure count."
        }
      >
        {/* operator reset — dashed, because a human action is not the machine
            running its own course. */}
        <Edge x1="50%" y1={BOX_Y} x2="50%" y2={30} dashed />
        <Edge x1="50%" y1={30} x2="15%" y2={30} dashed />
        <Edge x1="15%" y1={30} x2="15%" y2={68} dashed />
        <Arrow x="15%" y={68} dir="up" />
        <text x="32.5%" y={22} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
          operator reset — “Close all circuits”
        </text>

        {NODES.map((node) => {
          const active = nodeCount(node.id) > 0;
          const tone = node.id === "open" ? "var(--status-critical)"
            : node.id === "half_open" ? "var(--status-warning)" : "var(--status-good)";
          /* The live state is carried by the border WEIGHT as well as its
             colour — 1.6 against 1 — and by the count itself, which is the
             pair High Contrast keeps when the palette collapses. */
          const caption = [
            ...wrap(node.sub, WRAP).map((line) => ({ line, mono: false })),
            ...wrap(detail(node.id), WRAP).map((line) => ({ line, mono: true })),
          ];
          return (
            <g key={node.id}>
              <rect x={node.boxX} y={BOX_Y} width={BOX_W} height={BOX_H} rx={8}
                fill="var(--surface-2)" stroke={active ? tone : "var(--border)"}
                strokeWidth={active ? 1.6 : 1} />
              <text x={node.cx} y={BOX_Y + 22} textAnchor="middle" fontSize={13}
                fontWeight={750} fill="var(--text-primary)" fontFamily="var(--mono)">
                {node.label}
              </text>
              <text x={node.cx} y={BOX_Y + 42} textAnchor="middle" fontSize={15}
                fontWeight={700} fill={active ? tone : "var(--text-muted)"}>
                {nodeCount(node.id)}
              </text>
              {caption.map((row, index) => (
                <text key={`${index} ${row.line}`} x={node.cx} y={CAP_Y + index * CAP_STEP}
                  textAnchor="middle" fontSize={10} fill="var(--text-muted)"
                  fontFamily={row.mono ? "var(--mono)" : undefined}>
                  {row.line}
                </text>
              ))}
            </g>
          );
        })}

        {/* closed → open */}
        <Edge x1="24%" y1={MID} x2="41%" y2={MID} />
        <Arrow x="41%" y={MID} />
        <text x="32.5%" y={MID - 8} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
          {threshold ? `${threshold} in a row` : "consecutive failures"}
        </text>

        {/* open → half-open */}
        <Edge x1="59%" y1={MID} x2="76%" y2={MID} />
        <Arrow x="76%" y={MID} />
        <text x="67.5%" y={MID - 8} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
          cooldown ends
        </text>

        {/* half-open → closed, routed round the OUTSIDE of both node rows: an
            inner return would cross the captions it is supposed to leave
            legible, and the outer track is the width this card was wasting. */}
        <Edge x1="94%" y1={MID} x2="97%" y2={MID} />
        <Edge x1="97%" y1={MID} x2="97%" y2={RAIL_Y} />
        <Edge x1="97%" y1={RAIL_Y} x2="3%" y2={RAIL_Y} />
        <Edge x1="3%" y1={RAIL_Y} x2="3%" y2={MID} />
        <Edge x1="3%" y1={MID} x2="6%" y2={MID} />
        <Arrow x="6%" y={MID} />
        <text x="50%" y={RAIL_Y + 14} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
          probe succeeds
        </text>

        {/* The edge that is NOT here, said out loud. */}
        <text x="50%" y={RAIL_Y + 32} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
          no half-open → open edge: a failed probe restarts the count from one
        </text>
      </svg>

      {cooling.length > 0 && (
        <div className="breaker-cooldowns">
          {cooling.map((circuit) => {
            const fraction = Number.isFinite(circuit.total) && circuit.total > 0
              ? Math.min(1, Math.max(0, 1 - circuit.remaining / circuit.total))
              : null;
            const R = 15;
            const C = 2 * Math.PI * R;
            return (
              <div key={circuit.id} className="breaker-cooldowns__item">
                <svg viewBox="0 0 40 40" width={40} height={40} role="img"
                  aria-label={`${circuit.label} probes again in ${secs(circuit.remaining)}`}>
                  <circle cx={20} cy={20} r={R} fill="none" stroke="var(--grid)" strokeWidth={5} />
                  {/* Withheld rather than guessed: without `openedAt` the total
                      cooldown is unknown, and a ring with an invented
                      denominator is worse than no ring. */}
                  {fraction != null && (
                    <circle cx={20} cy={20} r={R} fill="none" stroke="var(--status-warning)"
                      strokeWidth={5} strokeLinecap="round"
                      strokeDasharray={`${C * fraction} ${C}`}
                      transform="rotate(-90 20 20)" />
                  )}
                </svg>
                <div>
                  <strong>{circuit.label}</strong>
                  <small className="muted">
                    {fraction != null
                      ? `probes again in ${secs(circuit.remaining)}`
                      : `probes again in ${secs(circuit.remaining)}; elapsed unknown`}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Two different findings, told apart. `providers === null` is no snapshot;
          an empty array is a deployment that registers no provider at all, and
          reporting both as "not observed" told a reader to go looking for a
          transport fault that is not there. */}
      {providers === null && (
        <p className="muted">
          The provider registry has not been observed, so no circuit state can be counted — a
          missing reading, not a healthy desk.
        </p>
      )}
      {providers !== null && rows.length === 0 && (
        <p className="muted">
          No provider is registered in this deployment, so there is no circuit to trip — an empty
          registry, not a missing reading.
        </p>
      )}

      <details className="disclosure">
        <summary>What a closure proves, and why half-open reads zero</summary>
        <p className="research-note">
          <strong>Half-open is a moment, not a resting state.</strong> The dispatch gate retires an
          elapsed cooldown on the next call to the provider, so a permanent zero there is
          correct.
        </p>
        <p className="research-note">
          <strong>A closure is not a fix.</strong> One successful probe closes a circuit that may
          re-open three failures later.
        </p>
        <p className="research-note">
          Counts are per function instance and reset on redeploy. The threshold is read from each
          provider&rsquo;s own snapshot, never a compiled-in constant.
        </p>
      </details>
    </section>
  );
}
