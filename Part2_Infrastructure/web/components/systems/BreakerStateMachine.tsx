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
 */

import type { ProviderRow } from "@/components/systems/types";

const NODE_W = 132;
const NODE_H = 46;
const NODES = [
  { id: "closed", label: "CLOSED", x: 16, sub: "calls flow" },
  { id: "open", label: "OPEN", x: 214, sub: "provider skipped" },
  { id: "half_open", label: "HALF-OPEN", x: 412, sub: "next call probes" },
] as const;

/** Chevron as a stroked path — `<marker>` fills do not follow `currentColor`,
 *  and the one permitted forced-colors rule only reaches `path[stroke]`. */
function Arrow({ x, y, dir = "right" }: { x: number; y: number; dir?: "right" | "left" | "up" }) {
  const d = dir === "right" ? `M${x - 6} ${y - 4} L${x} ${y} L${x - 6} ${y + 4}`
    : dir === "left" ? `M${x + 6} ${y - 4} L${x} ${y} L${x + 6} ${y + 4}`
      : `M${x - 4} ${y + 6} L${x} ${y} L${x + 4} ${y + 6}`;
  return <path d={d} stroke="var(--axis)" strokeWidth={1.2} fill="none" />;
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
        <span className="section-note">{rows.length} providers</span>
      </div>

      <svg
        className="breaker-machine"
        viewBox="0 0 560 208"
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={
          `Circuit breaker state machine. ${counts.closed} providers closed, `
          + `${counts.open} open, ${counts.half_open} half-open. `
          + "A failed probe does not reopen the circuit; it restarts the failure count."
        }
      >
        {/* operator reset — dashed, because a human action is not the machine
            running its own course. */}
        <path d="M280 62 L280 26 L82 26 L82 58" stroke="var(--axis)" strokeWidth={1}
          strokeDasharray="4 3" fill="none" />
        <Arrow x={82} y={58} dir="up" />
        <text x={181} y={20} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
          operator reset — “Close all circuits”
        </text>

        {NODES.map((node) => {
          const active = nodeCount(node.id) > 0;
          const tone = node.id === "open" ? "var(--status-critical)"
            : node.id === "half_open" ? "var(--status-warning)" : "var(--status-good)";
          return (
            <g key={node.id}>
              <rect x={node.x} y={62} width={NODE_W} height={NODE_H} rx={8}
                fill="var(--surface-2)" stroke={active ? tone : "var(--border)"}
                strokeWidth={active ? 1.6 : 1} />
              <text x={node.x + NODE_W / 2} y={80} textAnchor="middle" fontSize={11.5}
                fontWeight={750} fill="var(--text-primary)" fontFamily="var(--mono)">
                {node.label}
              </text>
              <text x={node.x + NODE_W / 2} y={95} textAnchor="middle" fontSize={14}
                fontWeight={700} fill={active ? tone : "var(--text-muted)"}>
                {nodeCount(node.id)}
              </text>
              <text x={node.x + NODE_W / 2} y={122} textAnchor="middle" fontSize={10}
                fill="var(--text-muted)">
                {node.sub}
              </text>
              <text x={node.x + NODE_W / 2} y={134} textAnchor="middle" fontSize={10}
                fill="var(--text-muted)" fontFamily="var(--mono)">
                {detail(node.id)}
              </text>
            </g>
          );
        })}

        {/* closed → open */}
        <line x1={148} y1={85} x2={208} y2={85} stroke="var(--axis)" strokeWidth={1} />
        <Arrow x={214} y={85} />
        <text x={178} y={78} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
          {threshold ? `${threshold} in a row` : "consecutive failures"}
        </text>

        {/* open → half-open */}
        <line x1={346} y1={85} x2={406} y2={85} stroke="var(--axis)" strokeWidth={1} />
        <Arrow x={412} y={85} />
        <text x={376} y={78} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
          cooldown ends
        </text>

        {/* half-open → closed */}
        <path d="M478 108 L478 156 L82 156 L82 112" stroke="var(--axis)" strokeWidth={1} fill="none" />
        <Arrow x={82} y={110} dir="up" />
        <text x={280} y={169} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
          probe succeeds
        </text>

        {/* The edge that is NOT here, said out loud. */}
        <text x={280} y={195} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
          there is no half-open → open edge: a failed probe restarts the count from one
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

      {!rows.length && (
        <p className="muted">
          The provider registry has not been observed, so no circuit state can be counted. That is a
          missing reading rather than a healthy desk.
        </p>
      )}

      <details className="disclosure">
        <summary>Why a closure is not a fix, and why half-open almost always reads zero</summary>
        <p className="research-note">
          <strong>Half-open is a moment, not a resting state.</strong> The dispatch gate retires an
          elapsed cooldown the instant any call touches that provider, so the state is only visible
          between the cooldown ending and the next request arriving. A permanent zero there is
          correct.
        </p>
        <p className="research-note">
          <strong>A closure is not a fix.</strong> One successful probe closes a circuit that may
          re-open three failures later. Closing a circuit asks the provider again; it does not
          declare it healthy.
        </p>
        <p className="research-note">
          Counts are per function instance and reset on redeploy. The failure threshold is read from
          each provider&rsquo;s own snapshot rather than from a constant compiled into this page, so
          it cannot drift from the value the gateway is actually enforcing.
        </p>
      </details>
    </section>
  );
}
