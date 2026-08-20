"use client";

/**
 * Name and avatar.
 *
 * Split out of `ProfileScreen` with its own state and its own loads: nothing
 * else on the page reads the display name or the signed avatar URL, so keeping
 * them in the screen made four panels' worth of state look like one component's.
 * The screen still owns the banner, because an answer belongs at the top of the
 * page rather than inside the card that produced it.
 *
 * Every hook is above the return and there is no early return at all, which is
 * what `tests/workspace-routing.test.ts` enforces for this file's parent.
 *
 * The two absences it can report are different and stay different: an account
 * with no avatar yet is "absent" and says nothing, a project with no bucket is
 * "unconfigured" and says so.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import { initialsFrom } from "@/components/header/AccountChip";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-flow";
import { AVATAR_BUCKET, DISPLAY_NAME_KEY, avatarPath, isNotConfigured } from "@/lib/profile";
import type { AuthUser } from "@/lib/use-session";

import type { ReportBanner } from "./banner";

export default function ProfileIdentityCard({ user, onBanner }: { user: AuthUser; onBanner: ReportBanner }) {
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarState, setAvatarState] = useState<"idle" | "busy" | "absent" | "unconfigured">("idle");
  const fileInput = useRef<HTMLInputElement>(null);

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
    setDisplayName("");
    const supabase = authClient();
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as Record<string, unknown> | undefined;
      const stored = meta?.[DISPLAY_NAME_KEY];
      if (typeof stored === "string") setDisplayName(stored);
    });
    void loadAvatar(user.id);
  }, [user, loadAvatar]);

  const onSaveName = useCallback(async () => {
    const supabase = authClient();
    if (!supabase) return;
    setSavingName(true);
    onBanner(null);
    const { error } = await supabase.auth.updateUser({
      data: { [DISPLAY_NAME_KEY]: displayName.trim() },
    });
    setSavingName(false);
    onBanner(
      error
        ? { tone: "error", message: describeAuthError(error) }
        : { tone: "context-change", message: "Display name saved." },
    );
  }, [displayName, onBanner]);

  const onUpload = useCallback(async (file: File) => {
    const supabase = authClient();
    if (!supabase) return;
    setAvatarState("busy");
    onBanner(null);
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(avatarPath(user.id), file, { upsert: true, contentType: file.type });
    if (error) {
      setAvatarState(isNotConfigured(error) ? "unconfigured" : "absent");
      onBanner({
        tone: isNotConfigured(error) ? "warn" : "error",
        message: isNotConfigured(error)
          ? "Avatar storage is not set up on this project yet, so there is nowhere to put this."
          : describeAuthError(error),
      });
      return;
    }
    await loadAvatar(user.id);
    onBanner({ tone: "context-change", message: "Avatar updated." });
  }, [user, loadAvatar, onBanner]);

  const onRemoveAvatar = useCallback(async () => {
    const supabase = authClient();
    if (!supabase) return;
    setAvatarState("busy");
    await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath(user.id)]);
    setAvatarUrl(null);
    setAvatarState("absent");
    onBanner({ tone: "context-change", message: "Avatar removed." });
  }, [user, onBanner]);

  const initials = initialsFrom(displayName || null, user.email);

  return (
    <section className="card mt-4 p-5">
      <span className="page-kicker">Identity</span>
      <h2 className="mt-0.5 text-fs-title">Name and avatar</h2>

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
              className="grid h-16 w-16 place-items-center rounded-[50%] border border-border bg-[color-mix(in_srgb,var(--series-1)_14%,var(--surface-2))] text-fs-h1 font-bold text-series-1"
            >
              {initials}
            </span>
          )}
          <span className="text-fs-xs text-text-muted">
            {avatarState === "busy" ? "Working…" : avatarUrl ? "Your avatar" : "Initials"}
          </span>
        </div>

        <div className="min-w-[220px] flex-1">
          <label className="block text-fs-sm font-semibold text-text-secondary" htmlFor="profile-name">
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
          <p className="mt-1.5 text-fs-xs leading-snug text-text-muted">
            Stored against this account under a key no sign-in provider writes to. Using the
            provider&rsquo;s own name field would mean Google or GitHub silently restoring the old
            value the next time you signed in with it.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={savingName}
              onClick={() => void onSaveName()}
              className="rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-fs-body font-semibold text-text-primary hover:bg-surface-2"
            >
              {savingName ? "Saving…" : "Save name"}
            </button>

            {avatarState === "unconfigured" ? (
              <span className="text-fs-xs text-text-muted">
                Avatar storage is not set up on this project yet.
              </span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={avatarState === "busy"}
                  onClick={() => fileInput.current?.click()}
                  className="rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-fs-body font-semibold text-text-primary hover:bg-surface-2"
                >
                  {avatarUrl ? "Replace avatar" : "Upload avatar"}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    disabled={avatarState === "busy"}
                    onClick={() => void onRemoveAvatar()}
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-fs-body font-semibold text-text-secondary hover:bg-surface-2"
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
          <p className="mt-2 text-fs-xs leading-snug text-text-muted">
            Avatars live in a private bucket and are fetched through a signed link that expires.
            Nobody can read yours by guessing its address.
          </p>
        </div>
      </div>
    </section>
  );
}
