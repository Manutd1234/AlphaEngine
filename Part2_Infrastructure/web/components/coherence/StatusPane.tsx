"use client";

/**
 * The two things about this engine's state that are too wide for the head.
 *
 * The chips and the four metrics moved into `EngineStatePanel`, which renders
 * in the page head's right slot — the reader asked for them "in the top right
 * corner where there is a lot of space". What is left here is what could not
 * go with them, and neither is a leftover:
 *
 * THE SHARD TABLE is four columns and has to be able to APPEAR. A halted shard
 * is a status, `13-warm-bright-pass.css` sets the rule that a status may never
 * be hidden, and the fold below opens itself the moment one stops trading.
 * There is no room in a header box for a table that must be free to unfold.
 *
 * THE GATEWAY'S NOTES are unbounded wire prose. They are provenance for the
 * read, they belong below it, and their count is in the summary so an empty
 * fold and a fold hiding four are not the same shape.
 */

import type { CoherenceStatus } from "@/lib/coherence/types";

export default function StatusPane({ status, error }: { status: CoherenceStatus | null; error: string | null }) {
  if (error && !status) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The engine could not report its own state: {error}
      </p>
    );
  }
  if (!status) return <p className="console-empty muted">Asking the engine how it is…</p>;

  // A shard is only routine when BOTH are true: the exchange can be up while
  // trading on that shard is halted, and it is the second that stops a family
  // being executable.
  const halted = status.shards.filter((shard) => !shard.exchange_active || !shard.trading_active);

  return (
    <div className="coh-status">
      {/* FOLDED 2026-08-25, AND IT OPENS ITSELF. This table renders under every
          section of the tab and is four rows of routine truth, so it is
          furniture — but `13-warm-bright-pass.css` sets the rule that a STATUS
          may never be hidden, and a halted shard is exactly that. So the fold
          is conditional on there being nothing to report: routine shards stay
          shut, and the moment one stops trading the summary says so and the
          table is already open behind it. A reader cannot miss it by not
          clicking, which is the only failure mode a fold introduces. */}
      <details className="disclosure" open={halted.length > 0}>
        <summary>
          {halted.length
            ? `${halted.length} of ${status.shards.length} exchange shards are not trading`
            : `Which shard carries what, all ${status.shards.length} trading`}
        </summary>
      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Exchange shards. Collateral is held per shard, so a family on a shard that is not trading cannot be
            executed against even when its prices look wrong.
          </caption>
          <thead>
            <tr>
              <th scope="col">Shard</th>
              <th scope="col">Carries</th>
              <th scope="col">Exchange</th>
              <th scope="col">Trading</th>
            </tr>
          </thead>
          <tbody>
            {status.shards.map((shard) => (
              <tr key={shard.exchange_index}>
                <th scope="row">{shard.exchange_index}</th>
                <td>{shard.description}</td>
                <td>{shard.exchange_active ? "active" : "halted"}</td>
                <td>{shard.trading_active ? "active" : "halted"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>

      {/* The gateway's own notes: unbounded, unlabelled and rendered raw until
          2026-08-25, at the foot of every section on the tab. Folded, with the
          count in the summary so a reader knows whether there is anything to
          open — an empty fold and a fold hiding four notes looked identical. */}
      {status.notes.length ? (
        <details className="disclosure">
          <summary>{`What the gateway noted about this read, ${status.notes.length} ${status.notes.length === 1 ? "note" : "notes"}`}</summary>
          <ul className="coh-notes">
            {status.notes.map((note, index) => (
              <li key={`${index}-${note}`}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
