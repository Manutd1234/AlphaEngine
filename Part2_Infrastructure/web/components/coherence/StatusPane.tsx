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

import type { CoherenceStatus } from "@/lib/coherence/types";
import { StateChip } from "./Figure";

function schemaTone(schema: unknown): "good" | "warn" | "critical" | "muted" {
  if (schema === "fp-2026") return "good";
  if (schema === "unavailable") return "muted";
  return "critical";
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

      <dl className="coh-status__facts">
        <div>
          <dt>Recorded so far</dt>
          <dd>
            {tape.state === "ok" ? `${tape.book_snapshots ?? 0} snapshots across ${tape.tickers_seen ?? 0} markets` : "—"}
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
            {status.budget.tokens_per_second} tokens per second, {status.budget.tokens_spent} spent
          </dd>
        </div>
        <div>
          <dt>Coherence solver</dt>
          <dd>{String((status.solver as { linear_programme?: string }).linear_programme ?? "unknown")}</dd>
        </div>
      </dl>

      <p className="coh-status__basis">{status.budget.basis}.</p>

      {status.notes.length ? (
        <ul className="coh-notes">
          {status.notes.map((note, index) => (
            <li key={`${index}-${note}`}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
