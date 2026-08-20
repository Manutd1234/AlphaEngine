/**
 * Same-origin proxy for the gateway's risk stream.
 *
 * This route and `lib/use-desk-stream.ts` existed once and were deleted, for a
 * reason `deadlines.test.ts` recorded: the hook had no importer, and it could
 * not reach its own `unconfigured` state because `EventSource` exposes neither
 * the status code nor the body of a response. A deliberate 503 on a
 * gateway-less deployment was therefore invisible to the client, and the panel
 * would have read "Connecting to the live desk feed…" forever — on the public
 * deployment, where that is the normal condition. The test that removed them
 * said re-proxying was "a small job for whoever has a consumer that needs it".
 *
 * There is a consumer now (`useBook`), and the invisible-503 problem has an
 * answer that does not depend on `EventSource` growing new abilities: **the
 * state travels in-band as the first event.** A reader that cannot see status
 * codes can still read data, so this always answers 200 and says what it found
 * in a frame the client is already parsing:
 *
 *     event: desk-state
 *     data: {"state":"unavailable","reason":"gateway_not_configured"}
 *
 * The browser cannot open an EventSource against the gateway itself: the page
 * is HTTPS and the gateway is plain HTTP, which is blocked as mixed content
 * with no override. Hence a proxy rather than a direct connection.
 */

import { gatewayHeaders, gatewayState } from "@/lib/gateway";

export const dynamic = "force-dynamic";
/** Node, not Edge: the Edge runtime caps how long a response may stay open. */
export const runtime = "nodejs";

const encoder = new TextEncoder();

/** One in-band state frame. Always the first thing a client receives. */
function stateFrame(state: "ok" | "unavailable", reason?: string): Uint8Array {
  const body = JSON.stringify(reason ? { state, reason } : { state });
  return encoder.encode(`event: desk-state\ndata: ${body}\n\n`);
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  // The one thing nginx-style intermediaries buffer by default, which turns a
  // push into a batch delivered at close.
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
} as const;

export async function GET(request: Request): Promise<Response> {
  /** 200 with an honest frame, never a status code EventSource cannot read. */
  const refuse = (reason: string) => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(stateFrame("unavailable", reason));
        controller.close();
      },
    }),
    { status: 200, headers: SSE_HEADERS },
  );

  const state = gatewayState();
  if (state.kind !== "url") {
    return refuse(state.kind === "absent" ? "gateway_not_configured" : `gateway_${state.kind}`);
  }
  const base = state.url;

  const upstream = new URL("/api/stream/desk", base);
  let response: Response;
  try {
    response = await fetch(upstream, {
      headers: { ...gatewayHeaders(), accept: "text/event-stream" },
      cache: "no-store",
      // Cancels the upstream read when the browser goes away, so a closed tab
      // does not leave the gateway generating a stream nobody reads.
      signal: request.signal,
    });
  } catch (cause) {
    return refuse(cause instanceof Error && cause.name === "AbortError"
      ? "aborted"
      : "gateway_unreachable");
  }

  if (!response.ok || !response.body) return refuse(`gateway_http_${response.status}`);

  const body = response.body;
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(stateFrame("ok"));
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // The upstream ended or the client went away. Either way the client's
        // own `desk-state` handling and reconnect policy take over; there is
        // nothing useful to say into a stream that is already closing.
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
    cancel() {
      void body.cancel();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
