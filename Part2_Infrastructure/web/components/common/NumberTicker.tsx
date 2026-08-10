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
 *    figures from `.num`) so counting never reflows its neighbours. During a
 *    count the wider of the two endpoint strings is reserved, so a value
 *    shrinking in length cannot make the line behind it breathe.
 *
 * Reduced motion renders the final value instantly — the 1ms global contract
 * covers CSS, and this covers the one rAF animation in the system.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

/** Matches --dur-reveal: revelation pace, not interaction pace. */
const DURATION_MS = 420;

export default function NumberTicker({
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
  const previous = useRef<number | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    const fmt = formatRef.current;
    const final = fmt(value);
    if (
      from === null // mount: rule 1
      || from === value
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      cancelAnimationFrame(frame.current);
      setDisplay(final);
      setReserve(final.length);
      return;
    }
    setReserve(Math.max(fmt(from).length, final.length));
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(t < 1 ? fmt(from + (value - from) * eased) : final);
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
