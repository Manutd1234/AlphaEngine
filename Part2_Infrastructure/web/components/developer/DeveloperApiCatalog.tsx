"use client";

import { useDeferredValue, useMemo, useState } from "react";

type ApiGroup = "market" | "research" | "gateway" | "system";
type ApiMethod = "GET" | "POST" | "DELETE";

interface ApiOperation {
  method: ApiMethod;
  path: string;
  purpose: string;
  group: ApiGroup;
}

const GROUP_LABEL: Record<ApiGroup, string> = {
  market: "Market data",
  research: "Research",
  gateway: "Gateway",
  system: "System",
};

export const API_OPERATIONS: readonly ApiOperation[] = [
  { method: "GET", path: "/api/quote?symbols=BTCUSDT,ETHUSDT", purpose: "Normalised quotes with provider provenance", group: "market" },
  { method: "GET", path: "/api/ohlcv?symbol=BTCUSDT&interval=4h&bars=500", purpose: "Historical bars and source warnings", group: "market" },
  { method: "GET", path: "/api/depth?symbol=BTCUSDT", purpose: "Cross-venue level-two snapshot", group: "market" },
  { method: "GET", path: "/api/tca?symbol=BTCUSDT&side=BUY&notional=100000", purpose: "Pre-trade cost and routing estimate", group: "market" },
  { method: "GET", path: "/api/markets", purpose: "Supported market and instrument inventory", group: "market" },
  { method: "GET", path: "/api/news?symbol=BTCUSDT", purpose: "Normalised news with source metadata", group: "market" },
  { method: "GET", path: "/api/fundamentals?symbol=AAPL", purpose: "Normalised company fundamentals", group: "market" },
  { method: "GET", path: "/api/ticker?symbol=BTCUSDT", purpose: "Single-symbol ticker compatibility route", group: "market" },
  { method: "GET", path: "/api/providers", purpose: "Provider, quota, and circuit readiness", group: "market" },
  { method: "POST", path: "/api/backtest", purpose: "Synchronous parameter sweep", group: "research" },
  { method: "GET", path: "/api/research?symbol=BTCUSDT", purpose: "Research-service proxy and evidence lookup", group: "research" },
  { method: "GET", path: "/api/gateway/audit?feed=orders", purpose: "Audited orders and risk events", group: "gateway" },
  { method: "GET", path: "/api/gateway/orders", purpose: "Order blotter from the authoritative gateway", group: "gateway" },
  { method: "POST", path: "/api/gateway/orders", purpose: "Risk-gated paper-order submission", group: "gateway" },
  { method: "GET", path: "/api/gateway/orders/working", purpose: "Orders resting on the book right now", group: "gateway" },
  { method: "POST", path: "/api/gateway/orders/{id}/cancel", purpose: "Pull one resting order (operator-gated)", group: "gateway" },
  { method: "POST", path: "/api/gateway/orders/{id}/replace", purpose: "Cancel-and-new at a fresh limit (operator-gated)", group: "gateway" },
  { method: "GET", path: "/api/gateway/portfolio", purpose: "Authoritative portfolio and risk state", group: "gateway" },
  { method: "GET", path: "/api/gateway/portfolio/history", purpose: "Persisted equity snapshots and period P&L", group: "gateway" },
  { method: "GET", path: "/api/gateway/risk", purpose: "Kill-switch and risk-control state", group: "gateway" },
  { method: "POST", path: "/api/gateway/risk", purpose: "Authenticated risk-control action", group: "gateway" },
  { method: "GET", path: "/api/system/actions", purpose: "Operator guard and action capabilities", group: "system" },
  { method: "POST", path: "/api/system/actions", purpose: "Purge, breaker, outage, or probe action", group: "system" },
  { method: "GET", path: "/api/system/events?since=0", purpose: "Structured trace cursored by sequence", group: "system" },
  { method: "GET", path: "/api/system/health", purpose: "Providers, breakers, latency, failover, and cache", group: "system" },
  { method: "GET", path: "/api/system/inspect?symbol=BTCUSDT&raw=1", purpose: "One request with route and raw-payload lineage", group: "system" },

  /*
   * The nine routes this catalogue had never listed.
   *
   * It claimed "26 web API operations · 23 route handlers" while the app
   * shipped 32 route files — every auth surface, both Oracle backends, the
   * research RAG proxy, favourites and the Telegram connect mint were absent.
   * The count was not wrong about its own list; the list was nine routes short,
   * which is the harder version of the same defect, because the arithmetic
   * checks out and the inventory is still a lie.
   *
   * That matters more here than almost anywhere: this is the panel a reviewer
   * opens to ask what the API surface IS. `tests/api-catalogue.test.ts` now
   * diffs this array against the filesystem, so the next route cannot be added
   * without appearing here.
   */
  { method: "POST", path: "/api/auth/guest", purpose: "Seed a guest desk pass for this browser", group: "system" },
  { method: "GET", path: "/api/auth/login", purpose: "Configured sign-in providers", group: "system" },
  { method: "POST", path: "/api/auth/login", purpose: "Exchange credentials for a desk session", group: "system" },
  { method: "POST", path: "/api/auth/logout", purpose: "End this browser's desk session", group: "system" },
  { method: "GET", path: "/api/auth/session", purpose: "Current identity and active sessions", group: "system" },
  { method: "DELETE", path: "/api/auth/session", purpose: "Revoke one session by id", group: "system" },
  { method: "GET", path: "/api/telegram/link", purpose: "Mint a single-use Telegram connect token", group: "system" },
  { method: "POST", path: "/api/favourites", purpose: "Pin or unpin a research run for this identity", group: "research" },
  { method: "POST", path: "/api/gateway/research/rag", purpose: "Retrieval over the research corpus", group: "gateway" },
  { method: "POST", path: "/api/oracle/research", purpose: "Oracle-backed research retrieval (optional backend)", group: "research" },
  { method: "POST", path: "/api/oracle/var", purpose: "Oracle-backed value-at-risk (optional backend)", group: "research" },
] as const;

const API_ROUTE_HANDLER_COUNT = new Set(
  API_OPERATIONS.map((operation) => operation.path.split("?", 1)[0]),
).size;

export default function DeveloperApiCatalog() {
  const [group, setGroup] = useState<ApiGroup | "all">("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [announcement, setAnnouncement] = useState("");

  const visibleOperations = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase();
    return API_OPERATIONS.filter((operation) => {
      if (group !== "all" && operation.group !== group) return false;
      if (!needle) return true;
      return [operation.method, operation.path, operation.purpose, GROUP_LABEL[operation.group]]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [deferredQuery, group]);

  const copyOperation = async (operation: ApiOperation) => {
    const origin = window.location.origin;
    const command = operation.method === "GET"
      ? `curl '${origin}${operation.path}'`
      : `curl -X POST '${origin}${operation.path}' -H 'Content-Type: application/json' -d '{}'`;
    try {
      await navigator.clipboard.writeText(command);
      setAnnouncement(`Copied ${operation.method} ${operation.path}.`);
    } catch {
      setAnnouncement("Clipboard access was blocked; select the path directly instead.");
    }
  };

  return (
    <div className="card developer-api-catalog">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Developer surface</span>
          <h2>{API_OPERATIONS.length} web API operations</h2>
        </div>
        <span className="section-note">{API_ROUTE_HANDLER_COUNT} route handlers, grouped by responsibility</span>
      </div>

      <div className="developer-api-catalog__toolbar">
        <label>
          <span>Search operations</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Path or purpose…" />
        </label>
        <div className="seg developer-api-catalog__groups" role="group" aria-label="Filter API operations by domain">
          <button type="button" aria-pressed={group === "all"} onClick={() => setGroup("all")}>All <span>{API_OPERATIONS.length}</span></button>
          {(Object.keys(GROUP_LABEL) as ApiGroup[]).map((apiGroup) => (
            <button key={apiGroup} type="button" aria-pressed={group === apiGroup} onClick={() => setGroup(apiGroup)}>
              {GROUP_LABEL[apiGroup]} <span>{API_OPERATIONS.filter((operation) => operation.group === apiGroup).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="developer-api-catalog__list">
        {visibleOperations.map((operation) => (
          <div className="developer-api-row" key={`${operation.method}-${operation.path}`}>
            <span className={`method-badge method-${operation.method.toLocaleLowerCase()}`}>{operation.method}</span>
            <div>
              <code>{operation.path}</code>
              <span>{GROUP_LABEL[operation.group]}</span>
            </div>
            <p>{operation.purpose}</p>
            <button type="button" onClick={() => void copyOperation(operation)} aria-label={`Copy curl command for ${operation.method} ${operation.path}`}>
              Copy curl
            </button>
          </div>
        ))}
        {!visibleOperations.length && (
          <div className="developer-api-catalog__empty">
            <strong>No matching operations</strong>
            <span>Clear the search or choose another API domain.</span>
          </div>
        )}
      </div>

      <div className="developer-api-catalog__footer">
        <p>
          Browser market-data routes are signals, not execution authority. Portfolio, order, and
          risk writes remain behind the authenticated gateway.
        </p>
        <span aria-live="polite">{announcement || `${visibleOperations.length} operations shown.`}</span>
      </div>
    </div>
  );
}
