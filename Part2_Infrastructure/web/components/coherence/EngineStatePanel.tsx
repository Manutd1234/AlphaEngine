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
 * A live shard halt remains actionable status, so the detail sheet can repeat
 * its compact warning. Routine shard rows and raw gateway notes do not render:
 * the top bar already owns bounded transport and provenance evidence.
 */

import type { ReactNode } from "react";

import type { CoherenceStatus } from "@/lib/coherence/types";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { StateChip } from "./Figure";
import StatusPane from "./StatusPane";
import { countLabel } from "@/lib/coherence/decimals";

function schemaTone(schema: unknown): "good" | "warn" | "critical" | "muted" {
  if (schema === "fp-2026") return "good";
  if (schema === "unavailable") return "muted";
  return "critical";
}

// The count printer is `countLabel` in lib/coherence/decimals.ts, hoisted from
// here on 2026-08-26 with the defect its header recorded: a null budget must
// print a dash, never "0 tokens per second".

/**
 * The chip row, for the heading's right-hand slot.
 *
 * Split from the facts table on 2026-08-25 so the top bar can be ONE box: the
 * reader asked for the table "below the header on the left side" with the rest
 * shifted down, which means the two halves of this panel sit in two different
 * slots of the same heading. They still read one `status`, so they cannot
 * disagree about what the engine is doing.
 */
interface EngineStatusProps {
  status: CoherenceStatus | null;
  error: string | null;
  /** False on registry-backed static views that make no transport request. */
  visible?: boolean;
  /** Bounded engine provenance, aligned with the venue row instead of below it. */
  detail?: ReactNode;
}

export interface EngineChipsProps extends EngineStatusProps {
  updatedAt: Date | null;
  pollMs: number | null;
  paused: boolean;
}

export function EngineChips({
  status,
  error,
  updatedAt,
  pollMs,
  paused,
  visible = true,
  detail,
}: EngineChipsProps) {
  if (!visible) return null;
  const stamp = (
    <FreshnessStamp updatedAt={updatedAt} pollMs={pollMs} paused={paused} transport="poll" />
  );
  if (error && !status) {
    return (
      <div className="coh-headchips">
        <div className="coh-status__chips coh-headchips__venue">
          <p className="console-empty">
            <span aria-hidden="true">✕</span> The engine could not report its own state: {error}
          </p>
          {detail}
        </div>
        {stamp}
      </div>
    );
  }
  if (!status) {
    return (
      <div className="coh-headchips">
        <div className="coh-status__chips coh-headchips__venue">
          <p className="console-empty muted">Asking the engine how it is…</p>
          {detail}
        </div>
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
        {detail}
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

/**
 * The shared Markets/Proofs status hierarchy: venue truth first, then recorder
 * and polling truth. Explicit rows keep their order stable as values change.
 */
export function EngineTopbarStatus({
  status,
  error,
  visible = true,
  controls,
  detail,
}: EngineStatusProps & { controls: ReactNode }) {
  if (!visible) return null;

  const schema = String((status?.schema_probe as { schema?: string } | undefined)?.schema ?? "unavailable");
  const reachable = status?.hosts.some((host) => host.reachable) ?? false;
  const recorder = status?.recorder ?? null;
  const reading = status?.state === "ok";

  const readingChip = error && !status
    ? { mark: "✕", word: "Exchange unavailable", value: error, tone: "critical" as const }
    : status && !reading
      ? { mark: "▲", word: `Exchange ${status.state}`, value: null, tone: "warn" as const }
      : status
        ? { mark: "●", word: "Reading exchange", value: null, tone: "good" as const }
        : { mark: "◌", word: "Reading exchange", value: "awaiting", tone: "muted" as const };

  return (
    <div className="engine-topbar-status" aria-label="Engine status and polling controls">
      <div
        className="engine-topbar-status__row engine-topbar-status__venue"
        role="group"
        aria-label="Exchange status"
      >
        <StateChip {...readingChip} />
        <StateChip
          mark={status ? (reachable ? "●" : "✕") : "◌"}
          word={status ? (reachable ? "Exchange reachable" : "Exchange unreachable") : "Exchange pending"}
          tone={status ? (reachable ? "good" : "critical") : "muted"}
        />
        <StateChip
          mark={status ? (schema === "fp-2026" ? "✓" : "▲") : "◌"}
          word={status ? (schema === "fp-2026" ? "Fixed-point schema" : `Schema ${schema}`) : "Schema pending"}
          tone={status ? schemaTone(schema) : "muted"}
        />
        <StateChip
          mark={status ? (status.dry_run ? "✓" : "✕") : "◌"}
          word={status ? (status.dry_run ? "Read-only" : "Order path enabled") : "Read-only"}
          tone={status ? (status.dry_run ? "muted" : "critical") : "muted"}
        />
        {detail}
      </div>
      <div
        className="engine-topbar-status__row engine-topbar-status__recorder"
        role="group"
        aria-label="Recorder and polling status"
      >
        <StateChip
          mark={recorder ? (recorder.running ? "●" : "○") : "◌"}
          word="Recorder"
          value={recorder ? `${countLabel(recorder.books_written)} books` : "awaiting"}
          tone={recorder ? (recorder.running ? "good" : recorder.configured ? "warn" : "muted") : "muted"}
        />
        <span className="sr-only">
          Recorder state: {recorder ? (recorder.running ? "running" : recorder.configured ? "idle" : "off") : "awaiting status"}.
        </span>
        {controls}
      </div>
    </div>
  );
}

/** Compatibility name for the first console that adopted the shared top bar. */
export const MarketsEngineStatus = EngineTopbarStatus;

export default function EngineStatePanel({
  status,
  familiesPriced,
}: {
  status: CoherenceStatus | null;
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

  /**
   * NOTHING, WHEN THERE IS NOTHING — because `EngineChips` is in the same slot
   * and says it, and since 2026-08-26 the two are twenty pixels apart.
   *
   * This used to print "Asking the engine how it is…" and, on a failure, "The
   * engine could not report its own state: …". So did the chips. That was
   * survivable while the two halves sat in different parts of the head; once
   * both moved into the head's right-hand column the same sentence appeared
   * twice, stacked, and read as a stutter rather than as a state. Seen at a
   * viewport, not in a diff.
   *
   * NOT A HIDDEN EMPTY RESULT. The house rule is that an absence is reported,
   * and it is: by the sibling that shares this slot, in the same words, once.
   * The same argument the head's metric tiles retired under — a fact stated
   * twice on one screen is a reader checking whether they are two facts.
   */
  if (!status) return null;

  const recorder = status.recorder;
  const tape = status.tape as { state?: string; book_snapshots?: number; tickers_seen?: number };
  const solver = String((status.solver as { linear_programme?: string }).linear_programme ?? "unknown");
  const hasHaltedShard = status.state === "ok" && status.shards.some(
    (shard) => !shard.exchange_active || !shard.trading_active,
  );

  return (
    <div className="coh-headstate">
      <Sheet>
        <SheetTrigger asChild>
          <Button className="coh-headstate__detail-trigger" type="button" variant="outline" size="sm">
            Engine detail
          </Button>
        </SheetTrigger>
        <SheetContent className="coh-engine-detail-content w-[min(48rem,calc(100vw-1rem))] overflow-y-auto min-[521px]:max-w-none">
          <div className="coherence-plane coh-engine-detail-sheet">
            <SheetHeader>
              <SheetTitle>Engine state detail</SheetTitle>
              <SheetDescription>
                Recorder, budget, solver and any live trading pause for this coherence read.
              </SheetDescription>
            </SheetHeader>
            {/* Secondary provenance remains exact, but no longer repeats above
                every one of the 55 Markets/Proofs routes. The live state chips
                remain in the header; this bounded Sheet owns the audit depth. */}
            <dl className="coh-status__facts coh-facts--tabled">
              <div>
                <dt>Recorded so far</dt>
                <dd>
                  {tape.state === "ok"
                    ? `${countLabel(tape.book_snapshots)} snapshots across ${countLabel(tape.tickers_seen)} markets`
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
                  {countLabel(status.budget.tokens_per_second)} per second, {countLabel(status.budget.tokens_spent)} spent
                </dd>
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
            {hasHaltedShard ? <StatusPane status={status} /> : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
