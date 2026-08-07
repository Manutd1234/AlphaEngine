import PageHead, { type PageMetric } from "@/components/workspace/PageHead";

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
  actions,
}: WorkspaceIntroProps) {
  const metrics: PageMetric[] = insights.map((insight) => ({
    label: insight.label,
    value: insight.value,
    note: insight.detail,
    tone: insight.tone,
    mono: insight.mono ?? false,
  }));

  return (
    <PageHead
      kicker={kicker}
      title={title}
      description={description}
      metrics={metrics}
      actions={actions}
    />
  );
}
