"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="auth-shell">
      <section className="card console-card" aria-labelledby="workspace-error-heading">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Workspace recovery</span>
            <h1 id="workspace-error-heading">This view could not be rendered</h1>
          </div>
        </div>
        <p className="console-empty">
          <span aria-hidden="true">✕</span>
          The current route failed before it could show a truthful result. Retry the render; live reads will re-arm safely.
        </p>
        <Button type="button" onClick={reset}>Retry view</Button>
      </section>
    </main>
  );
}
