import PageHead, { type PageMetric, type PageStatus } from "@/components/workspace/PageHead";

interface WorkspaceInsight {
  label: string;
  value: string;
  detail?: string;
  tone?: "good" | "warn" | "critical" | "accent";
  mono?: boolean;
}

interface WorkspaceIntroProps {
  kicker: string;
  title: string;
  description: React.ReactNode;
  insights: WorkspaceInsight[];
  /** The one-word verdict, when the surface has one. */
  status?: PageStatus | null;
  /** Controls that belong to the surface as a whole (refresh, source switch). */
  actions?: React.ReactNode;
}

/**
 * The desk-role brief at the top of a workspace.
 *
 * This is now a thin adapter over `PageHead`, which every one of the eight tabs
 * renders — including the three consoles that used to draw their own status
 * bars. Keeping the older `insights` vocabulary here means the role tabs did not
 * all have to be rewritten to gain the shared header.
 */
export default function WorkspaceIntro({
  kicker,
  title,
  description,
  insights,
  status = null,
  actions,
}: WorkspaceIntroProps) {
  const metrics: PageMetric[] = insights.map((insight) => ({
    label: insight.label,
    value: insight.value,
    note: insight.detail,
    tone: insight.tone,
    /* Off by default, where PageHead's own default is on. That reads like
       drift and is not: the values reaching this adapter are mostly verdict
       words — "Halted", "Sandbox", "Measured", "Paper only" — and `.num` sets
       the mono family, so defaulting it on would set those words in monospace.
       The call sites that hold figures (Positions, Instrument, Intent) opt in
       explicitly. PageHead's direct callers default the other way because
       their values are mostly figures. Two vocabularies, one component. */
    mono: insight.mono ?? false,
  }));

  return (
    <PageHead
      kicker={kicker}
      title={title}
      description={description}
      metrics={metrics}
      status={status}
      actions={actions}
    />
  );
}
