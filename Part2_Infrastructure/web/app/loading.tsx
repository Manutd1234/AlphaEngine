export default function Loading() {
  return (
    <main className="auth-shell" aria-busy="true">
      <p className="console-empty" role="status">
        <span aria-hidden="true">◌</span>
        Opening AlphaEngine…
      </p>
    </main>
  );
}
