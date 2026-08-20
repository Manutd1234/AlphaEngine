"use client";

/**
 * A number that counts to its new value instead of cutting.
 *
 * Two rules keep this an instrument rather than a slot machine:
 *
 * 1. **It animates only on change, never on mount.** A page counting up from
 *    zero on load is celebration; a value visibly moving because the data
 *    moved is information. The first render — server or client — is the final
 *    string.
 * 2. **It reserves its final width** (`--ticker-w`, in ch, over tabular
 *    figures from `.num`) so counting never reflows its neighbours. The
 *    reservation is a high-water mark: it takes the widest string this ticker
 *    has ever shown and never gives the width back. Reserving only the current
 *    pair of endpoints held the box still *during* a count and then let it
 *    shrink at the end, which is the reflow the reservation exists to prevent —
 *    a decision p99 crossing 100 µs alternates "99.9 µs" with "123 µs", one
 *    character apart, and the header chip breathed once per poll.
 * 3. **A value arriving mid-count is chased from the glyphs on screen**, not
 *    from the value they were counting away from. Restarting at the previous
 *    prop threw the display backwards to where the last count began, so a feed
 *    arriving faster than the 420ms count read as a twitch rather than a
 *    glide. The animation is the same length; only its origin changed.
 *
 * Reduced motion renders the final value instantly — the 1ms global contract
 * covers CSS, and this covers the one rAF animation in the system.
 *
 * Memoised because a fast neighbour should not repaint it: with no `format`
 * prop the comparison is two primitives and the skip is free. A caller that
 * passes an inline formatter defeats the memo — harmlessly, since the effect
 * below keys on `value` alone, so an unchanged value still cannot re-animate.
 */

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";

/** Matches --dur-reveal: revelation pace, not interaction pace. */
const DURATION_MS = 420;

function NumberTicker({
  value,
  format = (v: number) => String(Math.round(v)),
  className,
}: {
  value: number;
  /** Formats every animation frame, so it must accept intermediate values. */
  format?: (value: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(() => format(value));
  const [reserve, setReserve] = useState(() => format(value).length);
  // The formatter is read through a ref so an inline-lambda prop does not
  // retrigger the effect every render; only the value changing animates.
  const formatRef = useRef(format);
  formatRef.current = format;
  /** The last value handed in. Null means nothing has been: that is rule 1. */
  const previous = useRef<number | null>(null);
  /** Where the count has actually reached — the number the glyphs are showing,
   *  which is only the previous value once a count has finished. */
  const position = useRef<number | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const from = previous.current === null ? null : position.current;
    previous.current = value;
    const fmt = formatRef.current;
    const final = fmt(value);
    if (
      from === null // mount: rule 1
      || from === value
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      cancelAnimationFrame(frame.current);
      position.current = value;
      setDisplay(final);
      setReserve((held) => Math.max(held, final.length));
      return;
    }
    setReserve((held) => Math.max(held, fmt(from).length, final.length));
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - (1 - t) ** 3;
      position.current = t < 1 ? from + (value - from) * eased : value;
      setDisplay(t < 1 ? fmt(position.current) : final);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value]);

  return (
    <span
      className={`number-ticker num${className ? ` ${className}` : ""}`}
      style={{ "--ticker-w": `${reserve}ch` } as CSSProperties}
    >
      {display}
    </span>
  );
}

export default memo(NumberTicker);
