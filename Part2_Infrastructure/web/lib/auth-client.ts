"use client";

/**
 * The session-carrying Supabase client — the second of exactly two, and the
 * separation is deliberate.
 *
 * `supabaseClient.ts` is the desk tape: it holds no session, and it must not
 * start holding one. Its rows come from the `to anon` demo policy in
 * `supabase/migrations/20260808120700_anon_demo_realtime.sql`, which is scoped
 * by role — the moment a client carries a user JWT, PostgREST and Realtime
 * evaluate it as `authenticated`, that policy stops applying, and the tape goes
 * silently empty. Not an error; an empty stream that still reports "live". So
 * the tape stays anonymous forever and login happens over here.
 *
 * Two GoTrueClients on one origin normally fight over the same storage key and
 * the same navigator lock. They do not here: the tape client persists nothing
 * (`persistSession: false`), and this one writes under an explicit
 * `storageKey`, so the two never address the same slot.
 *
 * Auth is optional in this deployment. Unconfigured returns null and every
 * caller renders that as "authentication is not configured", never as a fault —
 * the same contract the tape client keeps, and the reason CI can build this
 * app with no Supabase variables set at all.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { authStorage } from "./auth-storage";

/**
 * Read at module scope. Next inlines `process.env.NEXT_PUBLIC_*` by static
 * textual substitution, so a computed lookup resolves to undefined in the
 * browser bundle — code that reads correctly and fails only in production.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Distinct from the tape client's default slot; see the header. */
export const AUTH_STORAGE_KEY = "alphaengine-auth";

/**
 * Short on purpose: this decides which OAuth buttons the sign-in page may draw,
 * so it sits in front of the form's first useful paint. Giving up returns
 * "unknown", which the login screen already handles — a slow answer buys
 * nothing that a fast unknown does not.
 */
const PROVIDER_PROBE_DEADLINE_MS = 4_000;

let client: SupabaseClient | null = null;

/** The shared auth client, or null when this deployment has no Supabase config. */
export function authClient(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (client) return client;
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // PKCE returns `?code=` as a query parameter, which cannot collide with
      // this app's `#view/section` hash routing, and the exchange happens
      // wherever this client first initialises.
      detectSessionInUrl: true,
      flowType: "pkce",
      storage: authStorage,
      storageKey: AUTH_STORAGE_KEY,
    },
  });
  return client;
}

export function authConfigured(): boolean {
  return Boolean(url && anonKey);
}

/**
 * Which OAuth providers this project has actually been given credentials for.
 *
 * `/auth/v1/settings` is public and unauthenticated by design — it is what the
 * hosted Supabase UI reads to decide which buttons to draw. We read it for the
 * same reason: a provider nobody has configured returns "provider is not
 * enabled" when clicked, and a button that fails every time is worse than one
 * that is not there.
 *
 * Returns null when the probe fails, which callers must treat as "unknown"
 * rather than "none". A blocked request is not evidence that a provider is
 * missing, and hiding a working button because the network hiccuped would be
 * the same lie in the other direction. A timeout joins that same null: an
 * abandoned request has learnt nothing about which providers exist.
 */
export async function fetchEnabledProviders(): Promise<Set<string> | null> {
  if (!url || !anonKey) return null;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      cache: "no-store",
      // The login form waits on this to decide which buttons it may draw, so a
      // stalled probe holds up the whole sign-in page. It is a static settings
      // document on Supabase's own edge — anything past a few seconds is not
      // slow, it is not coming.
      signal: AbortSignal.timeout(PROVIDER_PROBE_DEADLINE_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const external = (body as { external?: Record<string, unknown> }).external;
    if (!external || typeof external !== "object") return null;
    return new Set(
      Object.entries(external)
        .filter(([, enabled]) => enabled === true)
        .map(([name]) => name),
    );
  } catch {
    return null;
  }
}
