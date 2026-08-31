"use client";

import type { ReactNode } from "react";

/**
 * The one page header every workspace uses.
 *
 * Before this existed the eight tabs opened five different ways: the overview
 * had a navy hero, Research/Execution/Portfolio/Risk had `.page-heading`, Data
 * had `.data-cp-bar`, and Reliability and Developer had `.console-statusbar`.
 * Each carried the same four things — who the surface is for, what it answers,
 * the handful of numbers that frame the answer, and the controls that refresh
 * them — in four different visual grammars, so moving between tabs meant
 * re-learning where to look.
 *
 * Everything here is one row of meaning: identity on the left, the metrics that
 * frame it on the right, controls after them. A tab that needs a status word
 * (Data's trust state) passes `status`; a tab that needs a refresh control
 * passes `actions`. Nothing else is negotiable, which is the point.
 */

export type MetricTone = "good" | "warn" | "critical" | "accent" | "neutral";

export interface PageMetric {
  label: string;
  value: ReactNode;
  /** The supporting line. Always the provenance of the value, never a repeat. */
  note?: ReactNode;
  /**
   * A compact sparkline beside the note. Keep it at or under 26px tall so the
   * context strip remains easy to scan without suppressing the provenance.
   */
  spark?: ReactNode;
  tone?: MetricTone;
  /** Tabular figures. On by default — most of these are numbers. */
  mono?: boolean;
  /** Makes the context cell actionable. `actionLabel` becomes its accessible name. */
  onClick?: () => void;
  actionLabel?: string;
  /** A wider desktop track for a label that must remain a single line. */
  wide?: boolean;
}

export interface PageStatus {
  label: string;
  tone: "good" | "warn" | "critical" | "neutral";
}

const STATUS_GLYPH: Record<PageStatus["tone"], string> = {
  good: "●",
  warn: "▲",
  critical: "✕",
  neutral: "◌",
};

export interface PageHeadProps {
  /** The desk role this surface belongs to. */
  kicker: string;
  title: string;
  /** One sentence: the question this tab answers. */
  description?: ReactNode;
  /** False when the route tab already names the page (Risk, Execution, etc.). */
  showTitle?: boolean;
  metrics?: PageMetric[];
  status?: PageStatus | null;
  actions?: ReactNode;
  /** Rendered under the head, above the section rail — banners and notices. */
  children?: ReactNode;
}

function Metric({ metric }: { metric: PageMetric }) {
  const mono = metric.mono ?? true;
  const valueText = typeof metric.value === "string" || typeof metric.value === "number" ? metric.value : "";
  return (
    <div className={`page-insight page-context-strip__item is-${metric.tone ?? "neutral"}${metric.onClick ? " is-action" : ""}${metric.wide ? " is-wide" : ""}`}>
      <dt className="page-context-strip__label">{metric.label}</dt>
      <dd className="page-context-strip__value">
        <strong className={mono ? "num" : undefined}>{metric.value}</strong>
      </dd>
      {metric.note || metric.spark ? (
        <dd className="page-context-strip__note">
          {metric.note ? (
            <details className="page-context-strip__provenance">
              <summary aria-label={metric.label}>?</summary>
              <span>{metric.note}</span>
            </details>
          ) : null}
          {metric.spark ? <span className="page-insight__spark">{metric.spark}</span> : null}
        </dd>
      ) : null}
      {metric.onClick ? (
        <dd className="page-context-strip__interaction">
          <button
            type="button"
            className="page-context-strip__action"
            onClick={metric.onClick}
            aria-label={`${metric.actionLabel ?? "Open details"}. ${metric.label}: ${valueText}`}
          >
            {metric.actionLabel ? <em>{metric.actionLabel} →</em> : null}
          </button>
        </dd>
      ) : null}
    </div>
  );
}

export default function PageHead({
  kicker,
  title,
  description,
  showTitle = true,
  metrics = [],
  status = null,
  actions,
  children,
}: PageHeadProps) {
  return (
    <>
      <header className="page-heading" aria-label={`${title} context`}>
        <div className={`page-heading__copy${showTitle ? "" : " is-role-only"}`}>
          {showTitle ? (
            <>
              <span className="page-kicker">{kicker}</span>
              <h1>{title}</h1>
            </>
          ) : (
            <h1 className="page-role-title">{kicker}</h1>
          )}
          {description ? <p>{description}</p> : null}
        </div>

        {(metrics.length > 0 || status || actions) && (
          <div className="page-heading__context">
            {metrics.length > 0 && (
              <dl
                className="page-heading__insights page-context-strip"
                data-count={metrics.length}
                aria-label={`${title} decision context`}
              >
                {metrics.map((metric) => (
                  <Metric key={metric.label} metric={metric} />
                ))}
              </dl>
            )}
            {(status || actions) && (
              <div className="page-heading__actions">
                {status && (
                  <span className={`page-status is-${status.tone}`} role="status">
                    <span aria-hidden>{STATUS_GLYPH[status.tone]}</span>
                    {status.label}
                  </span>
                )}
                {actions}
              </div>
            )}
          </div>
        )}
      </header>
      {children}
    </>
  );
}
