"use client";

/**
 * When the next read lands, and the two controls that change it.
 *
 * "we need innovative diagrams and interactive live data"
 *
 * The tab has been live since it was written — every section polls the
 * exchange on a twenty-second `PollingController` — and a reader had no way to
 * know it. `FreshnessStamp` says how OLD the answer is ("21:25:36, 19s ago;
 * every 20 s; polled"), which is the past tense of the same fact and the one a
 * reader can already work out from a clock. What it cannot say is when the
 * NEXT one arrives, and it offers nothing to press.
 *
 * WHAT THIS SAYS THAT THE STAMP DOES NOT, and nothing else, because a claim
 * made twice forty pixels apart is the reading this tab keeps being reported
 * for: the countdown, and the two controls. The interval and the timestamp are
 * the stamp's and stay there.
 *
 * NOTHING HERE ANIMATES. The countdown is a string that changes once a second,
 * which is what `FreshnessStamp` already does beside it and for the same
 * reason — a static "next read in 12s" is exactly the reassurance a stalled
 * screen should not be giving. There is no ring, no sweep and no transition, so
 * `prefers-reduced-motion` has nothing to suppress and the house's motion
 * ladder is untouched.
 *
 * COLOUR SAYS NOTHING ON ITS OWN. Each state carries a mark from the desk's
 * typographic vocabulary AND the words beside it — ● reading, ○ paused, ▲
 * overdue, ◌ nothing yet — so the control reads the same in Windows High
 * Contrast and to a reader who cannot separate red from green.
 *
 * THE STATE IS A `StateChip`, NOT A THIRD GRAMMAR. It was a bare span with a
 * `min-width` in ch, sitting under a row of pills and matching none of them —
 * the reader's "revamp the alignment and formatting". A pill of read-state
 * beside four pills of read-state IS the same object, so it borrows the same
 * component rather than approximating it: the mark, the word and the tone come
 * out identical because they are the same code, and the row above cannot drift
 * away from it in a later pass. The reservation that kept the buttons from
 * shuffling every second goes with the span — a chip's own width is set by its
 * WORD, and the varying part ("in 12s") moved into the chip's `value` slot,
 * which is `nowrap` and ellipses rather than pushing.
 *
 * WHY PAUSE IS NOT A COSMETIC FREEZE. It gates `active`, which every section
 * on the tab already takes and passes to `useCoherenceRead`, which passes it to
 * `usePolling` as `enabled`. A paused tab therefore stops asking Kalshi
 * altogether rather than holding a stale picture over live traffic — which
 * matters here more than on most desks, because these reads spend a token
 * bucket the exchange publishes no budget for.
 */

import { useEffect, useState } from "react";

import { StateChip } from "./Figure";

export interface LiveControlsProps {
  /** When the newest answer landed, or null before the first one. */
  updatedAt: Date | null;
  /** The interval every read on the tab shares. */
  pollMs: number;
  paused: boolean;
  onPause: (next: boolean) => void;
  /** Re-arms the poll gate, which makes every mounted section read again. */
  onReadNow: () => void;
  /** Markets folds Updated + Next read into its explicit second status row. */
  variant?: "default" | "markets";
}

export function marketClockLabel(updatedAt: Date | null): string {
  if (!updatedAt) return "awaiting";
  return [updatedAt.getHours(), updatedAt.getMinutes(), updatedAt.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function marketNextReadState(
  updatedAt: Date | null,
  pollMs: number,
  paused: boolean,
  now: number,
): { mark: string; value: string; tone: "good" | "warn" | "muted" } {
  if (paused) return { mark: "○", value: "paused", tone: "muted" };
  if (!updatedAt) return { mark: "◌", value: "awaiting", tone: "muted" };

  const remaining = pollMs - (now - updatedAt.getTime());
  if (remaining < -pollMs * 0.5) return { mark: "▲", value: "overdue", tone: "warn" };
  if (remaining <= 0) return { mark: "●", value: "now", tone: "good" };
  return { mark: "●", value: `${Math.ceil(remaining / 1000)}s`, tone: "good" };
}

export default function LiveControls({
  updatedAt,
  pollMs,
  paused,
  onPause,
  onReadNow,
  variant = "default",
}: LiveControlsProps) {
  const [, tick] = useState(0);

  // Mounted unconditionally, like the stamp's: the hook has to run on every
  // render whether or not there is an answer yet to count down from.
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const now = Date.now();
  const remaining = updatedAt ? pollMs - (now - updatedAt.getTime()) : null;
  // A read that is DUE is not a read that is late. The gateway's own budget for
  // the live reads on this tab runs to twenty-eight seconds, so a second or two
  // past the interval is the request being answered, not a stall. Overdue is
  // half an interval past due, which is the same threshold the stamp uses to
  // stop pulsing.
  const overdue = remaining != null && remaining < -pollMs * 0.5;

  const state = paused
    ? { mark: "○", word: "Polling paused", value: null, tone: "muted" as const }
    : remaining == null
      ? { mark: "◌", word: "Awaiting the first read", value: null, tone: "muted" as const }
      : overdue
        ? { mark: "▲", word: "Read overdue", value: null, tone: "warn" as const }
        : remaining <= 0
          ? { mark: "●", word: "Reading", value: "now", tone: "good" as const }
          : { mark: "●", word: "Next read", value: `in ${Math.ceil(remaining / 1000)}s`, tone: "good" as const };

  const marketNext = marketNextReadState(updatedAt, pollMs, paused, now);

  return (
    <div
      className={`coh-live${variant === "markets" ? " coh-live--markets" : ""}`}
      role="group"
      aria-label="Polling"
    >
      {variant === "markets" ? (
        <>
          <span className="coh-live__updated">
            <StateChip
              mark={updatedAt ? "✓" : "◌"}
              word="Updated"
              value={marketClockLabel(updatedAt)}
              tone="muted"
            />
          </span>
          <span className="coh-live__next">
            <StateChip mark={marketNext.mark} word="Next read" value={marketNext.value} tone={marketNext.tone} />
          </span>
        </>
      ) : (
        <StateChip mark={state.mark} word={state.word} value={state.value} tone={state.tone} />
      )}
      {/* The two controls, as one segmented pair rather than two loose buttons.
          They are the same KIND of thing — both change what the poll does next —
          and the desk's own vocabulary for that is a group, not a scatter. */}
      <div className="coh-live__controls">
        <button type="button" onClick={onReadNow}>Read now</button>
        <button type="button" aria-pressed={paused} onClick={() => onPause(!paused)}>
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
    </div>
  );
}
