"use client";

/**
 * Data feeds — the research supply chain, made visible.
 *
 * Three panels backed by the provider registry:
 *
 *  1. **Lookup** — any equity or crypto symbol; shows the quote *with its
 *     provenance*: which provider answered, how long it took, whether the data
 *     is delayed, and what was skipped on the way. Consensus mode fans out to
 *     every configured source and shows each leg's deviation from the median —
 *     the check that catches a feed quietly serving Friday's close.
 *  2. **News** — normalised headlines for the same symbol.
 *  3. **Providers** — the health strip: configured / quota spent / circuit
 *     state per vendor, and which env var would light up a dark one.
 *
 * Everything renders from the JSON the API already returns; nothing here
 * derives data of its own, so what the user sees is what a curl would see.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import StatTile from "@/components/StatTile";
import { fmt } from "@/lib/format";

// ---- response shapes (mirrors of the API payloads) ------------------------

interface Provenance {
  provider: string;
  label: string;
  latencyMs: number;
  cached: boolean;
  delayed: boolean;
  quotaRemaining: number | null;
  quotaWindow: string | null;
}

interface Attempt {
  provider: string;
  reason: string;
  detail?: string;
}

interface QuoteRow {
  symbol: string;
  asset?: string;
  data?: {
    price: number;
    change: number | null;
    changePct: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
    currency: string;
    asOf: string;
    delayed: boolean;
  };
  provenance?: Provenance;
  attempts?: Attempt[];
  error?: string;
}

interface ConsensusLeg {
  provider: string;
  label: string;
  price: number;
  deviationBps: number;
  stalenessSec: number;
  delayed: boolean;
  latencyMs: number;
}

interface ConsensusRow {
  symbol: string;
  price: number | null;
  legs: ConsensusLeg[];
  spreadBps: number | null;
  outliers: string[];
  attempts: Attempt[];
}

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: number | null;
}

interface ProviderRow {
  id: string;
  label: string;
  configured: boolean;
  circuitOpen: boolean;
  keyEnv: string;
  signup: string;
  capabilities: string[];
  quota: { used: number; limit: number; remaining: number; window: string } | null;
}

const SKIP_LABEL: Record<string, string> = {
  not_configured: "no key",
  circuit_open: "circuit open",
  quota_exhausted: "quota spent",
  quota_reserved: "reserved for interactive",
  failed: "failed",
};

/** One tap instead of typing — the symbols people actually check. */
const QUICK_PICKS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AAPL", "NVDA", "TSLA", "MSFT"];

/** Background refresh cadence. 30s is fresh enough for a research view and slow
 *  enough that, with the `background` priority fencing, it can never spend a
 *  provider's interactive reserve. */
const REFRESH_MS = 30_000;

export default function DataFeeds() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [input, setInput] = useState("BTCUSDT");
  const [consensus, setConsensus] = useState(false);
  const [quote, setQuote] = useState<QuoteRow | null>(null);
  const [cons, setCons] = useState<ConsensusRow | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [newsNote, setNewsNote] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refreshProviders = useCallback(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((body) => setProviders(body.providers ?? []))
      .catch(() => setProviders((p) => p ?? []));
  }, []);

  const lookup = useCallback(
    async (sym: string, useConsensus: boolean, priority: "interactive" | "background") => {
      const mySeq = ++seq.current;
      // Only a human-initiated lookup shows the busy state or surfaces errors.
      // A failed background refresh keeps the last good data on screen — the
      // timestamp goes stale, which is the honest signal, instead of a working
      // panel flashing into an error every 30s because one poll dropped.
      if (priority === "interactive") {
        setBusy(true);
        setError(null);
      }
      try {
        const qs = `symbols=${encodeURIComponent(sym)}&priority=${priority}${
          useConsensus ? "&consensus=1" : ""
        }`;
        const [quoteRes, newsRes] = await Promise.all([
          fetch(`/api/quote?${qs}`),
          fetch(`/api/news?symbols=${encodeURIComponent(sym)}&limit=8&priority=${priority}`),
        ]);
        // A stale response racing a newer request must not win the state.
        if (mySeq !== seq.current) return;

        const quoteBody = await quoteRes.json();
        if (!quoteRes.ok) {
          if (priority === "interactive") {
            setQuote(null);
            setCons(null);
            setError(quoteBody.error ?? `HTTP ${quoteRes.status}`);
          }
        } else {
          // Replace only on success — the previous answer stays visible while
          // the new one is in flight, so the panel never blanks between polls.
          if (useConsensus) {
            setCons(quoteBody.quotes?.[0] ?? null);
            setQuote(null);
          } else {
            setQuote(quoteBody.quotes?.[0] ?? null);
            setCons(null);
          }
          setUpdatedAt(new Date());
        }

        if (newsRes.ok) {
          const body = await newsRes.json();
          setNews(body.items ?? []);
          setNewsNote(null);
        } else if (priority === "interactive") {
          const body = await newsRes.json().catch(() => ({}));
          setNews(null);
          // News being dark is normal on a keyless deploy — say why, quietly,
          // instead of leaving an empty panel that reads as a bug.
          setNewsNote(
            (body as { hint?: string; error?: string }).hint ??
              (body as { error?: string }).error ??
              "News unavailable.",
          );
        }

        // Quota counters and circuit state just changed — let the table tick.
        refreshProviders();
      } catch (err) {
        if (mySeq !== seq.current) return;
        if (priority === "interactive") {
          setError(err instanceof Error ? err.message : "lookup failed");
        }
      } finally {
        if (mySeq === seq.current && priority === "interactive") setBusy(false);
      }
    },
    [refreshProviders],
  );

  useEffect(() => {
    lookup(symbol, consensus, "interactive");
  }, [symbol, consensus, lookup]);

  // Keep the panel current without keeping the user's quota on the hook: the
  // poll is `background` priority (fenced from each provider's reserve) and
  // pauses entirely while the tab is hidden.
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) lookup(symbol, consensus, "background");
    };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [symbol, consensus, lookup]);

  const submit = (s = input) => {
    const sym = s.trim().toUpperCase();
    if (/^[A-Z0-9.\-]{1,20}$/.test(sym)) {
      setInput(sym);
      setSymbol(sym);
    }
  };

  const q = quote?.data;

  return (
    <>
      {/* ---- lookup ------------------------------------------------------ */}
      <div className="card">
        <h2>Symbol lookup</h2>
        <p className="sub">
          Equities and crypto through one registry — ranked failover across every configured
          provider, with the answer's origin attached.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            aria-label="Symbol"
            placeholder="AAPL, BRK.B, BTCUSDT…"
            style={{ fontFamily: "var(--mono)", fontSize: 13, width: 180 }}
          />
          <button onClick={() => submit()} disabled={busy}>
            {busy ? "Loading…" : "Look up"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={consensus}
              onChange={(e) => setConsensus(e.target.checked)}
            />
            Cross-check all sources
          </label>
          <div className="grow" />
          {updatedAt && (
            <span className="num muted" style={{ fontSize: 11.5 }} role="status">
              updated {updatedAt.toLocaleTimeString()} · refreshes every {REFRESH_MS / 1000}s
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {QUICK_PICKS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              aria-pressed={s === symbol}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                padding: "4px 10px",
                background: s === symbol ? "var(--series-1)" : "var(--surface-2)",
                color: s === symbol ? "#fff" : "var(--text-secondary)",
                borderColor: s === symbol ? "var(--series-1)" : "var(--border)",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {error && (
          <div className="banner error" role="alert" style={{ marginTop: 12 }}>
            <span aria-hidden>✕</span>
            <div>{error}</div>
          </div>
        )}

        {/* First load only: a fixed-height placeholder so the card does not
            collapse and re-expand around its content. */}
        {busy && !q && !cons && !error && (
          <div className="skeleton" style={{ height: 96, marginTop: 16 }} />
        )}
        {quote?.error && !error && (
          <div className="banner warn" role="status" style={{ marginTop: 12 }}>
            <span aria-hidden>!</span>
            <div>{quote.error}</div>
          </div>
        )}

        {q && (
          <>
            {/* Dim, don't blank: the old numbers stay readable while the new
                ones are in flight, so the panel never jumps between states. */}
            <div
              className="tiles"
              style={{ marginTop: 16, opacity: busy ? 0.55 : 1, transition: "opacity 150ms" }}
            >
              <StatTile
                label={`${quote!.symbol} last`}
                value={`${fmt(q.price, q.price < 10 ? 4 : 2)} ${q.currency}`}
                note={q.delayed ? "delayed / EOD" : "live"}
                tone={q.delayed ? "muted" : "pos"}
              />
              <StatTile
                label="Change"
                value={q.changePct == null ? "—" : `${q.changePct >= 0 ? "+" : ""}${fmt(q.changePct, 2)}%`}
                note={q.change == null ? "" : `${q.change >= 0 ? "+" : ""}${fmt(q.change, 2)}`}
                tone={q.changePct == null ? "muted" : q.changePct >= 0 ? "pos" : "neg"}
              />
              <StatTile
                label="Range"
                value={q.low != null && q.high != null ? `${fmt(q.low, 2)} – ${fmt(q.high, 2)}` : "—"}
                note="session"
              />
              <StatTile
                label="Source"
                value={quote!.provenance?.label ?? "—"}
                note={
                  quote!.provenance
                    ? `${quote!.provenance.latencyMs}ms${quote!.provenance.cached ? " · cached" : ""}`
                    : ""
                }
              />
            </div>
            {(quote!.attempts?.length ?? 0) > 0 && (
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                Skipped:{" "}
                {quote!.attempts!
                  .map((a) => `${a.provider} (${SKIP_LABEL[a.reason] ?? a.reason})`)
                  .join(" · ")}
              </p>
            )}
          </>
        )}

        {cons && (
          <div
            className="table-wrap"
            style={{ marginTop: 16, opacity: busy ? 0.55 : 1, transition: "opacity 150ms" }}
          >
            <table>
              <caption className="muted" style={{ captionSide: "top", textAlign: "left", fontSize: 12 }}>
                Consensus {cons.price != null ? fmt(cons.price, 2) : "—"}
                {cons.spreadBps != null && ` · spread ${fmt(cons.spreadBps, 1)} bps across sources`}
                {cons.outliers.length > 0 && ` · outliers: ${cons.outliers.join(", ")}`}
              </caption>
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="num">Price</th>
                  <th className="num">Δ vs consensus</th>
                  <th className="num">Staleness</th>
                  <th className="num">Latency</th>
                </tr>
              </thead>
              <tbody>
                {cons.legs.map((leg) => {
                  const outlier = cons.outliers.includes(leg.provider);
                  return (
                    <tr key={leg.provider}>
                      <td>
                        {/* outlier = icon + word, never colour alone */}
                        {outlier && (
                          <span aria-hidden style={{ color: "var(--status-warning)" }}>▲ </span>
                        )}
                        {leg.label}
                        {leg.delayed && <span className="muted"> (delayed)</span>}
                        {outlier && <span className="muted"> — outlier</span>}
                      </td>
                      <td className="num">{fmt(leg.price, 2)}</td>
                      <td className="num">
                        {leg.deviationBps >= 0 ? "+" : ""}
                        {fmt(leg.deviationBps, 1)} bps
                      </td>
                      <td className="num">{leg.stalenessSec ? `${leg.stalenessSec}s` : "freshest"}</td>
                      <td className="num">{leg.latencyMs}ms</td>
                    </tr>
                  );
                })}
                {cons.legs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No price source is configured — see the providers panel below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- news -------------------------------------------------------- */}
      <div className="card">
        <h2>Headlines — {symbol}</h2>
        {newsNote && <p className="muted" style={{ fontSize: 12.5 }}>{newsNote}</p>}
        {news && news.length === 0 && (
          <p className="muted" style={{ fontSize: 12.5 }}>No stories returned for this symbol.</p>
        )}
        {news && news.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {news.map((n) => (
              <li
                key={n.id}
                style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}
              >
                <a href={n.url} target="_blank" rel="noopener noreferrer">
                  {n.title}
                </a>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {n.source} · {new Date(n.publishedAt).toLocaleString()}
                  {/* null sentiment = not scored; only a real score renders */}
                  {n.sentiment != null &&
                    ` · sentiment ${n.sentiment >= 0 ? "+" : ""}${fmt(n.sentiment, 2)}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- providers --------------------------------------------------- */}
      <div className="card">
        <h2>Data providers</h2>
        <p className="sub">
          Ranked failover across these upstreams. A dark provider needs only its environment
          variable — no code changes.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Status</th>
                <th>Serves</th>
                <th className="num">Quota used</th>
                <th>Enable with</th>
              </tr>
            </thead>
            <tbody>
              {(providers ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.label}</td>
                  <td>
                    {p.circuitOpen ? (
                      <span style={{ color: "var(--status-critical)" }}>✕ degraded</span>
                    ) : p.configured ? (
                      <span style={{ color: "var(--status-good)" }}>● ready</span>
                    ) : (
                      <span className="muted">◌ not configured</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 11.5 }}>
                    {p.capabilities.join(", ")}
                  </td>
                  <td className="num">
                    {p.quota ? `${p.quota.used}/${p.quota.limit} per ${p.quota.window}` : "—"}
                  </td>
                  <td className="num" style={{ fontSize: 11.5 }}>
                    {p.configured ? "" : p.keyEnv}
                  </td>
                </tr>
              ))}
              {providers === null && (
                <tr>
                  <td colSpan={5} className="muted">Loading…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
