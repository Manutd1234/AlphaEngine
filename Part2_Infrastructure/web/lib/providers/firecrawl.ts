/**
 * Firecrawl — the open web as a data source.
 *
 * The other six providers answer questions that already have a schema: what did
 * it close at, what is the P/E. Firecrawl covers the part of research that does
 * not — an exchange notice, a regulator's announcement, a protocol blog, an
 * 8-K's actual text. For a desk this is where the signal is that has not yet
 * been normalised into anyone's price API.
 *
 * Two guardrails, because this one reaches arbitrary URLs on our behalf:
 *
 *  1. **SSRF.** `scrape` is exposed through an HTTP route that takes a URL from
 *     the caller. It is Firecrawl's infrastructure that fetches, not ours, so
 *     this is not a classic SSRF against our own network — but we still refuse
 *     non-HTTP(S) schemes and private/loopback hosts at the edge rather than
 *     relying on a third party's egress policy to be the only control.
 *  2. **Credits are money.** 1,000/month on the free tier and a crawl can spend
 *     many per call, so search results are capped and the cache TTL is an hour.
 */

import { arr, iso, num, obj, str } from "./parse";
import { Adapter, Document, FetchCtx, ProviderError } from "./types";

const ID = "firecrawl";

/**
 * Reject schemes and hosts that have no business in a research fetch.
 *
 * Blocking on hostname *shape* rather than resolving DNS is deliberate: a
 * resolve-then-fetch check is a TOCTOU race, and since the actual fetch happens
 * on Firecrawl's side we cannot pin the address anyway. This is a coarse filter
 * on obvious internal targets, and it is stated as such.
 */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ProviderError(ID, "not a valid URL", 400, false);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ProviderError(ID, `scheme ${u.protocol} is not allowed`, 400, false);
  }
  const host = u.hostname.toLowerCase();
  const private_ =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host); // link-local — the cloud metadata endpoint lives here
  if (private_) {
    throw new ProviderError(ID, `host ${host} is not publicly routable`, 400, false);
  }
  return u;
}

function post(ctx: FetchCtx, path: string, body: unknown): Promise<unknown> {
  return ctx.json(`${ctx.baseUrl}/v2/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function toDocument(node: unknown, fallbackUrl: string): Document | null {
  const d = obj(node);
  const meta = obj(d["metadata"]);
  const content = str(d["markdown"]) ?? str(d["content"]) ?? str(d["description"]) ?? "";
  const url = str(meta["sourceURL"]) ?? str(d["url"]) ?? fallbackUrl;
  if (!url) return null;
  return {
    url,
    title: str(meta["title"]) ?? str(d["title"]),
    content,
    length: content.length,
    publishedAt: iso(meta["publishedTime"] ?? d["publishedTime"] ?? null),
  };
}

export const firecrawl: Adapter = {
  meta: {
    id: ID,
    label: "Firecrawl",
    docs: "https://docs.firecrawl.dev",
    capabilities: ["search", "scrape"],
    assets: ["equity", "crypto", "fx"],
    keyEnv: "FIRECRAWL_API_KEY",
    baseUrlEnv: "FIRECRAWL_BASE_URL",
    // Credits, not calls — a search with scraping enabled costs more than one.
    // Counting calls under-counts credits, so the reserve is generous.
    quota: { calls: 1_000, window: "month", reserve: 0.3 },
    rank: { search: 1, scrape: 1 },
    signup: "Free key at firecrawl.dev — 1,000 credits/month.",
  },

  async search(query: string, limit: number, ctx: FetchCtx): Promise<Document[]> {
    const payload = obj(
      await post(ctx, "search", {
        query,
        limit: Math.min(10, Math.max(1, limit)),
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
    );
    if (payload["success"] === false) {
      throw new ProviderError(ID, str(payload["error"]) ?? "search failed", 400, false);
    }
    // v2 groups results by source (`data.web`), v1 returned a flat `data` array.
    // Both are accepted so a pinned older deployment keeps working.
    const container = payload["data"];
    const rows = Array.isArray(container) ? container : arr(obj(container)["web"]);
    return rows
      .map((r) => toDocument(r, ""))
      .filter((d): d is Document => d !== null)
      .slice(0, limit);
  },

  async scrape(rawUrl: string, ctx: FetchCtx): Promise<Document> {
    const url = assertPublicUrl(rawUrl);
    const payload = obj(
      await post(ctx, "scrape", {
        url: url.toString(),
        formats: ["markdown"],
        onlyMainContent: true,
        blockAds: true,
        // Firecrawl's own ceiling, below our 8s HTTP timeout would be pointless:
        // this is the budget it spends before giving up, not our wait.
        timeout: 20_000,
      }),
    );
    if (payload["success"] === false) {
      throw new ProviderError(ID, str(payload["error"]) ?? "scrape failed", 400, false);
    }
    const doc = toDocument(payload["data"], url.toString());
    if (!doc || !doc.content) {
      throw new ProviderError(ID, `no readable content at ${url.hostname}`, 404, false);
    }
    return doc;
  },
};

/** Exported for tests. */
export const _num = num;
