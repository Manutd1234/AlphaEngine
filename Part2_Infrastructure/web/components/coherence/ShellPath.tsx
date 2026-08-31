"use client";

/**
 * The venue's path grammar: what a path IS, and the control that walks it.
 *
 * Split out of `ShellPane` on 2026-08-25 when the shared section frame took
 * that file past the 400-line ceiling. The house rule is to SPLIT rather than
 * to shave prose, and this is the seam the file already had: everything here
 * is a property of the PATH — its shape, what each depth means, how a reader
 * moves between them — and none of it touches a read, a view or a payload.
 *
 * The grammar is fixed and that is what makes the rest possible:
 * `/shards/<n>/<series>/<event>/<name>`. A segment is one of the venue's own
 * names and carries no kind of its own, so depth is the only thing that can
 * say whether `0` is a shard, a series or a ticker.
 */

/**
 * What the path a reader is standing on IS, in words.
 *
 * The breadcrumb says `/ shards / 0 / KXBTCD` and a reader who has not read the
 * Map cannot tell whether `0` is a shard, a series or a ticker — the segments
 * are the venue's own names and none of them carries its own kind. Depth does,
 * because the grammar is fixed: `/shards/<n>/<series>/<event>/<name>`.
 *
 * Written out rather than indexed off a list so the last entry can say what it
 * says: below an event the names are the five derived readings, and a reader
 * who has arrived there is looking at a computed file rather than at anything
 * the exchange published.
 */
export const LEVEL: readonly string[] = [
  "the watched universe",
  "every exchange instance the watchlist touches",
  "one exchange instance, and one collateral pool",
  "one series",
  "one event, and the readings derived from it",
  "one derived reading",
];

export function levelOf(path: string): string {
  const depth = segmentsOf(path).length;
  return LEVEL[Math.min(depth, LEVEL.length - 1)];
}

export function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function pathOf(segments: string[]): string {
  return `/${segments.join("/")}`;
}

export function Breadcrumb({
  path,
  command,
  onNavigate,
}: {
  path: string;
  command: string;
  onNavigate: (next: string) => void;
}) {
  const segments = segmentsOf(path);
  // The final segment names the current location for both commands. Ancestors
  // navigate; the current folder or file is a label rather than a redundant
  // request for the answer already on screen.
  const last = segments.length - 1;
  return (
    <nav className="coh-shell__crumbs" aria-label={`${command} current path`}>
      <button
        type="button"
        className="coh-shell__crumb"
        aria-current={segments.length === 0 ? "location" : undefined}
        onClick={() => onNavigate("/")}
      >
        /
      </button>
      {segments.length > 2 ? <span className="coh-shell__ellipsis" aria-hidden="true">…</span> : null}
      {segments.map((segment, index) =>
        index === last ? (
          <span key={`${segment}-${index}`} className="coh-shell__crumb is-current" aria-current="location">
            {segment}
          </span>
        ) : (
          <button
            key={`${segment}-${index}`}
            type="button"
            className="coh-shell__crumb"
            onClick={() => onNavigate(pathOf(segments.slice(0, index + 1)))}
          >
            {segment}
          </button>
        ),
      )}
    </nav>
  );
}
