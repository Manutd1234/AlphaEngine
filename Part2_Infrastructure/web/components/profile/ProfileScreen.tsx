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
 * A client component, deliberately. The session lives in localStorage, which is
 * invisible to the server, so a server component could not render a single
 * thing here without a round trip — and it would push `/` toward the smoke
 * probe's budget by forcing dynamic rendering.
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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Link2, ShieldCheck, Trash2, UserRound } from "lucide-react";
import type { Provider, UserIdentity } from "@supabase/supabase-js";

import PageHead from "@/components/workspace/PageHead";
import { initialsFrom } from "@/components/header/AccountChip";
import { authClient, authConfigured, fetchEnabledProviders } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-flow";
import { dateTime } from "@/lib/format";
import {
  AVATAR_BUCKET,
  DISPLAY_NAME_KEY,
  LINKABLE_PROVIDERS,
  MIN_PASSWORD_LENGTH,
  assessPassword,
  avatarPath,
  canUnlink,
  describeDevice,
  describeSessionSource,
  formatIp,
  isNotConfigured,
  needsReauthentication,
  providerLabel,
  type SessionSource,
} from "@/lib/profile";
import { useAuth } from "@/lib/use-session";

interface SessionRow {
  session_id: string | null;
  created_at: string | null;
  refreshed_at: string | null;
  user_agent: string | null;
  ip: string | null;
  is_current: boolean;
  source: SessionSource;
}

/**
 * The same three tones the login screen uses, and `context-change` is the
 * house's success styling — inventing `.banner.good` would be a new stylesheet
 * class for a state that already has one.
 */
type BannerTone = "context-change" | "warn" | "error";
type Banner = { tone: BannerTone; message: string } | null;

/** Milliseconds from an ISO string, or null — never NaN reaching a formatter. */
function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

export default function ProfileScreen() {
  const { user, sessionStatus } = useAuth();

  const [banner, setBanner] = useState<Banner>(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarState, setAvatarState] = useState<"idle" | "busy" | "absent" | "unconfigured">("idle");
  const fileInput = useRef<HTMLInputElement>(null);

  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [identitiesState, setIdentitiesState] = useState<"loading" | "ready" | "unconfigured">("loading");
  const [enabledProviders, setEnabledProviders] = useState<Set<string> | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionsState, setSessionsState] = useState<"loading" | "ready" | "unconfigured">("loading");
  const [revoking, setRevoking] = useState(false);

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const strength = useMemo(() => assessPassword(password), [password]);

  /** Explicit and allow-listed. `window.location.origin` alone is what silently
   *  sends a preview or alias origin back to the project's Site URL instead. */
  const redirectTo = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/profile`),
    [],
  );

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

  const loadAvatar = useCallback(async (userId: string) => {
    const supabase = authClient();
    if (!supabase) return;
    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(avatarPath(userId), 3600);
    if (error || !data?.signedUrl) {
      // "Not found" and "no bucket" are different states and only one of them
      // is worth a sentence — an account with no avatar yet is the normal case.
      setAvatarState(isNotConfigured(error) ? "unconfigured" : "absent");
      setAvatarUrl(null);
      return;
    }
    setAvatarUrl(data.signedUrl);
    setAvatarState("idle");
  }, []);

  useEffect(() => {
    if (!user) return;
    setDisplayName("");
    const supabase = authClient();
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as Record<string, unknown> | undefined;
      const stored = meta?.[DISPLAY_NAME_KEY];
      if (typeof stored === "string") setDisplayName(stored);
    });
    void loadIdentities();
    void loadSessions();
    void loadAvatar(user.id);
    void fetchEnabledProviders().then((enabled) => {
      if (enabled) setEnabledProviders(enabled);
    });
  }, [user, loadIdentities, loadSessions, loadAvatar]);

  const onSaveName = useCallback(async () => {
    const supabase = authClient();
    if (!supabase) return;
    setSavingName(true);
    setBanner(null);
    const { error } = await supabase.auth.updateUser({
      data: { [DISPLAY_NAME_KEY]: displayName.trim() },
    });
    setSavingName(false);
    setBanner(
      error
        ? { tone: "error", message: describeAuthError(error) }
        : { tone: "context-change", message: "Display name saved." },
    );
  }, [displayName]);

  const onUpload = useCallback(async (file: File) => {
    const supabase = authClient();
    if (!supabase || !user) return;
    setAvatarState("busy");
    setBanner(null);
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(avatarPath(user.id), file, { upsert: true, contentType: file.type });
    if (error) {
      setAvatarState(isNotConfigured(error) ? "unconfigured" : "absent");
      setBanner({
        tone: isNotConfigured(error) ? "warn" : "error",
        message: isNotConfigured(error)
          ? "Avatar storage is not set up on this project yet, so there is nowhere to put this."
          : describeAuthError(error),
      });
      return;
    }
    await loadAvatar(user.id);
    setBanner({ tone: "context-change", message: "Avatar updated." });
  }, [user, loadAvatar]);

  const onRemoveAvatar = useCallback(async () => {
    const supabase = authClient();
    if (!supabase || !user) return;
    setAvatarState("busy");
    await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath(user.id)]);
    setAvatarUrl(null);
    setAvatarState("absent");
    setBanner({ tone: "context-change", message: "Avatar removed." });
  }, [user]);

  const onLink = useCallback(async (provider: string) => {
    const supabase = authClient();
    if (!supabase) return;
    setLinkBusy(provider);
    setBanner(null);
    const { error } = await supabase.auth.linkIdentity({
      provider: provider as Provider,
      options: { redirectTo },
    });
    if (error) {
      setLinkBusy(null);
      setBanner({ tone: "error", message: describeAuthError(error) });
    }
    // No success branch: a successful call navigates away to the provider.
  }, [redirectTo]);

  const onUnlink = useCallback(async (identity: UserIdentity) => {
    const supabase = authClient();
    if (!supabase) return;
    setLinkBusy(identity.provider);
    setBanner(null);
    const { error } = await supabase.auth.unlinkIdentity(identity);
    setLinkBusy(null);
    if (error) {
      setBanner({ tone: "error", message: describeAuthError(error) });
      return;
    }
    await loadIdentities();
    setBanner({ tone: "context-change", message: `${providerLabel(identity.provider)} unlinked.` });
  }, [loadIdentities]);

  const onRevokeOthers = useCallback(async () => {
    const supabase = authClient();
    if (!supabase) return;
    setRevoking(true);
    setBanner(null);
    // Called directly rather than through `signOutUser()`, which defaults to
    // scope 'global' and would end this session too — after which the password
    // form below would 401 on the next thing you did.
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setRevoking(false);
    if (error) {
      setBanner({ tone: "error", message: describeAuthError(error) });
      return;
    }
    await loadSessions();
    setBanner({
      tone: "context-change",
      // Not "signed out everywhere". Access tokens cannot be revoked, so other
      // devices keep working until their current one expires.
      message: "Other sessions revoked. Their access ends within the hour, as issued tokens run out.",
    });
  }, [loadSessions]);

  const onChangePassword = useCallback(async () => {
    const supabase = authClient();
    if (!supabase) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setBanner({ tone: "warn", message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    setChangingPassword(true);
    setBanner(null);
    const { error } = await supabase.auth.updateUser({ password });
    setChangingPassword(false);
    if (error) {
      setBanner({
        tone: "error",
        message: needsReauthentication(error)
          ? "This session is too old to change a password with. Sign out, sign in again, "
            + "and the change will go through."
          : describeAuthError(error),
      });
      return;
    }
    setPassword("");
    setBanner({
      tone: "context-change",
      message: "Password changed. Revoke other sessions below if you want them ended too.",
    });
  }, [password]);

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
          <h2 className="text-[16px]">Sign in to manage your account</h2>
          <p className="mt-1 text-[13px] leading-snug text-text-secondary">
            This page manages an identity. The desk itself needs no account and stays fully
            browsable without one.
          </p>
          <a href="/login" className="primary-action mt-4 text-center">Sign in</a>
        </div>
      </Shell>
    );
  }

  const identityCount = identities?.length ?? 0;
  const linked = new Set((identities ?? []).map((identity) => identity.provider));
  const source: SessionSource = sessions?.[0]?.source ?? "sessions";
  const otherSessions = (sessions ?? []).filter((row) => !row.is_current).length;
  const initials = initialsFrom(displayName || null, user.email);

  return (
    <Shell>
      <PageHead
        kicker="Account"
        title="Security centre"
        description="Who this account is, what it is connected to, and where it is signed in."
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

      {/* ---- identity ---- */}
      <section className="card mt-4 p-5">
        <span className="page-kicker">Identity</span>
        <h2 className="mt-0.5 text-[16px]">Name and avatar</h2>

        <div className="mt-4 flex flex-wrap items-start gap-4">
          <div className="flex flex-col items-center gap-2">
            {avatarUrl ? (
              // A plain img, not next/image: there is no images.remotePatterns
              // in next.config.mjs, so the optimiser would refuse this host at
              // runtime. onError falls back to initials rather than leaving a
              // broken-image glyph where a face should be.
              <img
                src={avatarUrl}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 rounded-[50%] border border-border object-cover"
                onError={() => setAvatarUrl(null)}
              />
            ) : (
              <span
                aria-hidden
                className="grid h-16 w-16 place-items-center rounded-[50%] border border-border bg-[color-mix(in_srgb,var(--series-1)_14%,var(--surface-2))] text-[22px] font-bold text-series-1"
              >
                {initials}
              </span>
            )}
            <span className="text-[11.5px] text-text-muted">
              {avatarState === "busy" ? "Working…" : avatarUrl ? "Your avatar" : "Initials"}
            </span>
          </div>

          <div className="min-w-[220px] flex-1">
            <label className="block text-[12px] font-semibold text-text-secondary" htmlFor="profile-name">
              Display name
            </label>
            <input
              id="profile-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={user.email ?? "Your name"}
              autoComplete="name"
              className="mt-1 w-full"
            />
            <p className="mt-1.5 text-[11.5px] leading-snug text-text-muted">
              Stored against this account under a key no sign-in provider writes to. Using the
              provider&rsquo;s own name field would mean Google or GitHub silently restoring the old
              value the next time you signed in with it.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={savingName}
                onClick={() => void onSaveName()}
                className="rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-[12.5px] font-semibold text-text-primary hover:bg-surface-2"
              >
                {savingName ? "Saving…" : "Save name"}
              </button>

              {avatarState === "unconfigured" ? (
                <span className="text-[11.5px] text-text-muted">
                  Avatar storage is not set up on this project yet.
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={avatarState === "busy"}
                    onClick={() => fileInput.current?.click()}
                    className="rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-[12.5px] font-semibold text-text-primary hover:bg-surface-2"
                  >
                    {avatarUrl ? "Replace avatar" : "Upload avatar"}
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      disabled={avatarState === "busy"}
                      onClick={() => void onRemoveAvatar()}
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-[12.5px] font-semibold text-text-secondary hover:bg-surface-2"
                    >
                      <Trash2 size={13} aria-hidden />
                      Remove
                    </button>
                  )}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      // Reset first: picking the same file twice must still fire.
                      event.target.value = "";
                      if (file) void onUpload(file);
                    }}
                  />
                </>
              )}
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-text-muted">
              Avatars live in a private bucket and are fetched through a signed link that expires.
              Nobody can read yours by guessing its address.
            </p>
          </div>
        </div>
      </section>

      {/* ---- connected accounts ---- */}
      <section className="card mt-4 p-5">
        <span className="page-kicker">Sign-in methods</span>
        <h2 className="mt-0.5 text-[16px]">Connected accounts</h2>

        {identitiesState === "unconfigured" ? (
          <p className="mt-2 text-[12.5px] leading-snug text-text-secondary">
            Identity linking is not available on this project.
          </p>
        ) : identitiesState === "loading" ? (
          <span className="skeleton mt-3 block h-[11px] w-[60%]" />
        ) : (
          <>
            <ul className="mt-3 flex list-none flex-col gap-2 p-0">
              {(identities ?? []).map((identity) => (
                <li
                  key={identity.identity_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-grid bg-surface-2 px-3 py-2"
                >
                  <span className="text-[12.5px] font-semibold">
                    {providerLabel(identity.provider)}
                  </span>
                  <button
                    type="button"
                    disabled={!canUnlink(identityCount) || linkBusy === identity.provider}
                    onClick={() => void onUnlink(identity)}
                    aria-describedby={canUnlink(identityCount) ? undefined : "profile-unlink-note"}
                    className="rounded-[8px] border border-border bg-surface-1 px-2.5 py-1.5 text-[12px] font-semibold text-text-secondary hover:bg-surface-2 disabled:opacity-[0.55]"
                  >
                    {linkBusy === identity.provider ? "Working…" : "Unlink"}
                  </button>
                </li>
              ))}
            </ul>

            {!canUnlink(identityCount) && (
              <p id="profile-unlink-note" className="mt-2 text-[11.5px] leading-snug text-text-muted">
                Unlink needs a second method to fall back on. With one, removing it would leave no
                way into this account, so the library refuses and this stays disabled.
              </p>
            )}

            <div className="mt-3 border-t border-grid pt-3">
              <span className="text-[12px] font-semibold text-text-secondary">Add a method</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {LINKABLE_PROVIDERS.filter((provider) => !linked.has(provider.id)).map((provider) => {
                  const known = enabledProviders?.has(provider.id) ?? true;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      disabled={!known || linkBusy === provider.id}
                      title={known ? undefined : "Not configured for this deployment"}
                      onClick={() => void onLink(provider.id)}
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-[12.5px] font-semibold text-text-primary hover:bg-surface-2 disabled:opacity-[0.55]"
                    >
                      <Link2 size={13} aria-hidden />
                      {provider.label}
                    </button>
                  );
                })}
                {LINKABLE_PROVIDERS.every((provider) => linked.has(provider.id)) && (
                  <span className="text-[11.5px] text-text-muted">Every provider is already linked.</span>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* ---- sessions ---- */}
      <section className="card mt-4 p-5">
        <span className="page-kicker">Devices</span>
        <h2 className="mt-0.5 text-[16px]">Active sessions</h2>

        {sessionsState === "unconfigured" ? (
          <p className="mt-2 text-[12.5px] leading-snug text-text-secondary">
            The session listing is not installed on this project, so this cannot say where the
            account is signed in.
          </p>
        ) : sessionsState === "loading" ? (
          <span className="skeleton mt-3 block h-[11px] w-[60%]" />
        ) : (
          <>
            <p className="mt-1 text-[12.5px] leading-snug text-text-secondary">
              {describeSessionSource(source, sessions?.length ?? 0)}
            </p>
            <ul className="mt-3 flex list-none flex-col gap-2 p-0">
              {(sessions ?? []).map((row, index) => {
                const seen = msOf(row.refreshed_at) ?? msOf(row.created_at);
                return (
                  <li
                    key={row.session_id ?? `row-${index}`}
                    className="rounded-[9px] border border-grid bg-surface-2 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12.5px] font-semibold" title={row.user_agent ?? undefined}>
                        {describeDevice(row.user_agent)}
                      </span>
                      {/* Word, not a coloured dot. A dot alone carries nothing
                          for a reader who cannot see the colour. */}
                      {row.is_current && (
                        <span className="rounded-[6px] border border-border px-1.5 py-0.5 text-[11px] font-semibold text-success-text">
                          This device
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11.5px] text-text-muted">
                      {seen ? `Last active ${dateTime(seen)}` : "Last active unknown"}
                      {row.ip ? `, reported from ${formatIp(row.ip)}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>

            {otherSessions > 0 && (
              <button
                type="button"
                disabled={revoking}
                onClick={() => void onRevokeOthers()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-[9px] border border-[color-mix(in_srgb,var(--status-critical)_45%,var(--border))] bg-surface-1 px-3 py-2 text-[12.5px] font-semibold text-critical-text hover:bg-[color-mix(in_srgb,var(--status-critical)_8%,var(--surface-1))]"
              >
                <ShieldCheck size={13} aria-hidden />
                {revoking ? "Revoking…" : `Revoke ${otherSessions} other session${otherSessions === 1 ? "" : "s"}`}
              </button>
            )}
          </>
        )}
      </section>

      {/* ---- password ---- */}
      <section className="card mt-4 p-5">
        <span className="page-kicker">Credentials</span>
        <h2 className="mt-0.5 text-[16px]">Change password</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-text-secondary">
          Change the password first, then revoke other sessions above if you want them ended.
          Doing it the other way round ends this session too, and the change never lands.
        </p>

        <label className="mt-3 block text-[12px] font-semibold text-text-secondary" htmlFor="profile-password">
          New password
        </label>
        <div className="relative mt-1 flex max-w-[360px]">
          <input
            id="profile-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            className="w-full pr-[68px]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-pressed={showPassword}
            aria-controls="profile-password"
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 border-none bg-transparent px-1.5 py-1 text-[12px] font-semibold text-text-secondary underline"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        {/* The bar is a fill, which is what --status-* steps are for; the word
            beside it is what actually carries the meaning. */}
        <div className="mt-2 flex max-w-[360px] items-center gap-2">
          <span
            aria-hidden
            className="h-[5px] flex-1 overflow-hidden rounded-[3px] bg-surface-3"
          >
            <span
              className="block h-full rounded-[3px] transition-[width] duration-(--dur-fast) ease-(--ease)"
              style={{
                width: `${(strength.score / 4) * 100}%`,
                // A fill, which is exactly what the --status-* steps are for.
                // They are 3.0-3.8:1 on white and would fail AA as text, which
                // is why the word beside the bar is the thing that carries the
                // meaning and this is only reinforcement.
                background:
                  strength.score >= 3 ? "var(--status-good)"
                  : strength.score === 2 ? "var(--status-warning)"
                  : "var(--status-critical)",
              }}
            />
          </span>
          <span className="min-w-[72px] text-[12px] font-semibold text-text-secondary">
            {strength.label}
          </span>
        </div>
        <p className="mt-1.5 max-w-[360px] text-[11.5px] leading-snug text-text-muted">
          {strength.hint}
        </p>

        <button
          type="button"
          disabled={changingPassword || password.length < MIN_PASSWORD_LENGTH}
          onClick={() => void onChangePassword()}
          className="mt-3 rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-[12.5px] font-semibold text-text-primary hover:bg-surface-2 disabled:opacity-[0.55]"
        >
          {changingPassword ? "Changing…" : "Change password"}
        </button>
      </section>
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
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-secondary no-underline hover:underline"
      >
        <ArrowLeft size={13} aria-hidden />
        Back to the workspace
      </a>
      {children}
      <p className="mt-6 flex items-center gap-1.5 text-[11.5px] text-text-muted">
        <UserRound size={12} aria-hidden />
        AlphaEngine stores workspace preferences against this account. It holds no funds and places
        no real orders.
      </p>
    </main>
  );
}
