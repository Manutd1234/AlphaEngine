"use client";

/**
 * The head every section of the Kalshi engine opens with, on both its tabs.
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
 * A component rather than nine copies, unlike the rest of the desk, and for a
 * reason this engine has: its sections are NINE views of one argument split
 * over two tabs — Quotes reads the venue, Proofs argues about the reading — so
 * "the same" has to be literally true rather than maintained. It also gives
 * `coherence-pane-head.test.ts` one thing to assert against, and that suite
 * derives each head's id from the tab that owns the section: five of the nine
 * changed prefix on 2026-08-24 when the rail was divided, and a hand-written
 * prefix would have mislabelled every card that moved.
 *
 * `note` is for what this read cost or covered — a count, a source, a
 * freshness. Never a second sentence of explanation: that is what `lede` is,
 * and a head with two sentences in it is a paragraph wearing a heading's
 * clothes.
 */

import { type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
  /** Proofs can keep the rationale available without front-loading it. */
  ledeSummary?: string;
}

export default function PaneHead({ kicker, title, id, note, lede, ledeSummary }: PaneHeadProps) {
  return (
    <>
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">{kicker}</span>
          <h2 id={id}>{title}</h2>
        </div>
        {note ? <span className="section-note">{note}</span> : null}
      </div>
      {lede ? ledeSummary ? (
        <Collapsible className="proofs-method-note">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="xs">
              <span aria-hidden="true">＋</span> {ledeSummary}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="sub"><p>{lede}</p></div>
          </CollapsibleContent>
        </Collapsible>
      ) : <p className="sub">{lede}</p> : null}
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
export function PaneHeadEmpty({ head, mark, busy = false, children }: {
  head: PaneHeadProps;
  /** The status vocabulary's own mark — ◌ waiting, ○ absent, ✕ failed. */
  mark: string;
  /** True only while a gateway read is genuinely in flight. */
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <PaneHead {...head} />
      <p className="console-empty" role={busy ? "status" : undefined} aria-busy={busy || undefined}>
        <span aria-hidden="true">{mark}</span> {children}
      </p>
    </>
  );
}
