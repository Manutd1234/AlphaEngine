"use client";

import { KeyboardEvent, useCallback, useMemo, useRef, useEffect, useState } from "react";
import LatencyChip from "@/components/header/LatencyChip";
import KillSwitchControl, {
  type KillSwitchHaltState,
  type KillSwitchRiskControl,
} from "@/components/header/KillSwitchControl";
import AccountChip from "@/components/header/AccountChip";
import TelegramCta from "@/components/header/TelegramCta";
import QuickSettings from "@/components/header/QuickSettings";
import BrandLockup from "@/components/common/BrandLockup";
import DataTierBadge from "@/components/header/DataTierBadge";
import type { LatencyStats } from "@/components/systems/types";
import type { DecisionLatencySource } from "@/lib/overview-state";
import type { Provenance } from "@/lib/data-tier";

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
  /** Fired when a reader looks like they are about to open a tab. */
  onViewIntent?: (view: WorkspaceView) => void;
  onOpenProviderHealth: () => void;
  onOpenTailLatency: () => void;
  latency: LatencyStats | null;
  /** Where the gateway's in-process decision figure stands; the chip's headline. */
  decisionLatency: DecisionLatencySource;
  /** The web→gateway hop, split out of the network pool; rides in the chip title. */
  gatewayHopLatency?: LatencyStats | null;
  degraded: number;
  providersReady: number | null;
  providersTotal: number | null;
  healthUnreachable: boolean;
  /**
   * When the shared health snapshot last landed. Keys the status dot, so each
   * successful poll remounts it and replays one health-beat ring — the whole
   * workspace's wordless heartbeat. Null before the first snapshot.
   */
  healthUpdatedAt?: Date | null;
  /**
   * What the desk's numbers are made of, stated once for everything below.
   * Optional so a surface that mounts the header without a book — the login
   * page's chrome, a future embed — is not forced to invent a provenance.
   */
  dataSource?: {
    provenance: Provenance;
    retryInSeconds?: number | null;
    detail?: string | null;
    onRetry: () => void;
  } | null;
  halt: KillSwitchHaltState | null;
  riskControl: KillSwitchRiskControl;
  /** Opens the command palette. Without a control here the palette, the
   *  reviewer tour and the shortcut map were keyboard-only — i.e. absent on
   *  every phone and tablet. */
  onOpenCommandBar: () => void;
}

export default function WorkspaceHeader({
  view,
  onViewChange,
  onViewIntent,
  /* Renamed on arrival, and re-declared below as callbacks that do not change
     identity between renders. The row's chips read the stable ones. */
  onOpenProviderHealth: providerHealthFromPage,
  onOpenTailLatency: tailLatencyFromPage,
  decisionLatency,
  gatewayHopLatency = null,
  onOpenCommandBar,
  latency,
  degraded,
  providersReady,
  providersTotal,
  healthUnreachable,
  healthUpdatedAt = null,
  dataSource = null,
  halt,
  riskControl,
}: WorkspaceHeaderProps) {
  // Bumped by the account menu's Preferences item to open the settings panel.
  /**
   * The two panels ask each other to open, so the header holds both counters.
   *
   * Account → Preferences → Quick settings → back → Account is one menu with
   * two pages as far as a reader is concerned; it was two dead ends because
   * neither panel could reach the other and the only way back was to dismiss
   * and press the avatar again.
   */
  const [settingsSignal, setSettingsSignal] = useState(0);
  const [accountSignal, setAccountSignal] = useState(0);
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
   *
   * Published only on a real change, and never from inside the observation.
   * The property is set on the ROOT element, so an unchanged rewrite still
   * invalidates the style of every node that inherits it, and `--header-h`
   * sizes the one scroller on the page — so a write made during delivery
   * dirties layout in the frame that is delivering, which is a ResizeObserver
   * loop and would read here as the whole desk freezing. WorkspaceSubtabs
   * carries the mirror of this for `--rail-h`, with the measurements.
   */
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    let frame = 0;
    const publish = () => {
      frame = 0;
      const next = `${Math.round(node.getBoundingClientRect().height)}px`;
      if (root.style.getPropertyValue("--header-h") === next) return;
      root.style.setProperty("--header-h", next);
    };
    publish();
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(publish);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // ⌘K lives in `page.tsx` with the dialog it opens — see CommandBar's header
  // for why the palette cannot render inside this element.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      // e.code, not e.key: on macOS Option+digit types "¡™£…" so a key-range
      // test never matches and the advertised Alt+1–8 shortcut silently died
      // on every Mac. Physical-key codes are layout- and modifier-stable.
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-8]$/.test(e.code)) {
        // Never while typing — Alt+digit composes characters in text fields.
        const target = e.target as HTMLElement | null;
        if (target && (target.isContentEditable
          || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
          return;
        }
        e.preventDefault();
        const index = Number(e.code.slice(5)) - 1;
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

  /**
   * ─── Keeping the row's memoised chips out of each other's re-renders ───────
   *
   * Every chip in this bar is `React.memo`'d, and a memo is only ever as good
   * as the props it is handed. Four of these arrive as a fresh value on every
   * render of the dashboard — two inline arrows and two object literals — and
   * each one on its own is enough to re-render the control it feeds, so the
   * decision chip counting would repaint the Telegram link, the kill switch
   * and the account menu beside it several times a second.
   *
   * The arrows are absorbed through a ref rather than fixed at the call site,
   * which is the shape this deserves and is not the shape it can have:
   * `app/dashboard/page.tsx` is at its `tests/file-size.test.ts` ceiling, so
   * the two `useCallback`s that belong there have nowhere to live until it is
   * split. Writing the ref during render is the same move `NumberTicker` makes
   * for its formatter, and for the same reason — the callback the reader
   * pressed must be the current one, never the one captured at mount.
   */
  const callbacks = useRef({ providerHealthFromPage, tailLatencyFromPage });
  callbacks.current = { providerHealthFromPage, tailLatencyFromPage };
  /* The names the rest of this file — and `tests/quick-settings.test.ts`, which
     pins the providers chip and the panel's mirror to ONE handler — already
     use. Only their identity changed, and that is the whole point. */
  const onOpenProviderHealth = useCallback(() => callbacks.current.providerHealthFromPage(), []);
  const onOpenTailLatency = useCallback(() => callbacks.current.tailLatencyFromPage(), []);
  const openPreferences = useCallback(() => setSettingsSignal((n) => n + 1), []);
  const backToAccount = useCallback(() => setAccountSignal((n) => n + 1), []);

  /**
   * The two object props, rebuilt from their fields.
   *
   * The halted symbols are keyed by their contents rather than by the array's
   * identity: the book hands down a new array whenever its payload is re-read,
   * and re-arming the kill switch's memo on that would undo the whole point.
   * Null stays null — a book that has not answered yet is not an un-halted one.
   */
  const haltedKey = halt ? halt.haltedSymbols.join(" ") : null;
  const haltState = useMemo<KillSwitchHaltState | null>(
    () => (halt ? { halted: halt.halted, haltedSymbols: halt.haltedSymbols, sandbox: halt.sandbox } : null),
    // eslint is not installed here; the deps are the fields, deliberately, and
    // `haltedKey` stands in for the array so its identity cannot churn them.
    [halt?.halted, haltedKey, halt?.sandbox],
  );
  const killRiskControl = useMemo<KillSwitchRiskControl>(
    () => ({
      guardMode: riskControl.guardMode,
      token: riskControl.token,
      onTokenChange: riskControl.onTokenChange,
      onExecuted: riskControl.onExecuted,
    }),
    [riskControl.guardMode, riskControl.token, riskControl.onTokenChange, riskControl.onExecuted],
  );

  // "Routable" is intentionally narrower than "live": six paid providers are
  // not probed on every refresh, so this aggregate must not imply network proof.
  const healthLabel = healthUnreachable
    ? "Health unreachable"
    : providersTotal != null
      ? degraded
        ? `${degraded} provider${degraded === 1 ? "" : "s"} degraded`
        : `${providersReady ?? 0}/${providersTotal} providers routable`
      : "Checking data plane";
  // The middle rungs of the header's priority ladder (globals.css) swap the
  // sentence for this: the count survives, the noun survives, "routable" —
  // the qualifier the aria-label and the panel still carry — is what goes.
  const healthLabelShort = healthUnreachable
    ? "Health ✕"
    : providersTotal != null
      ? degraded
        ? `${degraded} degraded`
        : `${providersReady ?? 0}/${providersTotal} providers`
      : "Checking";
  const healthNeedsAttention =
    healthUnreachable
    || degraded > 0
    || (providersTotal != null && (providersReady ?? 0) < providersTotal);

  return (
    <header className="workspace-header" ref={headerRef}>
      <div className="workspace-header__utility workspace-header__primary">
        <BrandLockup
          onClick={() => onViewChange("overview")}
          label="Open AlphaEngine overview"
        />

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
              /* Intent, not arrival. The three console panels are dynamic
                 imports warmed on requestIdleCallback, and on a busy machine
                 idle can lose the race to a click — which is exactly the
                 machine where the loading box is most noticeable. A pointer
                 crossing the tab, or focus landing on it, is several hundred
                 milliseconds of warning and costs nothing when the chunk is
                 already there. */
              onPointerEnter={() => onViewIntent?.(item.id)}
              onFocus={() => onViewIntent?.(item.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              title={item.role}
            >
              {/* The role each tab belongs to reaches the reader through
                  `title` above and through the ≤900px `<select>`, whose options
                  read "{label} — {role}". It used to be rendered here as well,
                  inside a `<small>` that `globals.css` hid with a base rule —
                  so it had never been visible at any width, and a second rule
                  further down hid it again with a comment explaining it was
                  "the first thing to go when the tab is this narrow". */}
              <span>{item.label}</span>
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

        <TelegramCta />
        <button
          type="button"
          className="header-command-button"
          onClick={onOpenCommandBar}
          aria-label="Open the command palette. Keyboard shortcut Command K"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <span aria-hidden>⌘K</span>
          <span className="header-command-button__label">Search</span>
        </button>
        <LatencyChip decision={decisionLatency} network={latency} gatewayHop={gatewayHopLatency} onOpenReliability={onOpenTailLatency} />
        {/* Before the kill switch on purpose: what the numbers are made of
            decides whether the control beside it can be armed at all. */}
        {dataSource && (
          <DataTierBadge
            provenance={dataSource.provenance}
            retryInSeconds={dataSource.retryInSeconds}
            detail={dataSource.detail}
            onRetry={dataSource.onRetry}
          />
        )}
        <KillSwitchControl halt={haltState} riskControl={killRiskControl} />
        <button
          type="button"
          className={`system-health system-health-action ${healthNeedsAttention ? "is-warn" : ""}`}
          aria-label={`Open reliability. ${healthLabel}`}
          onClick={onOpenProviderHealth}
          /* The chip's anti-resize reservation: the widest sentence THIS fleet
             can produce, drawn as a hidden pseudo-element under the live label
             (see `.system-health-action::before/::after` in globals). A px
             floor sized for a hypothetical fleet left ~26px of invisible slack
             here and tripled the visual gap to the account chip. */
          data-widest={providersTotal != null ? `${providersTotal}/${providersTotal} providers routable` : undefined}
          data-widest-short={providersTotal != null ? `${providersTotal}/${providersTotal} providers` : undefined}
        >
          {/* Keyed by snapshot time: each successful poll remounts the dot and
              replays one health-beat ring. Decoration only — the label beside
              it carries the state. */}
          <i aria-hidden key={healthUpdatedAt?.getTime() ?? 0} />
          <span className="system-health__label">{healthLabel}</span>
          <span className="system-health__label--short" aria-hidden>{healthLabelShort}</span>
        </button>
        <AccountChip
          onOpenPreferences={openPreferences}
          openSignal={accountSignal}
        />
        <QuickSettings
          healthLabel={healthLabel}
          healthNeedsAttention={healthNeedsAttention}
          onOpenReliability={onOpenProviderHealth}
          openSignal={settingsSignal}
          onBackToAccount={backToAccount}
        />
      </div>
    </header>
  );
}
