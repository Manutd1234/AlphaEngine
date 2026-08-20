"use client";

/**
 * The account's security centre — a sibling route to `/login`, not a ninth tab.
 *
 * It is not a workspace view on purpose. `tests/workspace-routing.test.ts`
 * deep-equals the eight nav ids and `app/page.tsx` derives its view union from
 * the same list, so a ninth entry is a change to what the desk *is*. This is
 * not a desk surface; it is where you manage the account that the desk happens
 * to remember preferences for.
 *
 * A client component, deliberately, and this file is where that boundary is
 * drawn. The session lives in localStorage, which is invisible to the server,
 * so a server component could not render a single thing here without a round
 * trip — and it would push `/` toward the smoke probe's budget by forcing
 * dynamic rendering. The four panel files below are imported from here, which
 * puts them inside the same client boundary rather than moving it: what ships
 * to the browser is unchanged by the split.
 *
 * WHAT IS NOT HERE ANY MORE
 *
 * Four cards, each with the state only it reads:
 * `ProfileIdentityCard`, `ProfileConnectionsCard`, `ProfileSessionsCard` and
 * `ProfilePasswordCard`. What stays is what more than one of them needs — the
 * session, the identity and session lists the page head counts, and the single
 * banner every panel reports through, which is drawn once at the top where a
 * scrolled-past card cannot hide an answer.
 *
 * EVERY PANEL DEGRADES
 *
 * The sessions RPC, the avatars bucket and the identity-linking API are each
 * allowed to be absent: CI builds this app with no Supabase project at all, and
 * two of the three depend on privileges this repository cannot prove it has.
 * So each panel renders "not configured" and none of them throw. The rule from
 * `user-prefs.ts` — a missing table is a degradation, not a failure.
 *
 * Every hook is above the first bail-out, which
 * `tests/workspace-routing.test.ts` now enforces for this file: three panels
 * with three independent async loads behind three early returns is the textbook
 * shape for a conditional-hook bug.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import type { UserIdentity } from "@supabase/supabase-js";

import PageHead from "@/components/workspace/PageHead";
import { authClient, authConfigured } from "@/lib/auth-client";
import { describeSessionSource, type SessionSource } from "@/lib/profile";
import { useAuth } from "@/lib/use-session";

import ProfileConnectionsCard from "./ProfileConnectionsCard";
import ProfileIdentityCard from "./ProfileIdentityCard";
import ProfilePasswordCard from "./ProfilePasswordCard";
import ProfileSessionsCard, { type SessionRow } from "./ProfileSessionsCard";
import type { Banner } from "./banner";

export default function ProfileScreen() {
  const { user, sessionStatus } = useAuth();

  const [banner, setBanner] = useState<Banner>(null);

  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [identitiesState, setIdentitiesState] = useState<"loading" | "ready" | "unconfigured">("loading");

  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionsState, setSessionsState] = useState<"loading" | "ready" | "unconfigured">("loading");

  const loadIdentities = useCallback(async () => {
    const supabase = authClient();
    if (!supabase) return;
    const { data, error } = await supabase.auth.getUserIdentities();
    if (error || !data) {
      setIdentitiesState("unconfigured");
      return;
    }
    setIdentities(data.identities);
    setIdentitiesState("ready");
  }, []);

  const loadSessions = useCallback(async () => {
    const supabase = authClient();
    if (!supabase) return;
    const { data, error } = await supabase.rpc("list_my_sessions");
    if (error) {
      // A project without the migration applied is a state this page renders,
      // not an error it reports. Anything else is still not actionable here.
      setSessionsState("unconfigured");
      return;
    }
    setSessions((data ?? []) as SessionRow[]);
    setSessionsState("ready");
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadIdentities();
    void loadSessions();
  }, [user, loadIdentities, loadSessions]);

  // ---- bail-outs, all of them below every hook -----------------------------

  if (!authConfigured()) {
    return (
      <Shell>
        <div className="banner warn" role="status">
          <span aria-hidden>◌</span>
          <div>
            Authentication is not configured in this deployment, so there is no account to manage.
            The workspace is fully browsable without one.
          </div>
        </div>
      </Shell>
    );
  }

  if (sessionStatus === "loading") {
    return (
      <Shell>
        <div className="card p-5">
          <span className="skeleton block h-[13px] w-[160px]" />
          <span className="skeleton mt-3 block h-[11px] w-full" />
          <span className="skeleton mt-2 block h-[11px] w-[70%]" />
        </div>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <div className="card p-5">
          <h2 className="text-fs-title">Sign in to manage your account</h2>
          <p className="mt-1 text-fs-md leading-snug text-text-secondary">
            The desk itself needs no account and stays fully browsable without one.
          </p>
          <a href="/login" className="primary-action mt-4 text-center">Sign in</a>
        </div>
      </Shell>
    );
  }

  const identityCount = identities?.length ?? 0;
  const source: SessionSource = sessions?.[0]?.source ?? "sessions";

  return (
    <Shell>
      <PageHead
        kicker="Account"
        title="Security centre"
        metrics={[
          {
            label: "Connected",
            value: identitiesState === "ready" ? identityCount : "—",
            note: identitiesState === "ready"
              ? `sign-in method${identityCount === 1 ? "" : "s"}`
              : "not readable",
            mono: false,
          },
          {
            label: "Sessions",
            value: sessionsState === "ready" ? (sessions?.length ?? 0) : "—",
            note: sessionsState === "ready" && source === "jwt" ? "this device only" : "including this one",
            mono: false,
          },
        ]}
      />

      {banner && (
        <div
          className={`banner ${banner.tone} mt-4`}
          role={banner.tone === "error" ? "alert" : "status"}
        >
          <span aria-hidden>{banner.tone === "error" ? "✕" : banner.tone === "warn" ? "◌" : "✓"}</span>
          <div>{banner.message}</div>
        </div>
      )}

      <ProfileIdentityCard user={user} onBanner={setBanner} />

      <ProfileConnectionsCard
        identities={identities}
        identitiesState={identitiesState}
        onReload={loadIdentities}
        onBanner={setBanner}
      />

      <ProfileSessionsCard
        sessions={sessions}
        sessionsState={sessionsState}
        source={source}
        onReload={loadSessions}
        onBanner={setBanner}
      />

      <ProfilePasswordCard onBanner={setBanner} />
    </Shell>
  );
}


/** The page frame, shared by every bail-out so the way back never disappears. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="standalone-scroll mx-auto w-full max-w-[760px] px-5 py-8">
      {/* /dashboard, not "/": the root redirects by cookie now, so linking to it
          from a page only a signed-in visitor can reach costs a needless hop. */}
      <a
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-fs-body font-semibold text-text-secondary no-underline hover:underline"
      >
        <ArrowLeft size={13} aria-hidden />
        Back to the workspace
      </a>
      {children}
      <p className="mt-6 flex items-center gap-1.5 text-fs-xs text-text-muted">
        <UserRound size={12} aria-hidden />
        AlphaEngine stores workspace preferences against this account. It holds no funds and places
        no real orders.
      </p>
    </main>
  );
}
