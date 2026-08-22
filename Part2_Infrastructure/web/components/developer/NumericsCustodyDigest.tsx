"use client";

/**
 * The digest itself, made readable, and the one hook that computes one.
 *
 * WHAT THIS REPLACES, and why a new file was worth it. The numerics custody
 * card reported its whole result as a status pill reading
 * `Byte-exact — … sha256 009be58f34bb…`. Twelve of sixty-four characters, in a
 * pill sized for a word, is not a digest a reader can check: it is a claim that
 * a digest exists. Two digests agreeing on their first twelve hex characters is
 * a one-in-2^48 coincidence, so the prefix is not *wrong* — but the reader
 * cannot do the comparison, only believe the sentence that says it was done.
 * The point of a custody surface is that it can be checked rather than trusted.
 *
 * So the full sixty-four characters are printed, in the tabular mono of
 * `.num`, as ONE CONTIGUOUS VALUE. A first cut grouped it in eights at
 * --fs-h1, and a reader told us what that renders as to anyone who does not
 * live in `sha256sum` output: eight separate seven-or-eight-digit codes, twice
 * over, and no idea which of them is "the" SHA. One unbroken run at body-mono
 * size is what a hash looks like everywhere else a reader meets one — a
 * lockfile, a git log, a checksum file — and it selects and pastes as exactly
 * the sixty-four characters on screen. The caption above it says what it is;
 * `overflow-wrap: anywhere` lets it wrap on a narrow card instead of forcing a
 * sideways scroll, since a hash has no whitespace to break at.
 *
 * No CSS was added for any of this. This file does not own the stylesheet, and
 * the layout that matters is expressed inline; the type sizes are read from the
 * ladder (`var(--fs-*)`), never as literals.
 */

import { useEffect, useState, type CSSProperties } from "react";

/**
 * What is known about one digest.
 *
 * `unrequested` and `unavailable` are separate members on purpose, and the
 * separation is the same one the readiness ladder makes between a gate that has
 * not run and a gate that could not run. Nobody has pressed the button yet is
 * not the same fact as this browser exposes no Web Crypto digest, and a single
 * "no digest" state would let the panel print one reason for both.
 */
export type DigestReading =
  | { state: "unrequested"; why: string }
  | { state: "computing" }
  | { state: "computed"; hex: string }
  | { state: "unavailable"; why: string };

/** Bytes to lower-case hex, the spelling every other leg of this claim uses. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 of `text` in this browser, through Web Crypto and nothing else.
 *
 * NO NEW DEPENDENCY, which is a hard rule here, and no hand-rolled SHA-256
 * either: a hash function written for a UI panel is a second implementation of
 * the very thing the panel exists to check, and it would agree with itself
 * whatever the platform did. `crypto.subtle` is the platform's, and where it is
 * missing this returns `unavailable` with the reason rather than a substitute.
 *
 * `crypto.subtle` is undefined on an insecure origin — plain http on a hostname
 * that is not localhost — which is a real configuration, not a hypothetical, so
 * the caller gets a named absence and the panel dashes the row and says why.
 */
export function useSha256(text: string | null, unrequestedWhy: string): DigestReading {
  const [reading, setReading] = useState<DigestReading>({ state: "unrequested", why: unrequestedWhy });

  useEffect(() => {
    if (text === null) {
      setReading({ state: "unrequested", why: unrequestedWhy });
      return;
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      setReading({
        state: "unavailable",
        why: "This context exposes no Web Crypto digest, so no hash was computed here. The byte comparison above still ran.",
      });
      return;
    }
    let cancelled = false;
    setReading({ state: "computing" });
    subtle
      .digest("SHA-256", new TextEncoder().encode(text))
      .then((buffer) => {
        if (!cancelled) setReading({ state: "computed", hex: toHex(buffer) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const reason = error instanceof Error ? error.message : String(error);
        setReading({ state: "unavailable", why: `The Web Crypto digest call failed: ${reason}` });
      });
    return () => {
      cancelled = true;
    };
  }, [text, unrequestedWhy]);

  return reading;
}

/** The hex of a reading that produced one; null for every reading that did not. */
export function digestHex(reading: DigestReading): string | null {
  return reading.state === "computed" ? reading.hex : null;
}

/** The sentence a reading carries when it has no hex to show. */
export function digestAbsenceReason(reading: DigestReading): string | null {
  if (reading.state === "computing") return "Hashing the bytes this run produced…";
  if (reading.state === "unrequested" || reading.state === "unavailable") return reading.why;
  return null;
}

/**
 * The index of the first character at which two digests part company.
 *
 * Printed as a number rather than shown as a colour, because a colour is the
 * one thing a reader with forced colours, a monochrome screen or a colour
 * deficiency does not receive — and because "differs from character 3" is a
 * more useful sentence than a red patch anyway.
 */
export function firstDifference(a: string, b: string): number | null {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) if (a[index] !== b[index]) return index + 1;
  return a.length === b.length ? null : shared + 1;
}

const DIGEST_STYLE: CSSProperties = {
  display: "block",
  marginTop: "6px",
  fontSize: "var(--fs-md)",
  fontWeight: 600,
  lineHeight: "var(--lh-snug)",
  maxWidth: "100%",
  /* `anywhere` is what allows a wrap at all — a hash has no whitespace. */
  overflowWrap: "anywhere",
};

const CAPTION_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "10px",
  flexWrap: "wrap",
};

/**
 * One digest row: what it is, what it says, and the verdict beside it.
 *
 * `hex` is null for every reading that produced no digest, and the row then
 * prints an em dash and the reason. That is the house rule about a missing
 * measurement doing its work in the one place a reader is most tempted to
 * assume a blank means zero trouble.
 */
export function CustodyDigestRow({
  caption,
  hex,
  note,
  glyph,
  word,
  tint,
}: {
  caption: string;
  hex: string | null;
  note: string;
  glyph: string;
  word: string;
  /** A colour token. The glyph and the word carry the state; this only tints it. */
  tint: string;
}) {
  return (
    <div style={{ marginTop: "10px" }}>
      <div style={CAPTION_STYLE}>
        <span className="signal-workflow__step">{caption}</span>
        <strong style={{ color: tint, fontSize: "var(--fs-sm)", fontWeight: 750 }}>
          <span aria-hidden>{glyph}</span> {word}
        </strong>
      </div>
      {hex === null ? (
        <p className="signal-workflow__source" style={{ marginTop: "4px" }}>
          <span aria-hidden>—</span> {note}
        </p>
      ) : (
        <>
          {/* One contiguous value: it selects, copies and greps as the
              sixty-four characters on screen, and reads as one hash rather
              than a stack of short codes. */}
          <code className="num" title={hex} style={DIGEST_STYLE}>
            {hex}
          </code>
          <p className="signal-workflow__source" style={{ marginTop: "4px" }}>
            {note}
          </p>
        </>
      )}
    </div>
  );
}
