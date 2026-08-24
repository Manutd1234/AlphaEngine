"use client";

/**
 * What the Stake section says when the solver returns no plan.
 *
 * THIS IS THE PANE THE READER CALLED BROKEN. On this watchlist the first family
 * the universe answers with is a crypto strike ladder, the section opens on it,
 * and every one of its views printed the same grey line: "No stake was sized:
 * this reading is a ladder…". Nothing was broken. The solver was declining a
 * family by name, which is the correct answer and the safe one — but a correct
 * answer with no next action in it reads exactly like a dead pane, and it was
 * the FIRST thing on the most consequential section of the tab.
 *
 * So the empty state is the section's own answer here, in the shape
 * `ReplayBackfillPanel` uses for an unset schedule: what this family IS, why it
 * cannot be sized, WHICH families can and one press to reach them, what still
 * works, and the variable an operator would change. Four sentences and a
 * control, instead of one sentence and nothing.
 *
 * HOW "WHICH FAMILIES CAN BE SIZED" IS DECIDED, because a wrong answer here
 * would be worse than none. It is the exchange's own `mutually_exclusive` flag,
 * read off the universe payload this console already holds — the same flag the
 * kernel keys off in `distribution._shape`: an exclusive family becomes a
 * `bucket` or `named` surface, which is the pair `stake_for` accepts, and
 * everything else becomes a `ladder`, which it refuses. No extra read, and no
 * second opinion about a decision the server has already published.
 *
 * IT IS A NECESSARY CONDITION AND NOT A SUFFICIENT ONE, and the copy says so
 * rather than promising a solve. An exclusive family with an unquoted leg is
 * refused as well — dropping the leg would let a partial basket print as
 * certain — so this offers the families that can be TRIED, which is what a
 * next action is.
 *
 * REJECTED: defaulting the picker to a solvable family. It would open the
 * section on something that works and hide the family the desk actually
 * watches most of, which is the "green, plausible and wrong" failure this
 * repository is most alert to. The ladder stays where the reader put it and
 * explains itself.
 */

import type { CoherenceEventView } from "@/lib/coherence/types";
import type { CoherenceKelly } from "@/lib/coherence/types-lab";

export default function StakeDeclined({
  kelly,
  target,
  events,
  onSelect,
}: {
  kelly: CoherenceKelly;
  /** The family this answer is about. */
  target: string;
  /** Every watched family, so the ones that can be tried can be named. */
  events: readonly CoherenceEventView[];
  onSelect: (ticker: string) => void;
}) {
  const current = events.find((event) => event.event_ticker === target);
  const solvable = events.filter(
    (event) => event.mutually_exclusive && event.event_ticker !== target,
  );

  return (
    <div className="coh-kelly">
      {/* The numbers first, the same as every other section on this tab: three
          counts that say what was asked and what came back, so the reader is
          not being told a story with no figures in it. */}
      <dl className="coh-status__facts">
        <div>
          <dt>Families watched</dt>
          <dd>{events.length}</dd>
        </div>
        <div>
          <dt>Marked mutually exclusive</dt>
          <dd>{events.filter((event) => event.mutually_exclusive).length}</dd>
        </div>
        <div>
          <dt>This family</dt>
          <dd>{current ? (current.mutually_exclusive ? "mutually exclusive" : "not mutually exclusive") : "—  not in this poll"}</dd>
        </div>
      </dl>

      <p className="console-empty">
        <span aria-hidden="true">◌</span> No stake was sized for {target}: {kelly.detail}
      </p>

      {current && !current.mutually_exclusive ? (
        <p className="coh-kelly__note">
          Correct rather than a gap: on a strike ladder a threshold wins wherever the one above it wins,
          so one market pays in several bins; the exclusive-family solver states one market per state and declines
          this family by name.
        </p>
      ) : null}

      {solvable.length ? (
        <>
          <p className="coh-kelly__note">
            {solvable.length === 1 ? "One other watched family carries" : `${solvable.length} other watched families carry`}{" "}
            the exchange&rsquo;s own mutually-exclusive flag, which is the flag the solver needs. It can still refuse
            one of them: a family with an unquoted leg is refused too, because dropping the leg would let a partial
            basket read as certain.
          </p>
          <div className="seg coh-books__picker" role="group" aria-label="Try a family the solver accepts">
            {solvable.map((event) => (
              <button
                key={event.event_ticker}
                type="button"
                aria-pressed={false}
                onClick={() => onSelect(event.event_ticker)}
              >
                {event.event_ticker}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="coh-kelly__note">
          No watched family carries that flag on this poll, so nothing here can be sized until{" "}
          <code>COHERENCE_SERIES</code> names a series whose events the exchange marks mutually exclusive — for
          example <code>COHERENCE_SERIES=KXBTCD,KXHIGHNY</code>, where the second is a daily-high family quoted as
          exhaustive buckets.
        </p>
      )}

      <p className="coh-kelly__note">
        <span aria-hidden="true">→</span> Lattice draws this family in full: the survival curve, the mass between the
        strikes and the moments all come from the distribution read, which a ladder answers. The measure is readable
        here; only the bet is not.
      </p>
    </div>
  );
}
