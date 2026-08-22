"use client";

/**
 * SRE's tab: is the platform up, and if not, which layer broke?
 *
 * The role's blueprint asks to locate a failure in compute, network, provider,
 * cache or broker connectivity without opening several dashboards, so the
 * workflow answers that question in layers — Attention surfaces symptoms, the
 * Services matrix says which provider or breaker is involved, Logs says when
 * it started, and Remediation is where a guarded response or drill is performed.
 *
 * Reads are free and always available; writes are gated and every control states
 * its cost. Provider-routing telemetry and the trading gateway are separate
 * observation planes; this UI keeps their source and scope explicit.
 */

import { useRef, useState } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import HealthMatrix from "@/components/systems/HealthMatrix";
import BreakerStateMachine from "@/components/systems/BreakerStateMachine";
import OperatorPanel, { OperatorActionResult, SessionControls } from "@/components/systems/OperatorPanel";
import ReliabilityOverview, { type ReliabilityDrilldown } from "@/components/systems/ReliabilityOverview";
import RemediationLedger from "@/components/systems/RemediationLedger";
import TraceConsole from "@/components/systems/TraceConsole";
import { ConsoleChrome, type ConsoleTile } from "@/components/systems/ConsoleChrome";
import { POSTURE_LABEL, postureTone } from "@/components/systems/reliability-posture";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { formatDuration } from "@/lib/format";
import {
  DECISION_ENGINE_LABEL,
  DECISION_MIN_SAMPLES,
  decisionTone,
  LATENCY_MIN_SAMPLES,
  latencyTone,
} from "@/lib/overview-state";
import { deriveReliabilityPosture } from "@/lib/reliability";
import { RELIABILITY_SECTIONS, type ReliabilitySection } from "@/lib/sections";
import type { SystemHealthView } from "@/lib/use-system-health";

export { RELIABILITY_SECTION_IDS, type ReliabilitySection } from "@/lib/sections";

export interface ReliabilityConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  onOpenData: () => void;
  section: ReliabilitySection;
  onSectionChange: (section: ReliabilitySection) => void;
  /** False while this workspace is mounted but hidden behind another tab. */
  active?: boolean;
}

/**
 * Remediation was three stacked cards in one scroll — a reader arriving
 * mid-incident had to scroll past two reference surfaces to reach the only one
 * with buttons on it. Now five panes with separate sources, so each degrades on
 * its own: the guarded writes read `guard` and the registry, Scope reads the
 * registry alone, the session controls read only this tab, the state machine
 * reads `health.providers[].breaker`, and the ledger fetches this instance's
 * event ring. Session split from the writes along the old controls card's
 * blast-radius seam: server mutations behind the guard, browser-only beside it.
 *
 * The fifth pane came from a reader's own words: the server mutations were
 * sharing a pane with the ring and counts above them, and that block is a
 * REFERENCE surface — it answers what a write would reach, asked before
 * deciding rather than while pressing. So the writes kept the pane a reader
 * lands on and the reference took the new one. `OperatorPanel` renders both
 * from one `part` prop, and argues there why the guard went with the buttons.
 *
 * Deliberately NOT a nested `<WorkspaceSubtabs>`: that publishes `--rail-h`
 * from a ResizeObserver and its own comment asserts exactly one rail is mounted
 * at a time, so a second instance would fight the first over every sticky
 * offset in the app. The house in-panel pattern is `.seg role="group"`, as
 * Dependencies and the blotter use.
 */
type RemediationPane = "mutations" | "scope" | "session" | "recovery" | "history";

/** Mutations leads and is the default: the pane a reader lands on in an
 *  incident, and the only one that can change server state; the rest are worth
 *  one click rather than a page of scrolling above the controls. */
const REMEDIATION_PANES: Array<{ id: RemediationPane; label: string; hint: string }> = [
  { id: "mutations", label: "Mutations", hint: "The five server writes, what each costs and what it clears" },
  { id: "scope", label: "Scope", hint: "What a write would reach in this instance right now" },
  { id: "session", label: "Session", hint: "This tab's own sockets and poll cadence" },
  { id: "recovery", label: "Recovery", hint: "How a tripped circuit comes back, and cooldown left" },
  { id: "history", label: "History", hint: "Which circuits tripped here, and how each closed" },
];

export default function ReliabilityConsole({
  view,
  workspaceSymbol,
  onOpenData,
  section,
  onSectionChange,
  active = true,
}: ReliabilityConsoleProps) {
  const [traceFilterRequest, setTraceFilterRequest] = useState<{
    id: number;
    query: string;
    label: string;
  } | null>(null);
  const traceFilterSequence = useRef(0);
  const [remediationPane, setRemediationPane] = useState<RemediationPane>("mutations");
  const {
    health,
    guard,
    tokenEnv,
    token,
    setToken,
    operatorReady,
    busyAction,
    actionResult,
    runAction,
    sockets,
    onReconnectSockets,
    pollMs,
    setPaused,
    setPollMs,
    effectivePollMs,
  } = view;

  // The vendor + venue REST tail, split from the web→gateway hop by
  // latencyByClass; falls back to the blended pool for a snapshot that predates
  // the split. The hop rides in the tile's note beside it.
  const latency = health?.summary.upstreamLatency ?? health?.summary.latency;
  const hop = health?.summary.gatewayHopLatency;
  const posture = health ? deriveReliabilityPosture(health) : null;

  const overallState = view.healthError
    ? "Unreachable"
    : !posture
      ? "Checking"
      : POSTURE_LABEL[posture.overall];

  /**
   * Focus follows the switch, or a keyboard reader is left on a control that no
   * longer describes what is on screen. The two deep links that target an
   * element inside a section — the header's latency chip and system-health
   * button — are wired in `app/dashboard/page.tsx`; the header is global.
   */
  const openDrilldown = (next: ReliabilityDrilldown) => {
    onSectionChange(next);
    window.requestAnimationFrame(() => {
      document.getElementById(`reliability-subtab-${next}`)?.focus();
    });
  };

  const latencyState = latencyTone(latency?.p99 ?? null, latency?.n ?? 0, latency?.errorRate ?? 0);
  const hasReliableP99 = Boolean(
    latency?.p99 != null && (latency?.n ?? 0) >= LATENCY_MIN_SAMPLES,
  );

  const decision = view.decisionLatency;
  const decisionTone_ = decision.kind === "measured"
    ? decisionTone(decision.stats.p99_us, decision.stats.samples)
    : { tone: "muted" as const, label: "" };
  const decisionTileTone: "good" | "warn" | "bad" | "neutral" =
    decisionTone_.tone === "bad" ? "bad" : decisionTone_.tone === "warn" ? "warn" : "neutral";
  const decisionNote = (() => {
    if (decision.kind === "no-orders" && decision.core) {
      // The core has timed itself at startup; the µs plane is still empty.
      return `core p99 ${formatDuration(decision.core.p99Ns, "ns")} from the startup self-measure; no orders yet`;
    }
    if (decision.kind !== "measured") return decision.detail;
    const s = decision.stats;
    if (s.samples < DECISION_MIN_SAMPLES) return `${s.samples} of ${DECISION_MIN_SAMPLES} decisions; not a failure`;
    const core = s.core_p99_ns != null ? `core p99 ${formatDuration(s.core_p99_ns, "ns")}; ` : "";
    return `${core}${DECISION_ENGINE_LABEL[s.engine]}, n=${s.samples.toLocaleString("en-US")}, in-process, pushed`;
  })();

  /**
   * Numbers, not links. Two of these tiles carried their own "View every
   * provider" and "Explain p99" actions, and the global header already wires
   * its latency chip and system-health button to the same section and the same
   * anchor — `openReliabilitySection("services", "reliability-provider-health")`
   * and `("services", "reliability-latency-guide")` in `app/dashboard/page.tsx`.
   * The header travels with the reader across every workspace, so the tile
   * copies were a second route to one destination, visible only once you were
   * already on this tab.
   */
  const tiles: ConsoleTile[] = [
    {
      label: "Overall state",
      value: overallState,
      note: view.healthError
        ? health ? "last good snapshot retained" : "no health snapshot"
        : posture
          ? `trading ${POSTURE_LABEL[posture.paths.trading.status].toLowerCase()}; research ${POSTURE_LABEL[posture.paths.research.status].toLowerCase()}; alerting ${POSTURE_LABEL[posture.paths.notifications.status].toLowerCase()}`
          : "awaiting snapshot",
      tone: view.healthError
        ? "bad"
        : postureTone(posture?.overall),
    },
    {
      label: "Trading path",
      value: posture ? POSTURE_LABEL[posture.paths.trading.status] : "—",
      note: posture?.paths.trading.reason ?? "awaiting gateway source",
      tone: postureTone(posture?.paths.trading.status),
    },
    {
      label: "Provider APIs",
      value: health ? <><NumberTicker value={health.summary.ready} />/{health.summary.total}</> : "—",
      note: health
        // Not "N routable": the value above is already ready/total, so the
        // numerator would be printed twice. The note carries the third number.
        ? `${health.summary.configured} configured`
        : "checking provider registry",
      tone: postureTone(posture?.paths.research.status),
    },
    {
      // The gateway's own in-process decision timing, pushed on the ops
      // snapshot — the header chip's headline, given its own tile here.
      label: "Decision p99",
      value: decision.kind === "measured" && decision.stats.samples >= DECISION_MIN_SAMPLES
        ? <NumberTicker value={decision.stats.p99_us!} format={(v) => formatDuration(v, "us")} />
        : decision.kind === "measured" ? "Collecting" : "—",
      note: decisionNote,
      tone: decisionTileTone,
    },
    {
      // The polled NETWORK vendor tail, split from the web→gateway hop (which
      // rides in the note). The ticker wraps only the measured branch.
      label: "Upstream p99",
      value: hasReliableP99 && latency?.p99 != null
        ? <NumberTicker value={latency.p99} format={(v) => formatDuration(v, "ms")} />
        : "Collecting",
      note: hasReliableP99
        ? `${hop?.p99 != null && (hop.n ?? 0) >= LATENCY_MIN_SAMPLES ? `desk hop p99 ${formatDuration(hop.p99, "ms")}; ` : ""}network, polled; 15-min pool, n=${latency?.n ?? 0}; ${latencyState.label}`
        : `${latency?.n ?? 0} of ${LATENCY_MIN_SAMPLES} samples; not a failure`,
      tone: latencyState.tone === "bad" ? "bad" : latencyState.tone === "warn" ? "warn" : "neutral",
    },
  ];

  const openData = () => {
    onOpenData();
    window.requestAnimationFrame(() => document.getElementById("tab-data")?.focus());
  };

  const openEventsFor = (query: string, label: string) => {
    traceFilterSequence.current += 1;
    setTraceFilterRequest({ id: traceFilterSequence.current, query, label });
    openDrilldown("events");
  };

  return (
    <>
      <ConsoleChrome
        view={view}
        tiles={tiles}
        kicker="DevOps / SRE"
        title="Reliability"
        description="Is the desk up, what is degrading it, and which control brings it back?"
      />

      {/* Exactly one copy of the outcome, wherever the reader is. `OperatorPanel`
          renders `lastResult` inline beside the button that caused it, so this
          console-level banner covers every other position — another section, or
          the Scope, Session, Recovery and History panes, where the mutations
          pane is not mounted. */}
      {(section !== "controls" || remediationPane !== "mutations") && actionResult && (
        <OperatorActionResult result={actionResult} />
      )}

      <WorkspaceSubtabs
        workspaceId="reliability"
        label="Reliability engineer sections"
        tabs={RELIABILITY_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="reliability" tabId="overview" activeId={section}>
        <ReliabilityOverview
          view={view}
          onOpenSection={openDrilldown}
          onOpenData={openData}
          part="attention"
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="reliability" tabId="planes" activeId={section}>
        <ReliabilityOverview
          view={view}
          onOpenSection={openDrilldown}
          onOpenData={openData}
          part="planes"
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel
        workspaceId="reliability"
        tabId="services"
        activeId={section}
        className="reliability-service-panel"
      >
        <HealthMatrix
          providers={health?.providers ?? null}
          routes={health?.routes ?? []}
          venues={health?.venues ?? []}
          guard={guard}
          operatorReady={operatorReady}
          busyAction={busyAction}
          onAction={runAction}
          onInspectEvents={openEventsFor}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="reliability" tabId="events" activeId={section}>
        <TraceConsole
          pollMs={pollMs || 30_000}
          active={active && section === "events"}
          filterRequest={traceFilterRequest}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="reliability" tabId="controls" activeId={section}>
        <div className="seg reliability-remediation-seg" role="group" aria-label="Remediation view">
          {REMEDIATION_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={remediationPane === option.id}
              title={option.hint}
              onClick={() => setRemediationPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Conditional renders, never `hidden`. The section panel above stays
            mounted so a typed token and a chosen purge scope survive a rail
            switch; there is nothing comparable to preserve between Session,
            Recovery and History, and leaving them mounted would keep the
            ledger's 15s poll and the cooldown arithmetic running behind a pane
            nobody is reading.

            Mutations and Scope share ONE mount, and therefore one condition:
            they are two `part`s of `OperatorPanel`, and two conditional renders
            would remount it on every switch — discarding the chosen purge
            scope, quota target and previewed confirmation this comment has just
            said must survive. Neither part polls, so the mount costs nothing. */}
        {(remediationPane === "mutations" || remediationPane === "scope") && (
        <OperatorPanel
          part={remediationPane}
          guard={guard}
          tokenEnv={tokenEnv}
          providers={health?.providers ?? null}
          symbol={workspaceSymbol}
          counters={{
            cacheEntries: health?.cache.entries ?? null,
            stateEntries: health?.cache.stateEntries ?? null,
            eventsRetained: health?.events.retained ?? null,
            eventsCapacity: health?.events.capacity ?? null,
          }}
          busyAction={busyAction}
          lastResult={actionResult}
          token={token}
          onTokenChange={setToken}
          tokenOverrideAvailable={health?.guard.tokenOverrideAvailable === true}
          tokenStatus={view.tokenStatus}
          onAction={runAction}
        />
        )}

        {/* The browser-only half of the old controls card: no guard, no server write. */}
        {remediationPane === "session" && (
          <SessionControls
            pollMs={effectivePollMs}
            onPollMsChange={(ms) => {
              setPaused(ms === 0);
              if (ms > 0) setPollMs(ms);
            }}
            socketCount={sockets.length}
            onReconnectSockets={onReconnectSockets}
          />
        )}

        {/* `fetchedAt` is the correct clock for the cooldown arithmetic
            specifically because the breaker lives in THIS runtime rather than in
            the gateway — the snapshot and the timestamp are produced by the same
            process, so the subtraction never crosses a machine or the browser's
            clock. */}
        {remediationPane === "recovery" && (
        <BreakerStateMachine
          providers={health?.providers ?? null}
          observedAt={health?.fetchedAt ?? null}
        />
        )}

        {/* A sibling, not a section inside OperatorPanel: that component stays a
            pure controls surface with no poll threaded through it. The gate is
            BOTH conditions, exactly as `BlotterViews` gates `WorkingOrders`:
            the section clause is load-bearing today because
            `WorkspaceSubtabPanel` hides rather than unmounts, and the pane
            clause is redundant only for as long as this stays a conditional
            render — the poll must not come back the day someone switches these
            to `hidden` to preserve scroll position. */}
        {remediationPane === "history" && (
          <RemediationLedger active={active && section === "controls" && remediationPane === "history"} />
        )}
      </WorkspaceSubtabPanel>
    </>
  );
}
