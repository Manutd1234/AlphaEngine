/**
 * One tile per dependency, in one geometry, tinted by what is actually known.
 *
 * IDENTICAL GEOMETRY IS THE POINT. A brand mark and a house lettermark have to
 * read as members of one strip, or the eye sorts the row by tile shape instead
 * of by service. So the tile is a fixed box and the mark inside is fitted to it
 * — each vendor path keeps its NATIVE `viewBox` and the browser scales it,
 * rather than a dozen paths being hand-normalised into one 24×24 space, which
 * is where optical-weight bugs come from.
 *
 * STATE CHANGES THE MARK, and this is the honesty requirement rather than a
 * decoration. A crisp mark beside a component that is switched off implies a
 * connection that does not exist — so `absent` draws a hollow dashed tile,
 * reusing the idiom `.legend i.is-withheld` already established: a hollow
 * swatch and a filled one are the difference between zero and unknown.
 *
 * NEUTRAL AT `ok`. A healthy tile is `--text-secondary`, not green. Eight green
 * marks are noise, they spend the colour budget on the rows that need no
 * attention, and tinting a vendor's mark green is the recolouring brand
 * guidelines most consistently prohibit. Colour here is reserved for the three
 * states that want a reader to look.
 *
 * `fill="currentColor"` throughout: forced-colours sets `color: CanvasText` on
 * `.card svg`, so the mark follows the user's ink with no exemption and the
 * high-contrast allow-list stays at the one rule it permits.
 */

import { DEPENDENCY_WORD, type DependencyHealth } from "@/lib/dependency-graph";
import { markFor } from "@/lib/tech-marks";

export default function TechMark({
  nodeId,
  label,
  state,
  backendHint,
  size = "md",
}: {
  nodeId: string;
  label: string;
  state: DependencyHealth;
  backendHint?: string | null;
  /** `sm` sits in a tree row; `md` sits in the strip. */
  size?: "sm" | "md";
}) {
  const mark = markFor(nodeId, label, backendHint);

  return (
    <span className={`tech-mark tech-mark--${size}`} data-state={state} title={`${mark.name} — ${DEPENDENCY_WORD[state]}`}>
      {mark.kind === "path" ? (
        <svg viewBox={mark.viewBox} aria-hidden focusable="false">
          <path d={mark.d} fill="currentColor" />
        </svg>
      ) : (
        <span className="tech-mark__letters" aria-hidden>{mark.letters}</span>
      )}
      {/* The tile never carries meaning alone: the name and the state word are
          available to a screen reader on every mark. */}
      <span className="sr-only">{mark.name} — {DEPENDENCY_WORD[state]}</span>
    </span>
  );
}
