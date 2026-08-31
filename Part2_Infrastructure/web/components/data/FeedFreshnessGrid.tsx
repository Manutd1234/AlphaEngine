"use client";

import { useEffect, useRef, useState } from "react";

import GappedSparkline from "@/components/charts/GappedSparkline";
import type { SystemHealth } from "@/components/systems/types";
import { deriveFeedThroughput } from "@/lib/data-trust";
import { fmt } from "@/lib/format";

export type FeedFreshnessHistory = Record<string, Array<number | null>>;
export const FRESHNESS_HISTORY_LIMIT = 30;

/** Append one health observation per current feed-book without bridging gaps. */
export function appendFeedFreshnessHistory(
  current: FeedFreshnessHistory,
  health: SystemHealth | null,
  limit = FRESHNESS_HISTORY_LIMIT,
): FeedFreshnessHistory {
  const feeds = deriveFeedThroughput(health);
  const keys = feeds.flatMap((feed) => feed.books.map((book) => `${feed.venue}:${book.symbol}`));
  const bounded = Math.max(2, Math.floor(Number.isFinite(limit) ? limit : FRESHNESS_HISTORY_LIMIT));
  const next: FeedFreshnessHistory = {};
  for (const key of keys) {
    const [venue, ...symbolParts] = key.split(":");
    const symbol = symbolParts.join(":");
    const book = feeds.find((feed) => feed.venue === venue)?.books.find((row) => row.symbol === symbol);
    const age = book?.ageSeconds;
    next[key] = [...(current[key] ?? []), age != null && Number.isFinite(age) ? age : null].slice(-bounded);
  }
  return next;
}

export function hasLiveTransport(
  feed: ReturnType<typeof deriveFeedThroughput>[number],
  book: ReturnType<typeof deriveFeedThroughput>[number]["books"][number],
): boolean {
  return feed.connected && feed.status === "up" && !feed.synthetic
    && !book.stale && book.ageSeconds != null && book.updateRateHz > 0;
}

export default function FeedFreshnessGrid({ health }: { health: SystemHealth | null }) {
  const [history, setHistory] = useState<FeedFreshnessHistory>({});
  const lastStamp = useRef<string | null>(null);
  const stamp = health?.platform?.observed_at ?? health?.fetchedAt ?? null;
  const feeds = deriveFeedThroughput(health);

  useEffect(() => {
    if (!stamp || lastStamp.current === stamp) return;
    lastStamp.current = stamp;
    setHistory((current) => appendFeedFreshnessHistory(current, health));
  }, [health, stamp]);

  return (
    <section className="card" aria-labelledby="feed-freshness-grid-title">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Freshness traces</span>
          <h2 id="feed-freshness-grid-title">Book age sparklines</h2>
        </div>
        <span className="section-note">last {FRESHNESS_HISTORY_LIMIT} health observations</span>
      </div>

      {!feeds.length ? (
        <p className="muted">No gateway feed snapshot; freshness history is withheld.</p>
      ) : (
        <div className="feed-freshness-grid">
          {feeds.flatMap((feed) => feed.books.map((book) => {
            const key = `${feed.venue}:${book.symbol}`;
            const live = hasLiveTransport(feed, book);
            const state = live ? "live transport"
              : feed.synthetic ? "synthetic"
              : book.stale ? "stale"
              : feed.connected ? feed.status : "disconnected";
            return (
              <article className="feed-freshness-cell" key={key} data-live={live || undefined}>
                <div className="feed-freshness-cell__head">
                  <strong>{book.symbol}</strong>
                  <span className="num">{book.ageSeconds == null ? "age n/a" : `${fmt(book.ageSeconds, 2)}s`}</span>
                </div>
                <span className="feed-freshness-cell__venue">{feed.venue}</span>
                <GappedSparkline
                  points={history[key] ?? []}
                  width={180}
                  height={36}
                  tone={book.stale ? "warn" : live ? "good" : "muted"}
                  ariaLabel={`${feed.venue} ${book.symbol} book age`}
                  emptyNote="collecting age history"
                  unit="seconds"
                />
                <div className="feed-freshness-cell__state">
                  {live ? <i className="pulse-live" aria-hidden /> : <i aria-hidden />}
                  <span>{state}</span>
                  <span className="num">{fmt(book.updateRateHz, 2)} Hz</span>
                </div>
              </article>
            );
          }))}
        </div>
      )}
    </section>
  );
}
