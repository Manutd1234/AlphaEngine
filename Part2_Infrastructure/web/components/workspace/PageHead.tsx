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
   * A sparkline beside the note. It rides in the note's reserved two-line slot
   * rather than under it, so a chip that carries one is exactly as tall as a
   * chip that does not — the header's height contract does not bend for it.
   * Keep it at or under 26px tall for that to hold.
   */
  spark?: ReactNode;
  tone?: MetricTone;
  /** Tabular figures. On by default — most of these are numbers. */
  mono?: boolean;
  /** Makes the chip a button. `actionLabel` becomes its accessible name. */
  onClick?: () => void;
  actionLabel?: string;
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
  metrics?: PageMetric[];
  status?: PageStatus | null;
  actions?: ReactNode;
  /** Rendered under the head, above the section rail — banners and notices. */
  children?: ReactNode;
}

function Metric({ metric }: { metric: PageMetric }) {
  const mono = metric.mono ?? true;
  const body = (
    <>
      {/* The label stays on one line — it is what makes the chip's height a
          constant, and letting it wrap would put the eight headers out of
          alignment again the moment one tab's label was longer. So it carries
          its own text instead: at 768px "Books within freshness budget" loses
          85px to the ellipsis, and this is what gets it back. */}
      <span title={metric.label}>{metric.label}</span>
      {/* Same one-line rule as the label, same reason, and the loss is worse
          here because this is the figure itself: at 768px "Moving-average
          crossover" gives up 40px and Developer's repository name 57px. The
          value carries its own text so the ellipsis is never the last word. */}
      <strong
        className={mono ? "num" : undefined}
        title={typeof metric.value === "string" || typeof metric.value === "number" ? String(metric.value) : undefined}
      >
        {metric.value}
      </strong>
      {/* The note is clamped to two lines in CSS, so a long one is clipped. A
          clipped provenance line is the half a reader checks when a number
          looks wrong, and losing its tail silently is the worst way to lose
          it — Reliability's trading-path reason is a full sentence when the
          gateway is misconfigured. Carrying the string as `title` keeps the
          rest one hover away rather than gone. */}
      {metric.note || metric.spark ? (
        <small>
          <span title={typeof metric.note === "string" ? metric.note : undefined}>{metric.note}</span>
          {metric.spark ? <span className="page-insight__spark">{metric.spark}</span> : null}
        </small>
      ) : null}
    </>
  );
  const className = `page-insight is-${metric.tone ?? "neutral"}`;

  if (!metric.onClick) {
    return <div className={className}>{body}</div>;
  }
  return (
    <button
      type="button"
      className={`${className} is-action`}
      onClick={metric.onClick}
      aria-label={`${metric.actionLabel ?? "Open details"}. ${metric.label}: ${
        typeof metric.value === "string" || typeof metric.value === "number" ? metric.value : ""
      }`}
    >
      {body}
      {metric.actionLabel ? <em>{metric.actionLabel} →</em> : null}
    </button>
  );
}

export default function PageHead({
  kicker,
  title,
  description,
  metrics = [],
  status = null,
  actions,
  children,
}: PageHeadProps) {
  return (
    <>
      <header className="page-heading" aria-label={`${title} context`}>
        <div className="page-heading__copy">
          <span className="page-kicker">{kicker}</span>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>

        {(metrics.length > 0 || status || actions) && (
          <div className="page-heading__context">
            {metrics.length > 0 && (
              <div
                className="page-heading__insights"
                data-count={metrics.length}
                aria-label={`${title} decision context`}
              >
                {metrics.map((metric) => (
                  <Metric key={metric.label} metric={metric} />
                ))}
              </div>
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
