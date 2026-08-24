"use client";

/**
 * The truncation convention, written once for the two sections that print cut
 * decimals.
 *
 * `SurfacePane` carried this sentence for both halves of the lattice while they
 * were one section. The fifth restructure of 2026-08-24 divided them — Lattice
 * reads `/surface`, Stake reads `/stake` — and both still print numbers that
 * `decimalLabel` cut: a standard deviation arrives with 27 places and a Kelly
 * fraction with 18, and every one of those is truncated rather than rounded so
 * the last place is exact.
 *
 * A COMPONENT RATHER THAN A COPY IN EACH SECTION, and the reason is the guard
 * as much as the reader. `coherence-reading-claims.test.ts` counts OCCURRENCES
 * of a pinned phrase across the files it scans, and "truncated, never rounded"
 * is pinned at exactly one. Two sections that each spelled the sentence out
 * would be two occurrences of a claim that is true once; one component rendered
 * by two sections that never appear together is one occurrence, and a reader on
 * either section still meets it.
 *
 * The other half of the old note — that a solver fed the market's own mids
 * returns "stake nothing" — did NOT come with it. That is a claim about the
 * solver, so it stays on the section that runs one.
 */

export default function TruncationNote() {
  return (
    <p className="coh-surface__moments-note">
      <span aria-hidden="true">◌</span> Values are truncated, never rounded: an ellipsis means digits were cut.
    </p>
  );
}
