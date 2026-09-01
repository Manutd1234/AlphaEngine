"use client";

/** Attach an account proof to the one coherence read that can return private data. */

import { authClient } from "@/lib/auth-client";

const RFQ_ROUTE = "/api/gateway/coherence/rfq";
const SESSION_READ_TIMEOUT_MS = 2_000;

export type RfqSessionReader = () => Promise<string | null>;

/** An authorization failure revokes the right to keep drawing a prior private snapshot. */
export function shouldDiscardRfqSnapshot(url: string, code: unknown): boolean {
  return url === RFQ_ROUTE && typeof code === "string" && code.startsWith("rfq_auth_");
}

async function currentAccessToken(): Promise<string | null> {
  const session = await authClient()?.auth.getSession();
  return session?.data.session?.access_token?.trim() || null;
}

/**
 * Return a bearer only for the exact same-origin RFQ route.
 *
 * An absolute lookalike URL must never receive the session token. A missing,
 * failed or slow session read returns no header and the server fails closed
 * before contacting the gateway.
 */
export async function rfqAuthorizationHeaders(
  url: string,
  readSession: RfqSessionReader = currentAccessToken,
): Promise<Record<string, string>> {
  if (url !== RFQ_ROUTE) return {};

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SESSION_READ_TIMEOUT_MS);
    });
    const token = await Promise.race([readSession(), timeout]);
    return token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};
  } catch {
    return {};
  } finally {
    if (timer) clearTimeout(timer);
  }
}
