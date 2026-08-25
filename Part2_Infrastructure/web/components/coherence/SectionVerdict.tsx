"use client";

/**
 * The band that carries a section's answer, in the same place on all six.
 *
 * WHAT IT FIXES. Every section on this tab computed a chip row and drew it
 * somewhere different: inside the family choice on Coherence test, under the
 * engine figure on the Scorecard, above the switcher on Parlays, inside the
 * pane on the index. So the one thing a reader opens a section FOR — is this
 * family coherent, is anything violated, did these prices score — was in a
 * different place on each of six sections, and on two of them it was below a
 * control row and a figure caption.
 *
 * It is one band now, directly under the head and above the control row, and it
 * does not scroll with the section body. A reader who switches section meets the
 * answer in the position they last met one.
 *
 * IT INVENTS NO STATE AND NO VOCABULARY. Every child is a `StateChip` the
 * section already computed — a mark, a word and a figure — so nothing here
 * means anything by colour alone and no chip changed its wording on the way up.
 * The band is a frame around chips that already existed.
 *
 * THE PENDING BRANCH IS NOT DECORATION. A section whose read has not answered
 * would otherwise render an empty bordered box, and an empty band and a band
 * still loading look identical — one of them means the feed is down. So the
 * caller says which, and this says so in words rather than drawing a frame
 * around nothing. `pending` is "has not answered either way", never the hook's
 * `loading`, which is false until mount and misses the section-switch case.
 */

import type { ReactNode } from "react";

export default function SectionVerdict({
  pending = null,
  children,
}: {
  /**
   * What to say while there is no answer yet, or why there will not be one.
   * Null once the chips below are real.
   */
  pending?: ReactNode;
  /** The section's own `StateChip`s. */
  children?: ReactNode;
}) {
  return (
    <div className="coh-verdict">
      {pending ? <p className="coh-verdict__pending">{pending}</p> : children}
    </div>
  );
}
