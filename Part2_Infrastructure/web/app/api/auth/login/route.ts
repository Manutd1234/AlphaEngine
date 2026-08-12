import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { deskCookie } from "@/lib/desk-cookie";

/**
 * Sign in with credentials, or find out which providers can complete.
 * ==================================================================
 *
 * The browser client already signs people in directly, and that path stays — it
 * is what keeps the session in localStorage where GoTrue can refresh it. What
 * this route adds is a server-side sign-in that mints the desk pass in the same
 * hop, and one honest answer about providers.
 *
 * WHY THE PROVIDER LIST LIVES HERE TOO: the browser reads Supabase's public
 * `/auth/v1/settings` to decide which buttons to draw, and when that read is
 * blocked it has to guess. Guessing wrong is what sent people to a Supabase page
 * reading "provider is not enabled". Asked from the server, the read has no CORS
 * or extension in the way, so a client that gets no answer from the direct probe
 * has a second, more reliable source before it decides to draw a button.
 *
 * WHAT THIS DOES NOT DO: return a token. The access token stays out of any
 * response body — the browser gets a pass cookie and nothing it could
 * accidentally log or persist somewhere unwise. A client that needs the session
 * gets it from the Supabase client, which is where it belongs.
 */

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

function projectEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export async function POST(request: NextRequest) {
  const { url, anonKey } = projectEnv();
  if (!url || !anonKey) {
    // Its own status, never "wrong password": there is nothing to be wrong about.
    return NextResponse.json(
      { status: "unconfigured", error: "This deployment has no accounts configured." },
      { status: 501 },
    );
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ status: "error", error: "Expected a JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json(
      { status: "error", error: "Both an email and a password are required." },
      { status: 400 },
    );
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    /**
     * Supabase's own wording, passed through rather than rewritten.
     *
     * It is deliberately vague — "Invalid login credentials" — because saying
     * which half was wrong tells an attacker whether an address has an account.
     * Rewriting it here would be an opportunity to leak that by accident.
     */
    return NextResponse.json(
      { status: "signed-out", error: error?.message ?? "Sign-in failed." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({
    status: "authenticated",
    user: { id: data.user.id, email: data.user.email ?? null },
  });
  response.cookies.set(deskCookie(data.user.id));
  return response;
}

/**
 * Which providers this project can actually complete.
 *
 * Same public settings endpoint the browser reads, asked from the server where
 * nothing can block it. `null` is never returned — an unreachable settings
 * endpoint answers `{ providers: null }`, which the client must treat as
 * "unknown" rather than "none", exactly as it treats its own failed probe.
 */
export async function GET() {
  const { url, anonKey } = projectEnv();
  if (!url || !anonKey) {
    return NextResponse.json({ status: "unconfigured", providers: [] });
  }
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return NextResponse.json({ status: "unknown", providers: null });
    const body = (await response.json()) as { external?: Record<string, unknown> };
    if (!body.external || typeof body.external !== "object") {
      return NextResponse.json({ status: "unknown", providers: null });
    }
    return NextResponse.json({
      status: "ok",
      providers: Object.entries(body.external)
        .filter(([, enabled]) => enabled === true)
        .map(([name]) => name),
    });
  } catch {
    return NextResponse.json({ status: "unknown", providers: null });
  }
}

export const dynamic = "force-dynamic";
