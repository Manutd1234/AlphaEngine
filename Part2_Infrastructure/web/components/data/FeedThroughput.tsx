"use client";

/**
 * How fast each book is actually ticking.
 *
 * `update_rate_hz` and `uptime_seconds` arrive on every gateway ops snapshot,
 * for every venue and every symbol, and until now `update_rate_hz` was rendered
 * nowhere and `uptime_seconds` nowhere at all — the tab's one feed table showed
 * a count and an age for the active symbol and dropped the rest. This is the
 * densest live series reaching the workspace.
 *
 * Two rates, kept apart on purpose. The bar is the gateway's own instantaneous
 * rate. The mean beside each venue is DERIVED (`updates_total / uptime_seconds`)
 * and assumes every book was subscribed when the venue connected — true for a
 * venue that has never reconnected, an approximation for one that has. Printing
 * them as one number would bury that assumption; printing them side by side is
 * also the only way to see a tape that has quietly slowed.
 */

import CategoryBars, { type BarRow } from "@/components/charts/CategoryBars";
import type { SystemHealth } from "@/components/systems/types";
import { deriveFeedThroughput, humanDuration } from "@/lib/data-trust";
import { compact, fmt } from "@/lib/format";

const STATUS_GLYPH: Record<string, string> = { up: "●", degraded: "▲", stale: "▲", down: "✕" };

export default function FeedThroughput({ health }: { health: SystemHealth | null }) {
  const feeds = deriveFeedThroughput(health);
  const books = feeds.flatMap((feed) => feed.books);
  // One denominator across venues: a 10 Hz book and a 0.2 Hz book must not be
  // drawn the same length because they happen to lead different venues.
  const peakRate = books.reduce((peak, book) => Math.max(peak, book.updateRateHz), 0);
  const staleBooks = books.filter((book) => book.stale).length;

  return (
    <section className="card" aria-labelledby="trust-throughput-heading">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Live venues</span>
          <h2 id="trust-throughput-heading">Feed throughput &amp; freshness</h2>
        </div>
        <span className="section-note">
          {feeds.length
            ? `${feeds.length} venue${feeds.length === 1 ? "" : "s"}, ${books.length} book${books.length === 1 ? "" : "s"}`
            : "no gateway snapshot"}
        </span>
      </div>

      {!feeds.length ? (
        <div className="data-trust-empty">
          <strong>No gateway feed snapshot.</strong>
          <p>
            The registry can still answer requests, but nothing here proves streaming freshness or
            update rate. An absent monitor is not a silent tape.
          </p>
        </div>
      ) : (
        feeds.map((feed) => {
          const rows: BarRow[] = feed.books.map((book) => ({
            label: book.symbol,
            note: `${fmt(book.updateRateHz, 2)} Hz, ${
              book.ageSeconds == null ? "age n/a" : `${fmt(book.ageSeconds, 2)} s old`
            }${book.stale ? "; stale" : ""}`,
            segments: [
              {
                // Two labels, so the legend names the colour whenever a stale
                // book is present rather than leaving amber unexplained.
                label: book.stale ? "updates/s, stale book" : "updates/s",
                value: book.updateRateHz,
                color: book.stale
                  ? "var(--status-warning)"
                  : feed.synthetic
                    ? "var(--series-2)"
                    : "var(--series-1)",
              },
            ],
          }));

          return (
            <div key={feed.venue}>
              <p className="console-subhead">
                <span aria-hidden>{STATUS_GLYPH[feed.status] ?? "◌"}</span> {feed.venue}
                <small className="muted">
                  {" "}— {feed.status}
                  {feed.connected ? "" : ", disconnected"}
                  {"; up "}{humanDuration(feed.uptimeSeconds * 1000)}
                  {", "}{compact(feed.updatesTotal)} updates
                  {", mean "}
                  {/* Never 0 Hz for a venue with no uptime to divide by: that
                      would report a dead tape where there is no denominator. */}
                  {feed.meanRateHz == null ? "n/a" : `${fmt(feed.meanRateHz, 2)} Hz`}
                  {feed.reconnects ? `; ${feed.reconnects} reconnect${feed.reconnects === 1 ? "" : "s"}` : ""}
                  {feed.synthetic ? "; synthetic" : ""}
                </small>
              </p>
              <CategoryBars
                rows={rows}
                max={peakRate > 0 ? peakRate : undefined}
                ariaLabel={`${feed.venue} book update rate per symbol, in updates per second.`}
                emptyNote={`Every ${feed.venue} book reports 0 Hz — a measured stop, not a missing measurement.`}
              />
            </div>
          );
        })
      )}

      {/* The measured facts stay in the light — the stale count and the shared
          scale are what stop a reader misranking two venues — while the
          derivation of the mean folds behind a summary that already states its
          conclusion. */}
      {feeds.length > 0 && (
        <>
          {/* Nothing when nothing is stale. "Bars share one scale across
              venues" describes the chart's own axis, and the all-clear said a
              budget was not being exceeded — neither is a state worth a line.
              The count of stale books is, and it is shown nowhere else on this
              pane. */}
          {staleBooks > 0 && (
            <p className="research-note">
              <strong>{staleBooks}</strong> book{staleBooks === 1 ? " is" : "s are"} past the
              gateway&rsquo;s freshness budget.
            </p>
          )}
          <details className="disclosure">
            <summary>Why each venue&rsquo;s mean rate is a floor, not a measurement</summary>
            <p className="research-note">
              The <strong>mean</strong> is derived from lifetime counters and assumes every book was
              subscribed at connect; a venue with reconnects has gaps no counter here measures.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
