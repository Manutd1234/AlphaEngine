"use client";

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
    role: "Quant Researcher",
    action: "Open Research →",
    headline: (c) => c.candidate,
    status: (c) => c.researchStatus,
  },
  {
    view: "live",
    code: "EX",
    role: "Quant Trader",
    action: "Open Execution →",
    headline: (c) => `${c.side} ${c.symbol} · ${usd(c.notional, 0)}`,
    status: (c) => `${c.slippageBps} bps modeled cost budget`,
  },
  {
    view: "portfolio",
    code: "PM",
    role: "Portfolio Manager",
    action: "Open Portfolio →",
    headline: () => "Positions & Allocation",
    status: () => "Exposure, concentration and sleeve attribution",
  },
  {
    view: "risk",
    code: "RM",
    role: "Risk Manager",
    action: "Open Risk →",
    headline: () => "Limits & Tail Risk",
    status: () => "VaR scored against historical limits and kill switch",
  },
  {
    view: "data",
    code: "DE",
    role: "Data Engineer",
    action: "Open Data Ops →",
    headline: (c) => c.providers,
    status: () => "Feed freshness, source agreement and payload lineage",
  },
  {
    view: "reliability",
    code: "SRE",
    role: "DevOps / SRE",
    action: "Open Reliability →",
    headline: (c) => c.systemStatus,
    status: () => "Circuit breakers, latency percentiles & incident triage",
  },
  {
    view: "developer",
    code: "API",
    role: "Quant Developer",
    action: "Open Developer →",
    headline: () => "API & Verification",
    status: () => "OpenAPI contract diffs, CI pipeline and launch gates",
  },
];

export default function RoleCards({
  context,
  onNavigate,
}: {
  context: RoleContext;
  onNavigate: (view: WorkspaceView) => void;
  onRun?: () => void;
  running?: boolean;
  researchStale?: boolean;
  onRefreshBook?: () => void;
  bookRefreshing?: boolean;
  onRefreshHealth?: () => void;
}) {
  return (
    <div className="role-grid">
      {ROLE_CARDS.map((card) => (
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
              {card.action}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
