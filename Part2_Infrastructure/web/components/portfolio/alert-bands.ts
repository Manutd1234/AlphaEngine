/**
 * The utilisations at which Portfolio Overview starts saying something, in one
 * place.
 *
 * They were three literals inside the alert loop and two more on the risk tile.
 * The Standing summary now quotes them back to the reader — "no position has
 * spent 75% of its symbol cap" — and prose repeating a number that lives in a
 * condition is prose that goes wrong the first time the condition is retuned.
 * None of these is a limit: the gateway owns and enforces those. These are the
 * points at which a published limit is close enough to be worth a sentence.
 *
 * A module of its own rather than a const at the top of one pane, because both
 * Overview panes read them: Standing raises the alerts and quotes the bands
 * back in prose, Book tones the risk cross-link tile with two of the same four.
 * A second copy in the second pane is precisely the drift this record exists to
 * end, one file further along.
 */
export const ALERT_BANDS = {
  /** A symbol worth naming. */
  symbolNear: 0.75,
  /** …and the one to make room in first. */
  symbolAtCap: 0.9,
  gross: 0.9,
  /** The gateway's own figure: reduce-only engages here. */
  drawdown: 0.8,
} as const;

/**
 * The drift at which Overview offers the allocation panel.
 *
 * Unlike the bands above this one really is this page's own, so the Standing
 * summary attributes it to the page rather than to the risk desk.
 */
export const DRIFT_PROMPT = 0.05;
