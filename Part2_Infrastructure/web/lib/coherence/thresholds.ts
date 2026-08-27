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

/**
 * Below this many settled markets, the reliability term is mostly noise.
 *
 * `THIN_CORPUS` in `modules/coherence/kernel/calibration.py`. The gateway sets
 * `thin` on a score below it and the desk has drawn that flag since the
 * Scorecard existed — without ever saying what the flag's own threshold is, so
 * a reader could see "thin" and not know whether the corpus was five markets
 * short or forty-five.
 */
export const THIN_CORPUS = 50;

/**
 * Below this many tape forecasts, the scorer falls back to last trades.
 *
 * `MIN_TAPE_FORECASTS` in `modules/coherence/syscalls/calibrate.py`. It is the
 * line between a FORECAST test — prices read at a horizon before close,
 * scored against what happened — and a convergence test, which is not the same
 * measurement and must not be read as one. The Scorecard names which engine
 * ran; this is the number that decides it.
 */
export const MIN_TAPE_FORECASTS = 20;
