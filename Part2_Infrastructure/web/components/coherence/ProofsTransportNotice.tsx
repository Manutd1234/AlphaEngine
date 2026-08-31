"use client";

/** A bounded, correlated failure state for one Proofs gateway read. */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import WorkspaceEntityLink from "@/components/workspace/WorkspaceEntityLink";
import { secondsLabel } from "@/lib/coherence/decimals";
import type { CoherenceTransportMeta } from "@/lib/coherence/transport-state";
import { nextRetryReading } from "@/lib/coherence/transport-state";

export default function ProofsTransportNotice({
  error,
  hasSnapshot,
  transport,
  retryAt,
  consecutiveFailures,
  onRetry,
  subject = "Live read",
}: {
  error: string | null;
  hasSnapshot: boolean;
  transport: CoherenceTransportMeta | null;
  retryAt: Date | null;
  consecutiveFailures: number;
  onRetry: () => void;
  subject?: string;
}) {
  if (!error) return null;
  const state = hasSnapshot ? "stale" : "unavailable";
  const retry = nextRetryReading(retryAt, consecutiveFailures);
  const deadline = transport ? `≤ ${secondsLabel(transport.deadlineMs / 1000)}` : "bounded";

  return (
    <Alert
      variant={hasSnapshot ? "default" : "destructive"}
      className="proofs-transport"
      data-state={state}
    >
      <span className="proofs-transport__mark" aria-hidden="true">
        {hasSnapshot ? "▲" : "✕"}
      </span>
      <AlertTitle>
        {subject} {hasSnapshot ? "stale — last good snapshot retained" : "unavailable"}
      </AlertTitle>
      <AlertDescription>
        <p>{error}</p>
        {transport?.hint ? <p>{transport.hint}</p> : null}
        <dl className="proofs-transport__telemetry">
          <div className="proofs-transport__status is-budget">
            <dt>Budget</dt>
            <dd>{transport?.endpointClass ?? "browser"} / {deadline}</dd>
          </div>
          <div className="proofs-transport__status is-retry">
            <dt>Retry</dt>
            <dd>{retry ?? "manual"}</dd>
          </div>
        </dl>
        <dl className="proofs-transport__facts">
          <div>
            <dt>Correlation</dt>
            <dd>{transport?.requestId ? (
              <WorkspaceEntityLink kind="trace" value={transport.requestId}>
                <code>{transport.requestId}</code>
              </WorkspaceEntityLink>
            ) : <code>not returned</code>}</dd>
          </div>
          {transport?.code ? (
            <div>
              <dt>Failure</dt>
              <dd><code>{transport.code}</code></dd>
            </div>
          ) : null}
        </dl>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry now
        </Button>
      </AlertDescription>
    </Alert>
  );
}
