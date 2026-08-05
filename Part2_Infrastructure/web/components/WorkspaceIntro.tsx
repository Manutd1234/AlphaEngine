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
}

/**
 * A compact brief at the top of each desk surface.
 *
 * The title explains the role's question; the right side carries only the
 * shared facts needed to answer it. Keeping this one component across all tabs
 * prevents Research, Risk and Operations from inventing three different visual
 * grammars for the same instrument and system state.
 */
export default function WorkspaceIntro({
  kicker,
  title,
  description,
  insights,
}: WorkspaceIntroProps) {
  return (
    <div className="page-heading">
      <div className="page-heading__copy">
        <span className="page-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>

      <div className="page-heading__insights" aria-label={`${title} decision context`}>
        {insights.map((insight) => (
          <div
            className={`page-insight${insight.tone ? ` is-${insight.tone}` : ""}`}
            key={insight.label}
          >
            <span>{insight.label}</span>
            <strong className={insight.mono ? "num" : undefined}>{insight.value}</strong>
            {insight.detail ? <small>{insight.detail}</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
