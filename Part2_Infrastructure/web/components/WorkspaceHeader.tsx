"use client";

import { KeyboardEvent, useRef, useEffect } from "react";
import LatencyChip from "@/components/header/LatencyChip";
import KillSwitchControl, {
  type KillSwitchHaltState,
  type KillSwitchRiskControl,
} from "@/components/header/KillSwitchControl";
import ComplexityToggle from "@/components/ComplexityToggle";
import ThemeToggle from "@/components/ThemeToggle";
import type { LatencyStats } from "@/components/systems/types";

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
  const headerRef = useRef<HTMLElement | null>(null);

  /**
   * Publishes the header's measured height as `--header-h`, which every sticky
   * offset in the workspace is expressed against.
   *
   * A constant does not work here. Below 900px the eight role tabs become a
   * compact workspace selector and the bar changes height. A section rail
   * docked to a hardcoded 56px simply disappeared behind the header in both
   * cases — navigation present in the DOM and invisible on screen.
   */
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      document.documentElement.style.setProperty(
        "--header-h",
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // ⌘K lives in `page.tsx` with the dialog it opens — see CommandBar's header
  // for why the palette cannot render inside this element.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
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
    <header className="workspace-header" ref={headerRef}>
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

        <label className="workspace-switcher">
          <span>Workspace</span>
          <select
            value={view}
            aria-label="Choose AlphaEngine workspace"
            onChange={(event) => onViewChange(event.target.value as WorkspaceView)}
          >
            {NAV_ITEMS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} — {item.role}
              </option>
            ))}
          </select>
        </label>

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
        <ComplexityToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
