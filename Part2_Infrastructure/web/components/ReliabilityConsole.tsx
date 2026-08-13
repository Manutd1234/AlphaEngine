"use client";

/**
 * SRE's tab: is the platform up, and if not, which layer broke?
 *
 * The role's blueprint asks to locate a failure in compute, network, provider,
 * cache or broker connectivity without opening several dashboards, so the
 * workflow answers that question in layers — Telemetry surfaces symptoms, the
 * Services matrix says which provider or breaker is involved, Logs says when
 * it started, and Remediation is where a guarded response or drill is performed.
 *
 * Reads are free and always available; writes are gated and every control states
 * its cost. Provider-routing telemetry and the trading gateway are separate
 * observation planes; this UI keeps their source and scope explicit.
 */

import { useRef, useState } from "react";

import HealthMatrix from "@/components/systems/HealthMatrix";
import BreakerStateMachine from "@/components/systems/BreakerStateMachine";
import OperatorPanel, { OperatorActionResult } from "@/components/systems/OperatorPanel";
import ReliabilityOverview, { type ReliabilityDrilldown } from "@/components/systems/ReliabilityOverview";
import RemediationLedger from "@/components/systems/RemediationLedger";
import TraceConsole from "@/components/systems/TraceConsole";
import { ConsoleChrome, type ConsoleTile } from "@/components/systems/ConsoleChrome";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { fmt } from "@/lib/format";
import { LATENCY_MIN_SAMPLES, latencyTone } from "@/lib/overview-state";
import { deriveReliabilityPosture, type ReliabilityStatus } from "@/lib/reliability";
import { RELIABILITY_SECTIONS, type ReliabilitySection } from "@/lib/sections";
import type { SystemHealthView } from "@/lib/use-system-health";

export { RELIABILITY_SECTION_IDS, type ReliabilitySection } from "@/lib/sections";

export interface ReliabilityConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  onOpenData: () => void;
  section: ReliabilitySection;
  onSectionChange: (section: ReliabilitySection) => void;
}

const POSTURE_LABEL: Record<ReliabilityStatus, string> = {
  nominal: "Nominal",
  degraded: "Degraded",
  critical: "Critical",
  halted: "Trading halted",
  unknown: "Unknown",
};

function postureTone(status: ReliabilityStatus | undefined): ConsoleTile["tone"] {
  if (status === "critical" || status === "halted") return "bad";
  if (status === "degraded" || status === "unknown") return "warn";
  if (status === "nominal") return "good";
  return "neutral";
}

/**
 * Remediation was three stacked cards in one scroll — the controls, the state
 * machine that explains recovery, and the ledger of what has been done. Over a
 * thousand lines of section, and a reader arriving mid-incident had to scroll
 * past two reference surfaces to reach the only one with buttons on it.
 *
 * These are three questions with three separate sources, so each degrades on
 * its own: the controls read `guard` and the provider registry, the state
 * machine reads `health.providers[].breaker`, and the ledger runs its own fetch
 * against this instance's event ring.
 *
 * Deliberately NOT a nested `<WorkspaceSubtabs>`: that publishes `--rail-h`
 * from a ResizeObserver and its own comment asserts exactly one rail is mounted
 * at a time, so a second instance would fight the first over every sticky
 * offset in the app. The house in-panel pattern is `.seg role="group"`, as
 * Dependencies and the blotter use.
 */
type RemediationPane = "act" | "recovery" | "history";

/**
 * Act leads and is the default. It is the pane a reader lands on in an
 * incident, and the only one that can change anything; the other two are
 * evidence and explanation, which are worth one click rather than a page of
 * scrolling above the controls.
 */
const REMEDIATION_PANES: Array<{ id: RemediationPane; label: string; hint: string }> = [
  { id: "act", label: "Act", hint: "Every guarded control, what it acts on, and what each one costs" },
  { id: "recovery", label: "Recovery", hint: "How a tripped circuit comes back on its own, and how much cooldown is left" },
  { id: "history", label: "History", hint: "Which circuits have actually tripped here, and how each one was closed" },
];

export default function ReliabilityConsole({
  view,
  workspaceSymbol,
  onOpenData,
  section,
  onSectionChange,
}: ReliabilityConsoleProps) {
  const [traceFilterRequest, setTraceFilterRequest] = useState<{
    id: number;
    query: string;
    label: string;
  } | null>(null);
  const traceFilterSequence = useRef(0);
  const [remediationPane, setRemediationPane] = useState<RemediationPane>("act");
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

  const latency = health?.summary.latency;
  const posture = health ? deriveReliabilityPosture(health) : null;

  const overallState = view.healthError
    ? "Unreachable"
    : !posture
      ? "Checking"
      : POSTURE_LABEL[posture.overall];

  /**
   * Focus follows the switch, or a keyboard reader is left on a control that no
   * longer describes what is on screen.
   *
   * The optional anchor argument went with the two tile actions below: nothing
   * in this component targets an element inside a section any more, and the two
   * deep links that do — the header's latency chip and system-health button —
   * are wired in `app/dashboard/page.tsx` because the header is global.
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
        ? health ? "last good snapshot retained" : "no health snapshot available"
        : posture
          ? `trading ${POSTURE_LABEL[posture.paths.trading.status].toLowerCase()} · research ${POSTURE_LABEL[posture.paths.research.status].toLowerCase()}`
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
      value: health ? `${health.summary.ready}/${health.summary.total}` : "—",
      note: health
        ? `${health.summary.configured} configured · ${health.summary.ready} routable`
        : "checking provider registry",
      tone: postureTone(posture?.paths.research.status),
    },
    {
      label: "Tail latency (p99)",
      value: hasReliableP99 ? `${fmt(latency?.p99 ?? 0, 0)}ms` : "Collecting",
      note: hasReliableP99
        ? `99% completed within this · ${latencyState.label} · n=${latency?.n ?? 0}`
        : `${latency?.n ?? 0}/${LATENCY_MIN_SAMPLES} samples · not a failure`,
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
        description="Is the desk up, what is degrading it, and which control brings it back — read from one health snapshot."
      />

      {/* Exactly one copy of the outcome, wherever the reader is. `OperatorPanel`
          renders `lastResult` inline beside the button that caused it, so the
          console-level banner exists for every other position — another section,
          and now also the Recovery and History panes, where that panel is not
          mounted. Without the pane clause a confirmed purge would report to a
          component nobody can see. */}
      {(section !== "controls" || remediationPane !== "act") && actionResult && (
        <OperatorActionResult result={actionResult} />
      )}

      <WorkspaceSubtabs
        workspaceId="reliability"
        label="Reliability engineer sections"
        tabs={RELIABILITY_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
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
          active={section === "events"}
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
            mounted so a typed operator token and a chosen purge scope survive a
            rail switch; there is nothing comparable to preserve between these
            three, and leaving them mounted would keep the ledger's 15s poll and
            the machine's cooldown arithmetic running behind a pane nobody is
            reading. */}
        {remediationPane === "act" && (
        <OperatorPanel
          guard={guard}
          tokenEnv={tokenEnv}
          providers={health?.providers ?? null}
          symbol={workspaceSymbol}
          pollMs={effectivePollMs}
          onPollMsChange={(ms) => {
            setPaused(ms === 0);
            if (ms > 0) setPollMs(ms);
          }}
          socketCount={sockets.length}
          onReconnectSockets={onReconnectSockets}
          busyAction={busyAction}
          lastResult={actionResult}
          token={token}
          onTokenChange={setToken}
          tokenOverrideAvailable={health?.guard.tokenOverrideAvailable === true}
          tokenStatus={view.tokenStatus}
          onAction={runAction}
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
            pure controls surface with no poll threaded through it.

            The gate is BOTH conditions, exactly as `BlotterViews` gates
            `WorkingOrders`. The section clause is load-bearing today, because
            `WorkspaceSubtabPanel` hides rather than unmounts; the pane clause is
            redundant only for as long as this stays a conditional render, and
            the poll must not start running again the day someone switches these
            three to `hidden` to preserve scroll position. */}
        {remediationPane === "history" && (
          <RemediationLedger active={section === "controls" && remediationPane === "history"} />
        )}
      </WorkspaceSubtabPanel>
    </>
  );
}
