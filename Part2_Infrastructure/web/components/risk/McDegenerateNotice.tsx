"use client";

/**
 * The card's refusal to draw a distribution that is not one.
 *
 * Kept out of `MonteCarloDistribution` for the reason every other split in
 * this directory happened: the card is a heading, five controls, a chart and
 * a verdict already, and it sits under the same 400-line ceiling everything
 * else here does. Kept as a COMPONENT rather than a string returned from
 * `mc-degeneracy.ts` because the refusal has a shape — a warning banner, the
 * measurement it is refusing over, and the next step — and that shape must be
 * identical whether the collapse was spotted in the drivers before the run or
 * in the outcomes after it. Two hand-written copies would drift apart, and the
 * post-run one is the rarer path, so it is the one that would rot.
 *
 * What it is deliberately NOT: a dash, an empty card, or a card that renders
 * nothing at all. A panel with nothing to show says so, and says why, with the
 * count it measured. `role="status"` rather than `role="alert"`, because this
 * is a fact about the inputs a reader chose, not an error in the desk.
 */

interface McDegenerateNoticeProps {
  headline: string;
  detail: string;
  /**
   * What was asked for, printed under the refusal so the reader can see the
   * request was honoured and only the answer is missing — the same reason the
   * running state reports its path count rather than a bare spinner.
   */
  asked: string;
  /** Offered only where research is actually the fix — see the call sites. */
  onOpenResearch?: () => void;
}

export default function McDegenerateNotice({
  headline,
  detail,
  asked,
  onOpenResearch,
}: McDegenerateNoticeProps) {
  return (
    <>
      <div className="banner warn" role="status">
        <span aria-hidden>▲</span>
        <div>
          <strong>{headline}</strong> {detail}
        </div>
      </div>
      <p className="muted num mc-degenerate-asked">{asked}</p>
      {onOpenResearch && (
        <button type="button" className="text-action" onClick={onOpenResearch}>
          Open Research
        </button>
      )}
    </>
  );
}
