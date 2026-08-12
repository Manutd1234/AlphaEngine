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
