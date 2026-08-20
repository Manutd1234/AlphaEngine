"use client";

import { useEffect, useState } from "react";

/**
 * How old the snapshot on screen is.
 *
 * A refresh control with no timestamp beside it cannot answer the only question
 * it raises — whether what you are looking at is already current. An absolute
 * time alone does not answer it either: reading "09:04:03" means doing the
 * subtraction yourself against a clock you cannot see. So both are shown, and
 * the relative half ticks on its own rather than waiting for the next poll,
 * because between polls a static "0s ago" is exactly the reassurance a stale
 * screen should not be giving.
 */
export default function FreshnessStamp({
  updatedAt,
  pollMs,
  paused = false,
  label = "Updated",
  transport,
}: {
  updatedAt: Date | null;
  /** Poll interval, so the reader knows when the next refresh is due. */
  pollMs?: number | null;
  paused?: boolean;
  label?: string;
  /**
   * How this snapshot actually arrived, when the surface knows.
   *
   * The gateway stream and the poll underneath it deliver the same numbers at
   * very different latencies — about a second against up to fifteen. A reader
   * looking at a figure has no way to tell which one brought it, so a desk
   * running on the fallback looks exactly like a desk running live. Saying
   * which is the whole point of H9: the stream must not imply a freshness it
   * has stopped delivering.
   */
  transport?: "stream" | "poll" | null;
}) {
  const [, tick] = useState(0);

  // One shared second-hand. Mounted unconditionally: the hook has to run on
  // every render whether or not there is a snapshot yet.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!updatedAt) {
    return <span className="freshness-stamp is-waiting">Awaiting first snapshot</span>;
  }

  const seconds = Math.max(0, Math.round((Date.now() - updatedAt.getTime()) / 1000));
  const ago = seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : `${Math.floor(seconds / 3600)}h ago`;

  // Amber once the snapshot has outlived its own poll interval by half again:
  // at that point a refresh was expected and did not land.
  const overdue = Boolean(pollMs) && !paused && seconds * 1000 > pollMs! * 1.5;

  return (
    <span className={`freshness-stamp${overdue ? " is-overdue" : ""}`}>
      {/* The dot pulses only while the poll is genuinely running on time —
          paused or overdue, it rests. Decoration: the words beside it carry
          the state. */}
      <i aria-hidden className={!paused && !overdue ? "pulse-live" : undefined} />
      <span>
        {label} <strong className="num">{updatedAt.toLocaleTimeString()}</strong>
      </span>
      <small className="num">
        {ago}
        {paused ? "; polling paused" : pollMs ? `; every ${Math.round(pollMs / 1000)} s` : ""}
        {/* Words, never the dot alone: the pulse already means "on time", and
            a second meaning on one mark is colour-only meaning wearing a
            shape. */}
        {transport === "stream" ? "; live-pushed" : transport === "poll" ? "; polled" : ""}
      </small>
    </span>
  );
}
