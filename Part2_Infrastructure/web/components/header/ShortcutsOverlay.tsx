"use client";

/**
 * The "?" overlay: every keyboard affordance in one place, and the eight-stop
 * reviewer tour — the app teaching itself in five minutes.
 *
 * Same native-`<dialog>` idioms as CommandBar: `showModal()` for the top
 * layer, backdrop and focus trap; the `close` event keeps the parent's state
 * true when Escape does the closing. The tour deep-links through the same
 * `navigate` detail mechanism the palette uses, so every stop lands on a full
 * `#view/section` URL a reviewer can copy.
 */

import { useEffect, useRef } from "react";

export interface TourStop {
  /** Rail label pair, e.g. "Risk → Monte Carlo". */
  where: string;
  /** What to actually look at once there — the moment worth showing. */
  moment: string;
  /** Applies the tab switch and section atomically (built by the page). */
  visit: () => void;
}

export default function ShortcutsOverlay({
  open,
  onClose,
  stops,
}: {
  open: boolean;
  onClose: () => void;
  stops: TourStop[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
  }, [open]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const onCloseEvent = () => onClose();
    node.addEventListener("close", onCloseEvent);
    return () => node.removeEventListener("close", onCloseEvent);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="shortcuts-overlay"
      aria-label="Keyboard shortcuts and reviewer tour"
      onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}
    >
      <div className="shortcuts-overlay__panel">
        <div className="shortcuts-overlay__head">
          <h2>Drive the whole desk from the keyboard</h2>
          <button type="button" className="text-action" onClick={onClose}>
            Close <kbd>esc</kbd>
          </button>
        </div>

        <div className="shortcuts-overlay__grid">
          <section aria-label="Keyboard shortcuts">
            <h3>Shortcuts</h3>
            <dl className="shortcuts-overlay__keys">
              <div><dt><kbd>⌘</kbd><kbd>K</kbd></dt><dd>Command palette — every tab, rail section, all 46 models, every symbol</dd></div>
              <div><dt><kbd>Alt</kbd><kbd>1–8</kbd></dt><dd>Jump between the eight workspaces in decision-loop order</dd></div>
              <div><dt><kbd>⌘</kbd><kbd>Enter</kbd></dt><dd>Run the sweep and record it in the trail (Research)</dd></div>
              <div><dt><kbd>←</kbd><kbd>→</kbd></dt><dd>Move along section rails; steer the parameter heatmap cell by cell</dd></div>
              <div><dt><kbd>Enter</kbd></dt><dd>Inspect the focused heatmap cell; stage a ladder price on Trade</dd></div>
              <div><dt><kbd>?</kbd></dt><dd>This overlay</dd></div>
            </dl>
          </section>

          <section aria-label="Reviewer tour">
            <h3>The eight-stop reviewer tour</h3>
            <ol className="shortcuts-overlay__tour">
              {stops.map((stop) => (
                <li key={stop.where}>
                  <button
                    type="button"
                    onClick={() => {
                      stop.visit();
                      onClose();
                    }}
                  >
                    <strong>{stop.where}</strong>
                    <span>{stop.moment}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <p className="shortcuts-overlay__foot">
          Five minutes end to end. Walk it once with motion on and once with the OS
          reduce-motion switch set — that walk is the acceptance script.
        </p>
      </div>
    </dialog>
  );
}
