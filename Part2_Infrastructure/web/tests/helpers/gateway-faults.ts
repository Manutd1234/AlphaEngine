/** Deterministic transport faults for gateway-boundary tests.
 *
 * These fixtures never open a socket. They exercise the fetch seam with the
 * same error shapes Node emits, so timeout tests stay bounded and the suite
 * cannot accidentally probe a real gateway from a developer or CI machine.
 */

export interface CapturedGatewayRequest {
  url: string;
  headers: Headers;
}

export function blackHoleFetch(captured: CapturedGatewayRequest[] = []): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    captured.push({ url: String(input), headers: new Headers(init?.headers) });
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }) as typeof fetch;
}

export function transportFailureFetch(code: string): typeof fetch {
  return (async () => {
    throw Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("transport failed"), { code }),
    });
  }) as typeof fetch;
}

export function jsonFetch(
  payload: unknown,
  captured: CapturedGatewayRequest[] = [],
): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    captured.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}
