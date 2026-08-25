"use client";

/**
 * Is this engine reading, and what has it seen — in the head, not at the foot.
 *
 * The reader asked for two things: the four metrics "in a table, moved to the
 * top right corner where there is a lot of space", and the status chip row
 * moved there too. Both lived at the bottom of `StatusPane`, under every
 * section, behind a `border-top` that read as a page footer.
 *
 * IT IS A MERGE, NOT A MOVE, and that is the part the ask does not show. The
 * page head already carried four `metrics` tiles and three of them were the
 * same facts as three of the chips:
 *
 *     Exchange — reachable      the ● Exchange reachable chip
 *     Solver — highs            the Coherence solver fact
 *     Order path — none         the ✓ Read only chip
 *     Families priced — 4       the only tile with no counterpart
 *
 * Moved as-is, the head would have stated six facts twice, twenty pixels apart.
 * `CoherenceConsole` knew this from the other side: its Exchange tile
 * deliberately withheld the hostname because "the status strip at the foot of
 * this tab carries it beside the same reachability state, and one figure
 * printed twice on one screen is a reader checking whether they are two
 * measurements". That argument inverts the moment the strip arrives beside it.
 *
 * So three tiles retire into this panel, `Families priced` stays a tile — it is
 * a UNIVERSE figure, not a status one — and the head's second row gets shorter
 * rather than longer.
 *
 * WHAT STAYS AT THE FOOT, and why it is not an oversight: the shard table and
 * the gateway's notes. Both are detail rather than state, both are wide, and
 * the shard fold opens itself when a shard stops trading — a status may never
 * be hidden, and there is no room in a header box for a four-column table that
 * has to be able to appear.
 */

import type { CoherenceStatus } from "@/lib/coherence/types";
import { groupDigits } from "@/lib/coherence/universe-metrics";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import { StateChip } from "./Figure";

function schemaTone(schema: unknown): "good" | "warn" | "critical" | "muted" {
  if (schema === "fp-2026") return "good";
  if (schema === "unavailable") return "muted";
  return "critical";
}

/**
 * A whole count for display, grouped — or a dash when there is no count.
 *
 * `— not "0"`. This returned `"0"` for null until it moved here, which is null
 * coerced to zero: the one thing this codebase refuses everywhere else. It was
 * shielded on one call site by a `tape.state === "ok"` guard and on neither of
 * the two budget sites, so a gateway that had not reported a budget printed
 * "0 tokens per second, 0 spent" — a working engine reading as a stopped one.
 */
function count(value: number | null | undefined): string {
  return value == null ? "—" : groupDigits(String(value));
}

/**
 * The chip row, for the heading's right-hand slot.
 *
 * Split from the facts table on 2026-08-25 so the top bar can be ONE box: the
 * reader asked for the table "below the header on the left side" with the rest
 * shifted down, which means the two halves of this panel sit in two different
 * slots of the same heading. They still read one `status`, so they cannot
 * disagree about what the engine is doing.
 */
export function EngineChips({
  status,
  error,
  updatedAt,
  pollMs,
  paused,
}: {
  status: CoherenceStatus | null;
  error: string | null;
  updatedAt: Date | null;
  pollMs: number | null;
  paused: boolean;
}) {
  const stamp = (
    <FreshnessStamp updatedAt={updatedAt} pollMs={pollMs} paused={paused} transport="poll" />
  );
  if (error && !status) {
    return (
      <div className="coh-headchips">
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The engine could not report its own state: {error}
        </p>
        {stamp}
      </div>
    );
  }
  if (!status) {
    return (
      <div className="coh-headchips">
        <p className="console-empty muted">Asking the engine how it is…</p>
        {stamp}
      </div>
    );
  }
  const schema = String((status.schema_probe as { schema?: string }).schema ?? "unavailable");
  const recorder = status.recorder;
  const reachable = status.hosts.some((host) => host.reachable);
  return (
    <div className="coh-headchips">
      {/* TWO GROUPS, TWO ROWS, and the split is the reader's own: "Reading the
          exchange, Exchange reachable, Fixed-point schema — put above the
          recorder row".

          It is also the honest seam. The first row is THE VENUE: can this desk
          reach Kalshi and does it understand what Kalshi sent. The second is
          THIS DESK: what its own recorder has written, that it cannot trade,
          and when it last looked. Four chips and a clock in one wrapping row
          broke wherever the width happened to run out, which put the seam in a
          different place at every viewport — so the break is declared here and
          forced in CSS rather than left to arithmetic. */}
      <div className="coh-status__chips coh-headchips__venue">
        <StateChip
          mark={reachable ? "●" : "✕"}
          word={reachable ? "Exchange reachable" : "Exchange unreachable"}
          value={status.hosts[0]?.host ?? null}
          tone={reachable ? "good" : "critical"}
        />
        <StateChip
          mark={schema === "fp-2026" ? "✓" : "▲"}
          word={schema === "fp-2026" ? "Fixed-point schema" : `Schema ${schema}`}
          tone={schemaTone(schema)}
        />
      </div>
      <div className="coh-status__chips coh-headchips__desk">
        <StateChip
          mark={recorder.running ? "●" : "○"}
          word={recorder.running ? "Recorder running" : recorder.configured ? "Recorder idle" : "Recorder off"}
          value={recorder.polls ? `${recorder.books_written} books` : null}
          tone={recorder.running ? "good" : recorder.configured ? "warn" : "muted"}
        />
        <StateChip mark="✓" word="Read only" value={status.dry_run ? "no order path" : "dry run off"} tone="muted" />
        {stamp}
      </div>
    </div>
  );
}

export default function EngineStatePanel({
  status,
  error,
  familiesPriced,
}: {
  status: CoherenceStatus | null;
  error: string | null;
  /**
   * How many families the universe read returned, when this section read it.
   *
   * The last survivor of the head's metrics row. It was left alone in a
   * full-width grid once its three neighbours retired into this panel, which
   * reads as a card that lost its neighbours rather than as one deliberate
   * figure — seen at a viewport, not in a diff. It is a fact about what the
   * engine has READ, which is what the rest of this table is about, so it comes
   * in here and the head loses a row rather than keeping one for a single tile.
   */
  familiesPriced?: string | null;
}) {

  if (error && !status) {
    return (
      <div className="coh-headstate">
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The engine could not report its own state: {error}
        </p>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="coh-headstate">
        <p className="console-empty muted">Asking the engine how it is…</p>
      </div>
    );
  }

  const recorder = status.recorder;
  const tape = status.tape as { state?: string; book_snapshots?: number; tickers_seen?: number };
  const solver = String((status.solver as { linear_programme?: string }).linear_programme ?? "unknown");

  return (
    <div className="coh-headstate">
      {/* A TABLE, which is what the reader asked for, and a `<dl>`, which is
          what these are. Four label-and-figure pairs are a description list;
          the borders are what make it read as a table. `PnlStrip`'s compact
          metrics do exactly this a few directories away and say so. */}
      <dl className="coh-status__facts coh-facts--tabled">
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
              ? "— not polled yet"
              : `${recorder.seconds_since_last_poll}s ago`}
          </dd>
        </div>
        <div>
          <dt>Read budget</dt>
          <dd>
            {count(status.budget.tokens_per_second)} per second, {count(status.budget.tokens_spent)} spent
          </dd>
          {/* Provenance for THIS row, so it sits under this row — and folded,
              because it is a whole gateway sentence beside three neighbours
              that carry a figure, and unfolded it makes one cell three times
              the height of the rest. */}
          <dd className="coh-status__basis">
            <details className="disclosure">
              <summary>How this budget was chosen</summary>
              {status.budget.basis}
            </details>
          </dd>
        </div>
        <div>
          <dt>Coherence solver</dt>
          <dd>{solver}</dd>
        </div>
        {familiesPriced ? (
          <div>
            <dt>Families priced</dt>
            <dd>{familiesPriced}</dd>
          </div>
        ) : null}
      </dl>

    </div>
  );
}
