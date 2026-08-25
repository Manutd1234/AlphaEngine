/**
 * Decision thresholds this engine shares with its reference implementation.
 *
 * The gateway's maths exists twice — Python for the server and the Telegram
 * companion, TypeScript for the browser — because neither runtime can call the
 * other, and Python is the reference. A threshold the two disagree about is the
 * worst kind of divergence available here: both sides stay green, both draw a
 * verdict, and they draw different ones for the same book.
 *
 * `coherence-thresholds.test.ts` reads the Python source and asserts the number
 * below is the number there, so the mirror cannot drift quietly.
 */

/**
 * Below this, the programme's optimum is not a trade.
 *
 * `MIN_MEANINGFUL_EDGE` in `modules/coherence/kernel/dutchbook.py`. It is a
 * centicent — the exchange's own smallest price increment — so an "edge" under
 * it is smaller than any price that could express it.
 */
export const MEANINGFUL_EDGE = 0.0001;
