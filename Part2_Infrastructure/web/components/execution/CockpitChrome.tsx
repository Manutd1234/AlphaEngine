"use client";

/**
 * The cockpit's two pieces of chrome: the first-load placeholder and the
 * mode banners.
 *
 * Both are stated per subtab rather than once for the tab, and that is the
 * point of the placeholder: each of the three panels says what IT is waiting
 * for, so a reader who opened Fill quality is not told the app is "connecting"
 * when what it is doing is measuring. Split out of `ExecutionCockpit` verbatim
 * — the bail-out that renders the placeholder stays in the component, because
 * where a component returns early is a property of that component.
 */

import { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import type { ExecutionSection } from "@/lib/sections";

import type { CockpitMode } from "./use-cockpit-feed";

/** The first load, before any probe has settled. */
export function CockpitPlaceholder({ section }: { section: ExecutionSection }) {
  return (
    <>
      <WorkspaceSubtabPanel workspaceId="execution" tabId="trade" activeId={section}>
        <div className="card cockpit-placeholder" aria-busy="true">
          <p>Connecting to the risk gateway…</p>
          <div className="skeleton" style={{ height: 120, marginTop: 10 }} aria-hidden />
        </div>
      </WorkspaceSubtabPanel>
      <WorkspaceSubtabPanel workspaceId="execution" tabId="quality" activeId={section}>
        <div className="card cockpit-placeholder" aria-busy="true">
          <p>Measuring realised execution cost…</p>
          <div className="skeleton" style={{ height: 120, marginTop: 10 }} aria-hidden />
        </div>
      </WorkspaceSubtabPanel>
      <WorkspaceSubtabPanel workspaceId="execution" tabId="activity" activeId={section}>
        <div className="card cockpit-placeholder" aria-busy="true">
          <p>Loading orders, fills and risk events…</p>
          <div className="skeleton" style={{ height: 120, marginTop: 10 }} aria-hidden />
        </div>
      </WorkspaceSubtabPanel>
    </>
  );
}

interface CockpitBannersProps {
  mode: CockpitMode;
  /** True once a probe has settled on "there is no gateway in this deployment". */
  unconfigured: boolean;
  /**
   * Measured numbers the gateway is no longer confirming.
   *
   * A state the cockpit could not previously be in: a failed probe discarded
   * the book and fell to the sandbox, so there was nothing to label. Keeping
   * the last good reading is the better behaviour, but it creates the
   * obligation this flag discharges — a stale desk that looks identical to a
   * live one is the same defect as a generated one that looks measured.
   */
  stale: boolean;
  /** When the gateway last actually answered, for the age on that banner. */
  lastSyncAt: Date | null;
  sandboxOff: boolean;
  onSandboxOff: (off: boolean) => void;
}

/**
 * What the desk is, said persistently.
 *
 * Neither banner is dismissible and neither is a one-time notice: a generated
 * desk that announced itself once is a real desk ten minutes into a reading.
 */
export function CockpitBanners({
  mode, unconfigured, stale, lastSyncAt, sandboxOff, onSandboxOff,
}: CockpitBannersProps) {
  return (
    <>
    {stale && (
      <div className="banner warn" role="status">
        <span aria-hidden>◆</span>
        <div>
          <strong>Last known desk.</strong> The gateway stopped answering, so these are the
          numbers it last sent
          {lastSyncAt ? <> at <span className="num">{lastSyncAt.toLocaleTimeString()}</span></> : null}
          , not the book as it stands now. Nothing here is generated.
        </div>
      </div>
    )}
    {mode === "sandbox" && (
      /* Same grammar as the book chrome: persistent, above everything, on
         every render — a one-time notice is how a generated desk gets
         mistaken for a real one after ten minutes of reading. */
      <div className="banner warn sandbox-banner" role="status">
        <span aria-hidden>◆</span>
        <div>
          <strong>Sandbox desk — these orders were never sent.</strong> The blotter, alerts and
          P&amp;L below are generated from a fixed seed. The ticket replays the gateway&apos;s
          own pre-trade gates against that book.
        </div>
        <button type="button" className="text-action" onClick={() => onSandboxOff(true)}>
          Live gateway →
        </button>
      </div>
    )}
    {mode === "outage" && unconfigured && sandboxOff && (
      <div className="banner warn" role="status">
        <span aria-hidden>◆</span>
        <div>
          No gateway in this deployment, so the live desk has nothing to show.
          <button type="button" className="text-action" onClick={() => onSandboxOff(false)}>
            Back to the sandbox desk →
          </button>
        </div>
      </div>
    )}
    </>
  );
}
