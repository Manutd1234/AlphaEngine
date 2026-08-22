"use client";

/**
 * "What each server control touches, and leaves alone" — drawn, counted, and
 * still readable with the pointer unplugged.
 *
 * THE SOURCE OF THIS PANEL IS A DISCLOSURE. `OperatorControls` ends with five
 * sentences behind a disclosure triangle, one per control, each naming what
 * that control does not touch. They are correct, and they are the wrong
 * shape: the reader's question is a column ("will my circuits survive this?")
 * and the prose only answers rows. So the same relation is drawn as a matrix
 * here. The disclosure stays where it is — it is the per-control note beside
 * the per-control button, and deleting it to avoid saying a thing twice would
 * take the sentence away from the only place a reader meets it while their
 * finger is on the button.
 *
 * MEASURED, NOT DECORATIVE. Every store on the right carries the SAME figure
 * the badge beside the corresponding button prints, threaded down from
 * `OperatorPanel` rather than re-derived here: 0 cached, 0 open, 5 ledgers,
 * 16/600 events are the numbers, and a zero is a real zero. Where there is no
 * measurement — a health route that refused, a snapshot with no cache counter,
 * and the vendor's meter, which no route in this deployment reads — the cell
 * dashes and the reason is printed beside it rather than left to be guessed.
 *
 * THREE SURFACES, ONE MODEL. The selector is buttons, the drawing is one
 * `role="img"`, the matrix is a table. All three render `SERVER_MUTATIONS` and
 * `MUTATION_STORES`, so none of them can disagree with another, and any one of
 * them alone answers the question: the drawing for someone scanning, the table
 * for someone reading or listening, the selector for someone who wants one row
 * of it at a time. The rejected alternative was to make the drawing the only
 * surface and give its nodes focus — thirty-five focusable SVG nodes is a
 * keyboard trap wearing a diagram's clothes.
 */

import { useState } from "react";

import MutationScopeDiagram from "@/components/systems/MutationScopeDiagram";
import {
  deriveStoreQuantities,
  describeMutationScope,
  EFFECT_STYLE,
  MUTATION_STORES,
  SERVER_MUTATIONS,
  type MutationScopeInput,
} from "@/components/systems/mutation-scope";

export default function MutationScopeMap(input: MutationScopeInput) {
  const [selected, setSelected] = useState<string | null>(null);
  const quantities = deriveStoreQuantities(input);
  const active = SERVER_MUTATIONS.find((row) => row.id === selected) ?? null;
  const spoken = describeMutationScope(quantities);

  /**
   * Dashed stores, grouped by the reason they dash.
   *
   * A refusing health route dashes four stores for one reason, and listing it
   * four times made the line below read as four separate faults. One reason,
   * the stores it covers, once.
   */
  const absences = new Map<string, string[]>();
  for (const store of quantities) {
    if (store.value !== null || !store.absence) continue;
    absences.set(store.absence, [...(absences.get(store.absence) ?? []), store.label]);
  }

  return (
    <section className="card mutation-map" aria-label="What each server mutation clears and leaves intact">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Blast radius</span>
          <h2>What each mutation clears, and what survives it</h2>
        </div>
        <span className="section-note">
          Six stores in this instance; the vendor&rsquo;s meter is not one of them.
        </span>
      </div>

      {/* The house in-panel switcher, exactly as the Remediation rail and the
          failover route picker use it: real buttons, `aria-pressed`, reachable
          by Tab and operable by Enter or Space with nothing bound by hand. */}
      <div className="seg mutation-map__picker" role="group" aria-label="Highlight one mutation">
        {SERVER_MUTATIONS.map((row) => (
          <button
            key={row.id}
            type="button"
            aria-pressed={selected === row.id}
            title={`${row.label} — highlight what it touches`}
            onClick={() => setSelected((current) => (current === row.id ? null : row.id))}
          >
            {row.short}
          </button>
        ))}
      </div>

      <MutationScopeDiagram
        quantities={quantities}
        selected={selected}
        label={
          active
            ? `${spoken} ${active.label} is highlighted.`
            : `${spoken} No mutation is highlighted, so every edge is drawn.`
        }
      />

      {/* The same thirty-five cells as text. `.table-wrap` is focusable so a
          keyboard reader can scroll eight columns without a pointer, which is
          the idiom `HealthMatrix` established for the provider table. */}
      <div className="table-wrap" tabIndex={0}>
        <table className="mutation-map__matrix">
          <thead>
            <tr>
              <th scope="col">Server mutation</th>
              {MUTATION_STORES.map((store) => (
                <th key={store.id} scope="col">
                  {store.label}
                  <br />
                  <span className="mutation-map__figure">
                    {quantities.find((q) => q.id === store.id)?.value ?? "—"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SERVER_MUTATIONS.map((row) => (
              <tr key={row.id} data-selected={selected === row.id}>
                <th scope="row">{row.label}</th>
                {MUTATION_STORES.map((store) => {
                  const cell = row.effects[store.id];
                  const style = EFFECT_STYLE[cell.effect];
                  return (
                    <td key={store.id} style={{ color: style.tone }} title={cell.reason}>
                      <span aria-hidden>{style.glyph}</span> {style.word}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* A dash in the table above states that there is no figure; it cannot
          state WHY, because a `th` does not wrap and a fifteen-word reason
          would take the column with it. So the reasons are collected here, on
          screen at rest rather than in a `title`. The vendor's meter is always
          in this list, which is the point: the one store on the map that no
          control reaches is also the one this deployment cannot even read. */}
      <p className="muted">
        <span aria-hidden>{EFFECT_STYLE.unreachable.glyph}</span> Dashed above, and why:{" "}
        {[...absences].map(([reason, labels]) => `${labels.join(", ")} — ${reason}`).join("; ")}.
      </p>

      {/* The interaction that teaches what the prose was trying to say: one
          mutation, all seven answers, each with the reason spelled out. */}
      {active ? (
        <dl className="mutation-map__reasons">
          {MUTATION_STORES.map((store) => {
            const cell = active.effects[store.id];
            const quantity = quantities.find((q) => q.id === store.id);
            return (
              <div key={store.id}>
                <dt>
                  <span aria-hidden>{EFFECT_STYLE[cell.effect].glyph}</span> {store.label}
                  <span className="mutation-map__figure">
                    {quantity?.value ?? `— ${quantity?.absence ?? "not stated"}`}
                  </span>
                </dt>
                <dd>
                  <strong style={{ color: EFFECT_STYLE[cell.effect].tone }}>
                    {EFFECT_STYLE[cell.effect].word}
                  </strong>{" "}
                  {cell.reason}.
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="muted console-empty">
          No mutation is highlighted. The table above already states all thirty-five answers;
          choosing one above adds the reason behind each of its seven.
        </p>
      )}

      {/* The safety sentence, unfolded, on the pane that holds the button it is
          about. It is the one claim on this map a reader would be wrong not to
          have met before pressing Reset counter. */}
      <p className="console-warn">
        <span aria-hidden>▲</span> Resetting a quota ledger clears <em>our</em> count and not the
        vendor&rsquo;s meter: the provider still believes it served those calls, so further requests
        may still be rejected upstream or billed.
      </p>

      <details className="disclosure">
        <summary>Where these thirty-five answers were read from</summary>
        <p className="research-note">
          Each cell was taken out of <code>lib/operator.ts</code>, the only write path in this
          deployment, rather than from the notes beside the buttons — a drawing of a paragraph is
          not checkable, and two of the cells came out differently once the code was open.
        </p>
        <dl className="operator-scope-notes">
          {MUTATION_STORES.map((store) => (
            <div key={store.id}>
              <dt>{store.label}</dt>
              <dd>
                counted from <code>{store.source}</code>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
