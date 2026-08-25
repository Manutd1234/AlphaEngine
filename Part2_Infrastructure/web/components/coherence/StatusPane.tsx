"use client";

/**
 * Whether anything else on this tab can be believed right now.
 *
 * Placed first among the panes because every other figure here is an argument
 * about live prices, and an argument built on a stale tape or a schema we no
 * longer parse is worse than no argument. The schema probe is the load-bearing
 * check: Kalshi removed its integer-cent fields in March 2026, and a client
 * written against them parses today's payloads into a book of zeros without
 * raising anything at all. "Every price is zero" should not be something a
 * reader has to diagnose from a chart.
 */

import { groupDigits } from "@/lib/coherence/universe-metrics";
import type { CoherenceStatus } from "@/lib/coherence/types";
import { StateChip } from "./Figure";

function schemaTone(schema: unknown): "good" | "warn" | "critical" | "muted" {
  if (schema === "fp-2026") return "good";
  if (schema === "unavailable") return "muted";
  return "critical";
}

/**
 * A whole count for display, grouped.
 *
 * These are the largest bare figures on the engine — 33866 snapshots, 2428
 * markets, 23510 tokens — and they were printed as unbroken digit runs a reader
 * has to count with a fingertip to tell thirty-three thousand from three
 * hundred thousand. `groupDigits` is presentational and provably so: it moves
 * no digit and rounds nothing, which matters on a tab whose numeric contract is
 * "truncated, never rounded".
 */
function count(value: number | null | undefined): string {
  return value == null ? "0" : groupDigits(String(value));
}

export default function StatusPane({ status, error }: { status: CoherenceStatus | null; error: string | null }) {
  if (error && !status) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The engine could not report its own state: {error}
      </p>
    );
  }
  if (!status) return <p className="console-empty muted">Asking the engine how it is…</p>;

  const schema = String((status.schema_probe as { schema?: string }).schema ?? "unavailable");
  const recorder = status.recorder;
  const tape = status.tape as { state?: string; book_snapshots?: number; tickers_seen?: number };
  // A shard is only routine when BOTH are true: the exchange can be up while
  // trading on that shard is halted, and it is the second that stops a family
  // being executable.
  const halted = status.shards.filter((shard) => !shard.exchange_active || !shard.trading_active);

  return (
    <div className="coh-status">
      <div className="coh-status__chips">
        <StateChip
          mark={status.hosts.some((host) => host.reachable) ? "●" : "✕"}
          word={status.hosts.some((host) => host.reachable) ? "Exchange reachable" : "Exchange unreachable"}
          value={status.hosts[0]?.host ?? null}
          tone={status.hosts.some((host) => host.reachable) ? "good" : "critical"}
        />
        <StateChip
          mark={schema === "fp-2026" ? "✓" : "▲"}
          word={schema === "fp-2026" ? "Fixed-point schema" : `Schema ${schema}`}
          tone={schemaTone(schema)}
        />
        <StateChip
          mark={recorder.running ? "●" : "○"}
          word={recorder.running ? "Recorder running" : recorder.configured ? "Recorder idle" : "Recorder off"}
          value={recorder.polls ? `${recorder.books_written} books` : null}
          tone={recorder.running ? "good" : recorder.configured ? "warn" : "muted"}
        />
        <StateChip mark="✓" word="Read only" value={status.dry_run ? "no order path" : "dry run off"} tone="muted" />
      </div>

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

      {/* Boxed, the way Universe's tiles are on the other tab (14t, and 14u for
          this one). They were bare rows at the foot of the tab with a bordered
          figure above and nothing around them, so the eye had no edge to tell
          one metric from the next. */}
      <dl className="coh-status__facts coh-facts--boxed">
        <div>
          <dt>Recorded so far</dt>
          <dd>
            {tape.state === "ok"
              ? `${count(tape.book_snapshots)} snapshots across ${count(tape.tickers_seen)} markets`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Last poll</dt>
          <dd>
            {recorder.seconds_since_last_poll == null
              ? "— the recorder has not polled yet"
              : `${recorder.seconds_since_last_poll}s ago`}
          </dd>
        </div>
        <div>
          <dt>Read budget</dt>
          <dd>
            {count(status.budget.tokens_per_second)} tokens per second, {count(status.budget.tokens_spent)} spent
          </dd>
          {/* The basis WAS a bare gateway string in its own paragraph below the
              list, with a full stop appended and no label — a reader met a
              sentence about token buckets with nothing saying what it was about
              or which figure it explained. It is provenance for this row, so it
              sits under this row.

              FOLDED once the tiles gained frames (14u, 2026-08-25). These four
              are a 140px auto-fit grid whose items stretch to the tallest row,
              and this one carried a whole gateway sentence where its three
              neighbours carry a figure — so boxing them made one tile three
              times the height of the rest and the row read as broken. The
              sentence is provenance, which is what a fold is for. */}
          <dd className="coh-status__basis">
            <details className="disclosure">
              <summary>How this budget was chosen</summary>
              {status.budget.basis}
            </details>
          </dd>
        </div>
        <div>
          <dt>Coherence solver</dt>
          <dd>{String((status.solver as { linear_programme?: string }).linear_programme ?? "unknown")}</dd>
        </div>
      </dl>

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
