"use client";

/**
 * One chosen thing per section, and the sentence that says what was chosen.
 *
 * A figure that can be chosen from (`Plot`'s `onSelect`) hands its section an
 * INDEX; the section turns that into the entity it means — a series, a state,
 * a parlay — and does something with it: opens the row that explains it, or
 * the view that holds it. This hook is the section's half: what is chosen,
 * how to choose, and the live region that announces the choice.
 *
 * THE LIVE REGION IS THE SECTION'S, NEVER INSIDE `role="img"`. A `role="img"`
 * subtree is presentational to assistive technology, so a sentence placed
 * inside the figure would be drawn and never spoken — the same reason
 * `Figure` renders its own region as a sibling. So `ChosenStatus` is rendered
 * by the section beside the pair, and it says nothing at mount: an empty
 * region on arrival, a sentence only when something was chosen.
 *
 * Enter on a source mark speaks TWICE by design, and the two sentences differ:
 * the figure's own region says what the mark is (its title), and this one says
 * what choosing it did ("KXBTCD — its row is shown below"). One utterance
 * would have to be one of those, and both are the reader's question.
 */

import { useCallback, useState } from "react";

export function useChosen<T>() {
  const [chosen, setChosen] = useState<T | null>(null);
  // "" at mount, deliberately: a live region that announces on arrival
  // speaks over the figure a reader has just landed on.
  const [announced, setAnnounced] = useState("");
  const choose = useCallback((next: T, announce: string) => {
    setChosen(next);
    setAnnounced(announce);
  }, []);
  const clear = useCallback(() => {
    setChosen(null);
    setAnnounced("");
  }, []);
  return { chosen, choose, clear, announced };
}

/** The section's live region for what was chosen. Rendered OUTSIDE any `role="img"`. */
export function ChosenStatus({ announced }: { announced: string }) {
  return <p className="coh-plot__live" role="status" aria-live="polite">{announced}</p>;
}
