import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8_000;

/**
 * Same-origin, read-only boundary to the authoritative FastAPI risk gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 */
export async function GET() {
  const configuredBase = process.env.ALPHAENGINE_GATEWAY_URL?.trim();
  const base = configuredBase || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");

  if (!base) {
    return NextResponse.json(
      {
        code: "gateway_not_configured",
        error: "Portfolio gateway is not connected in this environment.",
        hint: "Set ALPHAENGINE_GATEWAY_URL on the server to enable the authoritative portfolio view.",
      },
      { status: 503 },
    );
  }

  let endpoint: URL;
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    endpoint = new URL("/api/portfolio", `${parsed.origin}/`);
  } catch {
    return NextResponse.json(
      { code: "gateway_misconfigured", error: "The configured portfolio gateway URL is invalid." },
      { status: 503 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const token = process.env.ALPHAENGINE_GATEWAY_TOKEN?.trim();

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          code: response.status === 401 || response.status === 403 ? "gateway_auth_failed" : "gateway_unavailable",
          error: response.status === 401 || response.status === 403
            ? "The portfolio gateway rejected the server credential."
            : `The portfolio gateway responded with HTTP ${response.status}.`,
        },
        { status: response.status === 401 || response.status === 403 ? 502 : 503 },
      );
    }

    const payload = await response.json();
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        code: timedOut ? "gateway_timeout" : "gateway_unavailable",
        error: timedOut
          ? "The portfolio gateway did not answer in time."
          : "The portfolio gateway is currently unreachable.",
      },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
