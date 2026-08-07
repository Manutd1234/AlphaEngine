"use client";

import { KeyboardEvent, useRef, useState, useEffect } from "react";
import LatencyChip from "@/components/header/LatencyChip";
import KillSwitchControl, {
  type KillSwitchHaltState,
  type KillSwitchRiskControl,
} from "@/components/header/KillSwitchControl";
import ThemeToggle from "@/components/ThemeToggle";
import type { LatencyStats } from "@/components/systems/types";
import CommandBar from "@/components/header/CommandBar";
import AudienceAccessibilityBar from "@/components/common/AudienceAccessibilityBar";

export type WorkspaceView =
  | "overview"
  | "research"
  | "live"
  | "portfolio"
  | "risk"
  | "data"
  | "reliability"
  | "developer";

export const NAV_ITEMS: { id: WorkspaceView; label: string; role: string; accessibleLabel?: string }[] = [
  { id: "overview", label: "Overview", role: "All Roles" },
  { id: "research", label: "Research", role: "Quant" },
  { id: "live", label: "Execution", role: "Trader", accessibleLabel: "Execution" },
  { id: "portfolio", label: "Portfolio", role: "PM" },
  { id: "risk", label: "Risk", role: "Risk" },
  { id: "data", label: "Data", role: "Data", accessibleLabel: "Data operations" },
  { id: "reliability", label: "Reliability", role: "SRE" },
  { id: "developer", label: "Developer", role: "Dev" },
];

interface WorkspaceHeaderProps {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  onOpenProviderHealth: () => void;
  onOpenTailLatency: () => void;
  latency: LatencyStats | null;
  degraded: number;
  providersReady: number | null;
  providersTotal: number | null;
  healthUnreachable: boolean;
  halt: KillSwitchHaltState | null;
  riskControl: KillSwitchRiskControl;
}

export default function WorkspaceHeader({
  view,
  onViewChange,
  onOpenProviderHealth,
  onOpenTailLatency,
  latency,
  degraded,
  providersReady,
  providersTotal,
  healthUnreachable,
  halt,
  riskControl,
}: WorkspaceHeaderProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [fontSize, setFontSize] = useState<"normal" | "large" | "xlarge" | "huge">("normal");
  const [plainEnglishMode, setPlainEnglishMode] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandBarOpen((prev) => !prev);
      }
      if (e.altKey && e.key >= "1" && e.key <= "8") {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index >= 0 && index < NAV_ITEMS.length) {
          onViewChange(NAV_ITEMS[index].id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onViewChange]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % NAV_ITEMS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = NAV_ITEMS.length - 1;
    onViewChange(NAV_ITEMS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  // "Routable" is intentionally narrower than "live": six paid providers are
  // not probed on every refresh, so this aggregate must not imply network proof.
  const healthLabel = healthUnreachable
    ? "Health unreachable"
    : providersTotal != null
      ? degraded
        ? `${degraded} provider${degraded === 1 ? "" : "s"} degraded`
        : `${providersReady ?? 0}/${providersTotal} providers routable`
      : "Checking data plane";
  const healthNeedsAttention =
    healthUnreachable
    || degraded > 0
    || (providersTotal != null && (providersReady ?? 0) < providersTotal);

  return (
    <header className="workspace-header">
      <div className="workspace-header__utility workspace-header__primary">
        <button className="brand-lockup" onClick={() => onViewChange("overview")} aria-label="Open AlphaEngine overview">
          <span className="brand-mark" aria-hidden>
            <span className="brand-mark__alpha">α</span>
            <span className="brand-mark__rails"><i /><i /></span>
          </span>
          <span className="brand-copy">
            <strong>AlphaEngine</strong>
            <small>Quant operating system</small>
          </span>
        </button>

        <nav
          className="workspace-tabs"
          role="tablist"
          aria-label="AlphaEngine workspace"
          aria-orientation="horizontal"
        >
          {NAV_ITEMS.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              aria-label={item.accessibleLabel}
              aria-selected={view === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={view === item.id ? 0 : -1}
              onClick={() => onViewChange(item.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              title={item.role}
            >
              <span>{item.label}</span>
              {/* The role each tab belongs to. Eight tabs only read as a map of
                  the desk if the audience is on the tab itself. */}
              <small className="workspace-tabs__role">{item.role}</small>
            </button>
          ))}
        </nav>

        <div className="header-spacer" />

        <LatencyChip latency={latency} onOpenReliability={onOpenTailLatency} />
        <KillSwitchControl halt={halt} riskControl={riskControl} />
        <button
          type="button"
          className={`system-health system-health-action ${healthNeedsAttention ? "is-warn" : ""}`}
          aria-label={`Open reliability. ${healthLabel}`}
          onClick={onOpenProviderHealth}
        >
          <i aria-hidden />
          {healthLabel}
        </button>
        <AudienceAccessibilityBar
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          plainEnglishMode={plainEnglishMode}
          onTogglePlainEnglish={() => setPlainEnglishMode((p) => !p)}
        />
        <ThemeToggle />
      </div>

      <CommandBar
        open={commandBarOpen}
        onClose={() => setCommandBarOpen(false)}
        onSelectTab={(tabId) => onViewChange(tabId as WorkspaceView)}
        onSymbolSelect={() => onViewChange("live")}
        onToggleKillSwitch={() => onViewChange("risk")}
        onToggleFontSize={() => setFontSize((s) => (s === "normal" ? "large" : s === "large" ? "xlarge" : s === "xlarge" ? "huge" : "normal"))}
      />
    </header>
  );
}
