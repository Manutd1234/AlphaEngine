"use client";

/**
 * The head every section of Markets and Coherence opens with.
 *
 * The desk has one grammar for the first thing under a subtab rail, and these
 * two tabs were the only ones not speaking it. Measured over Chrome across all
 * 59 rail sections: on the other eight tabs that heading is an `<h2>` at
 * 20.5px, weight 700, inside a `.section-heading` block with a kicker above it;
 * on this engine it was a bare `<h4>` at 15.5px with nothing around it, and on
 * most sections there was no heading at all — the pane simply started.
 *
 * That is not a style preference. `panel-heading-rung.test.ts` records the same
 * complaint reported five times: switching subtab moved the first thing under
 * the rail, and four passes looked at the BUTTON before someone measured the
 * heading. Four rungs is a much larger move than the four pixels that started
 * it.
 *
 * So the markup here is the same markup those sixty surfaces write inline —
 * `.section-heading.compact`, a `.page-kicker`, an `<h2>` carrying the id the
 * card is labelled by, a `.section-note` on the right — and the rung it
 * resolves to is the "card title" role in `type-role-map.test.ts`, declared
 * once in the standardisation layer and never restated here.
 *
 * A component rather than eleven copies, unlike the rest of the desk, and for a
 * reason this engine has: its sections are ELEVEN views of one argument across
 * two tabs, so "the same" has to be literally true rather than maintained. It
 * also gives `coherence-pane-head.test.ts` one thing to assert against.
 *
 * `note` is for what this read cost or covered — a count, a source, a
 * freshness. Never a second sentence of explanation: that is what `lede` is,
 * and a head with two sentences in it is a paragraph wearing a heading's
 * clothes.
 */

import { type ReactNode } from "react";

export interface PaneHeadProps {
  /** The rail's own word for this section, in the kicker slot. */
  kicker: string;
  /**
   * A noun phrase, not a sentence. It sits at the desk's card-title rung.
   *
   * Plain text, so write "&" and never "&amp;": this is a string PROP, not JSX
   * text, and an entity here renders as its five characters. The inline
   * `.section-heading` blocks elsewhere on the desk ARE JSX text and correctly
   * write the entity, which is exactly the trap.
   */
  title: string;
  /** The DOM id the card is labelled by; also the heading's id. */
  id: string;
  /** What this read covered or cost, right-aligned. A fragment, never prose. */
  note?: ReactNode;
  /** One sentence under the head. The only prose a section opens with. */
  lede?: ReactNode;
}

export default function PaneHead({ kicker, title, id, note, lede }: PaneHeadProps) {
  return (
    <>
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">{kicker}</span>
          <h2 id={id}>{title}</h2>
        </div>
        {note ? <span className="section-note">{note}</span> : null}
      </div>
      {lede ? <p className="sub">{lede}</p> : null}
    </>
  );
}

/**
 * The head plus an empty state, for a section that has nothing to draw yet.
 *
 * A section with no data used to return its `.console-empty` line and nothing
 * else, so the heading, the kicker and the lede all disappeared exactly when a
 * reader most needed to know which section they were standing in. Measured over
 * Chrome, four of the eleven were in that state on a cold watchlist and the
 * audit read them as sections with no heading at all — which, at that moment,
 * they were.
 *
 * The other eight tabs do not do this: their heads are outside the branch that
 * decides whether the panel has anything. This is that shape, made reusable so
 * the eleven cannot drift apart again.
 */
export function PaneHeadEmpty({ head, mark, children }: {
  head: PaneHeadProps;
  /** The status vocabulary's own mark — ◌ waiting, ○ absent, ✕ failed. */
  mark: string;
  children: ReactNode;
}) {
  return (
    <>
      <PaneHead {...head} />
      <p className="console-empty">
        <span aria-hidden="true">{mark}</span> {children}
      </p>
    </>
  );
}
