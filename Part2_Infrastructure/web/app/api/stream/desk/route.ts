import { NextRequest } from "next/server";

import { GATEWAY_TOKEN_ENV, GATEWAY_URL_ENV, gatewayBase } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stream/desk — the desk's risk state, pushed rather than polled.
 *
 * **Why this proxies instead of the browser connecting directly.** The page is
 * served over HTTPS and the gateway answers plain HTTP on port 8000. No browser
 * will open an `EventSource` across that boundary — it is blocked as mixed
 * content with no override and no user-facing prompt. Server-to-server has no
 * such rule, which is the same reason every other gateway call in this app is
 * proxied. The extra hop measured 21–27ms against a book the gateway re-marks
 * once a second, so it is not a meaningful cost.
 *
 * **The bearer token stays on the server.** It is attached here and never
 * reaches the client, which is the second reason not to connect directly even
 * once the gateway has TLS.
 *
 * **Backpressure is the client's, not ours.** The gateway emits only on change,
 * so an idle desk costs one heartbeat comment every 15s. This route copies
 * bytes through without buffering or re-framing: it must not parse the stream,
 * because re-serialising would break `Last-Event-ID` resumption and turn a
 * transparent pipe into a second thing that can be wrong.
 */
export async function GET(request: NextRequest) {
  const base = gatewayBase();
  const token = process.env[GATEWAY_TOKEN_ENV]?.trim();

  if (!base) {
    // Deliberately a 503 with a typed body rather than an empty stream. An
    // EventSource that connects and receives nothing is indistinguishable from
    // a healthy but quiet desk, and the panel would sit on stale numbers
    // claiming to be live.
    return Response.json(
      {
        state: "unconfigured",
        error: `Live updates need the gateway. Set ${GATEWAY_URL_ENV} and ${GATEWAY_TOKEN_ENV}.`,
      },
      { status: 503 },
    );
  }

  const upstream = new URL("/api/stream/desk", base);
  // Resume where the client left off. EventSource replays the last id it saw
  // automatically on reconnect, and forwarding it is what lets the gateway tell
  // "nothing changed while you were gone" from "you missed something".
  const lastEventId = request.headers.get("last-event-id");

  let response: Response;
  try {
    response = await fetch(upstream, {
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
      },
      // No timeout: this request is meant to stay open. The client's own
      // disconnect is what ends it, propagated below.
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { state: "unavailable", error: "The gateway did not accept a stream connection." },
      { status: 502 },
    );
  }

  if (!response.ok || !response.body) {
    return Response.json(
      { state: "unavailable", error: `The gateway refused the stream (${response.status}).` },
      { status: 502 },
    );
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Vercel's edge will otherwise buffer a streamed response and deliver it
      // in one piece at close, which is the whole point defeated.
      "X-Accel-Buffering": "no",
    },
  });
}
