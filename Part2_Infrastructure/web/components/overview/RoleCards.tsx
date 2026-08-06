"use client";

/**
 * The role launcher, restructured for inline actions.
 *
 * Each card used to be one big <button>, which made a second control inside it
 * invalid HTML (nested interactive elements) and unreachable for AT. The card
 * is now an <article> with two real buttons in DOM order: the primary
 * navigation and, where an honest one exists, an inline action wired to a
 * handler the page already owns. No card fires an order — OrderTicket behind
 * the pre-trade gates is the single execution write surface, and the overview
 * must not become a second one.
 *
 * There is no client-side RBAC here on purpose: the app has no user system.
 * "Role validation" is the server-side operator guard (token | open-dev |
 * locked) on the mutating endpoints — buttons render for everyone and guarded
 * calls answer with their real verdict.
 */

import { usd } from "@/lib/format";
import type { WorkspaceView } from "@/components/WorkspaceHeader";
import type { Side } from "@/lib/venues";

export interface RoleContext {
  symbol: string;
  candidate: string;
  researchStatus: string;
  side: Side;
  notional: number;
  slippageBps: number;
  providers: string;
  systemStatus: string;
}

interface InlineAction {
  label: string;
  busyLabel?: string;
  run: () => void;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
}

/**
 * The seven roles the platform is built for. Each card states what that role
 * would open the tab to find out, filled in from live context where there is
 * any — a launcher that only listed names would be a table of contents.
 */
const ROLE_CARDS: {
  view: WorkspaceView;
  code: string;
  role: string;
  action: string;
  headline: (context: RoleContext) => string;
  status: (context: RoleContext) => string;
}[] = [
  {
    view: "research",
    code: "QR",
    role: "Quant researcher",
    action: "Inspect evidence",
    headline: (c) => c.candidate,
    status: (c) => c.researchStatus,
  },
  {
    view: "live",
    code: "EX",
    role: "Quant trader",
    action: "Work the order",
    headline: (c) => `${c.side} ${c.symbol} · ${usd(c.notional, 0)}`,
    status: (c) => `${c.slippageBps} bps modeled cost budget`,
  },
  {
    view: "portfolio",
    code: "PM",
    role: "Portfolio manager",
    action: "Open the book",
    headline: () => "Positions & allocation",
    status: () => "Exposure, concentration and sleeve attribution",
  },
  {
    view: "risk",
    code: "RM",
    role: "Risk manager",
    action: "Check headroom",
    headline: () => "Limits & tail risk",
    status: () => "VaR scored against its own record, scenarios, kill switch",
  },
  {
    view: "data",
    code: "DE",
    role: "Data engineer",
    action: "Verify lineage",
    headline: (c) => c.providers,
    status: () => "Routing, source agreement, quarantine and quota",
  },
  {
    view: "reliability",
    code: "SRE",
    role: "DevOps / SRE",
    action: "Check health",
    headline: (c) => c.systemStatus,
    status: () => "Breakers, latency percentiles, trace and outage drills",
  },
  {
    view: "developer",
    code: "API",
    role: "Quant developer",
    action: "Read the contract",
    headline: () => "API & verification",
    status: () => "Committed schema, parity fixtures and the CI gates",
  },
];

export default function RoleCards({
  context,
  onNavigate,
  onRun,
  running,
  researchStale,
  onRefreshBook,
  bookRefreshing,
  onRefreshHealth,
}: {
  context: RoleContext;
  onNavigate: (view: WorkspaceView) => void;
  /** page.tsx run() — verified not to navigate, so the card does both. */
  onRun: () => void;
  running: boolean;
  researchStale: boolean;
  onRefreshBook: () => void;
  bookRefreshing: boolean;
  onRefreshHealth: () => void;
}) {
  const inlineFor = (view: WorkspaceView): InlineAction | null => {
    switch (view) {
      case "research":
        return {
          label: researchStale ? `Rerun for ${context.symbol}` : "Run sweep",
          busyLabel: "Running…",
          busy: running,
          disabled: running,
          title: "Run the sweep with the current experiment setup, then open the evidence",
          run: () => {
            onRun();
            onNavigate("research");
          },
        };
      case "portfolio":
        return {
          label: "Refresh book",
          busyLabel: "Refreshing…",
          busy: bookRefreshing,
          disabled: bookRefreshing,
          title: "Re-read the authoritative book from the gateway",
          run: onRefreshBook,
        };
      case "data":
      case "reliability":
        return {
          label: "Refresh health",
          title: "Re-read the system health snapshot now",
          run: onRefreshHealth,
        };
      default:
        // live / risk / developer: no honest second action exists from here.
        return null;
    }
  };

  return (
    <div className="role-grid">
      {ROLE_CARDS.map((card) => {
        const inline = inlineFor(card.view);
        return (
          <article
            key={card.view}
            className="pipeline-card role-card"
            aria-labelledby={`role-card-${card.view}`}
          >
            <span className="role-card__header">
              <span className="role-monogram" aria-hidden>{card.code}</span>
              <span id={`role-card-${card.view}`} className="pipeline-card__step">{card.role}</span>
            </span>
            <strong className="pipeline-card__value">{card.headline(context)}</strong>
            <small className="pipeline-card__status">{card.status(context)}</small>
            <div className="role-card__actions">
              <button
                type="button"
                className="primary-action role-card__action"
                onClick={() => onNavigate(card.view)}
              >
                {card.action} <span aria-hidden>→</span>
              </button>
              {inline && (
                <button
                  type="button"
                  className="role-card__action"
                  onClick={inline.run}
                  disabled={inline.disabled}
                  title={inline.title}
                >
                  {inline.busy ? inline.busyLabel ?? inline.label : inline.label}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
