"use client";

/**
 * The preview a disruptive operator action has to pass through.
 *
 * Split out of `OperatorPanel` when that file passed the length ceiling. It is
 * the panel's one modal-shaped surface and it holds no state: the pending
 * confirmation, the focus restore and the gate on confirming all stayed with
 * the panel, which is where the action is actually dispatched from.
 *
 * `alertdialog` with `aria-modal="false"` on purpose — nothing behind it is
 * inert, and claiming otherwise to a screen reader would be a lie about the
 * page. Escape leaves state unchanged, and says so in the open.
 *
 * The confirm button keeps `is-disruptive` INSIDE
 * `.operator-confirmation__actions`. Both tone rules in globals.css are
 * descendant selectors — `.operator-confirmation__actions .is-disruptive` here,
 * `.console-action__controls .is-disruptive` on the rows — so the wrapper class
 * is load-bearing: rename it and the button silently loses its red with
 * nothing failing anywhere.
 */

import { type RefObject } from "react";

import type { PendingConfirmation } from "@/components/systems/OperatorPanel";

export default function OperatorConfirmation({
  pending,
  confirmButton,
  confirmDisabled,
  onCancel,
  onConfirm,
}: {
  pending: PendingConfirmation;
  confirmButton: RefObject<HTMLButtonElement | null>;
  confirmDisabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      className="operator-confirmation"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="operator-confirmation-title"
      aria-describedby="operator-confirmation-effect"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="operator-confirmation__heading">
        <div>
          <span className="page-kicker">Confirmation preview</span>
          <h3 id="operator-confirmation-title">{pending.title}</h3>
        </div>
        <span className="operator-confirmation__badge">Disruptive</span>
      </div>
      <dl className="operator-confirmation__facts">
        <div><dt>Target</dt><dd><code>{pending.target}</code></dd></div>
        <div><dt>Control plane</dt><dd>Next.js provider routing</dd></div>
        <div><dt>Blast radius</dt><dd>One function instance; other instances may retain different state</dd></div>
      </dl>
      <p id="operator-confirmation-effect">{pending.effect}</p>
      <div className="operator-confirmation__actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button
          ref={confirmButton}
          type="button"
          className="is-disruptive"
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          {pending.confirmLabel}
        </button>
      </div>
      <small>Press Escape to leave state unchanged.</small>
    </section>
  );
}
