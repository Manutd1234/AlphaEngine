import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-shell">
      <section className="card console-card" aria-labelledby="not-found-heading">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Not found</span>
            <h1 id="not-found-heading">This workspace route does not exist</h1>
          </div>
        </div>
        <p className="console-empty">
          <span aria-hidden="true">○</span>
          Return to the guarded dashboard and choose an addressable section.
        </p>
        <Link className="primary-action" href="/dashboard">Open dashboard</Link>
      </section>
    </main>
  );
}
