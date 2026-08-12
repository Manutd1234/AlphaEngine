"use client";

/**
 * The browser's Supabase client — realtime only, and deliberately narrow.
 *
 * This is the blueprint's Phase 5, and shipping it required reversing a
 * decision the RLS migration made on purpose. Read
 * `supabase/migrations/20260808120700_anon_demo_realtime.sql` before changing
 * anything here: the anon key published to this origin can read exactly one
 * thing — gateway-decided, unowned rows on the public demo desk — and that
 * scope is enforced in Postgres, not here. A client-side filter would be a
 * suggestion; the policy is the boundary.
 *
 * What this client is NOT: an alternative data path. The gateway's DuckDB
 * blotter stays authoritative, `useBook` still polls it, and every number the
 * desk acts on comes from there. This adds a *tape* — new decisions appearing
 * as they land — which is the one thing a poll genuinely cannot do well.
 *
 * `null` when unconfigured, and every caller handles that. A deployment
 * without the two public variables loses the tape and nothing else.
 *
 * There is a second client now — `lib/auth-client.ts`, which holds the signed-in
 * session. The two are separate on purpose; see the note beside `persistSession`
 * below before considering merging them.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

/**
 * Read at module scope, not inside the factory. Next inlines
 * `process.env.NEXT_PUBLIC_*` at build time by *static* substitution, so a
 * dynamic lookup like `process.env[name]` resolves to undefined in the browser
 * bundle — a mistake that reads perfectly and fails only in production.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let client: SupabaseClient | null = null;

/** The shared client, or null when this deployment has no public Supabase config. */
export function supabaseBrowser(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (client) return client;
  client = createClient(url, anonKey, {
    auth: {
      // Anonymous, permanently. Sessions live in `auth-client.ts`; this one
      // must never acquire them, because the tape's rows arrive through a
      // policy scoped `to anon` and RLS policies are role-scoped. A user JWT
      // here would switch Realtime to `authenticated`, that policy would stop
      // applying, and the tape would go empty while still reporting itself
      // live — a silent failure rather than a visible one.
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      params: {
        // The blueprint's throttle. A desk tape that repaints faster than this
        // is unreadable, and each event is a React state update.
        eventsPerSecond: 20,
      },
    },
  });
  return client;
}

export function supabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}
