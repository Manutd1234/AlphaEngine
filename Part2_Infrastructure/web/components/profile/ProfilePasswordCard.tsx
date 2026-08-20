"use client";

/**
 * Change password, and the meter beside it.
 *
 * Split out of `ProfileScreen`; nothing else on the page reads the field, the
 * strength score or the in-flight flag.
 *
 * The meter advises and does not enforce. `assessPassword` is a hand-rolled
 * guess that says so on screen, and a guess that blocks is a guess pretending
 * to be a policy — so the only thing gating the button is
 * `MIN_PASSWORD_LENGTH`, and a sixteen-character run of one letter still
 * scores nothing and still submits. The bar's colour reads the score because
 * that is presentation; the word beside it is what carries the meaning, since
 * the `--status-*` steps are 3.0-3.8:1 and would fail AA as text.
 *
 * A session too old to change a password with is named as a step to take, not
 * printed as a raw GoTrue error.
 */

import { useCallback, useMemo, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-flow";
import { MIN_PASSWORD_LENGTH, assessPassword, needsReauthentication } from "@/lib/profile";

import type { ReportBanner } from "./banner";

export default function ProfilePasswordCard({ onBanner }: { onBanner: ReportBanner }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const strength = useMemo(() => assessPassword(password), [password]);

  const onChangePassword = useCallback(async () => {
    const supabase = authClient();
    if (!supabase) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      onBanner({ tone: "warn", message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    setChangingPassword(true);
    onBanner(null);
    const { error } = await supabase.auth.updateUser({ password });
    setChangingPassword(false);
    if (error) {
      onBanner({
        tone: "error",
        message: needsReauthentication(error)
          ? "This session is too old to change a password with. Sign out, sign in again, "
            + "and the change will go through."
          : describeAuthError(error),
      });
      return;
    }
    setPassword("");
    onBanner({
      tone: "context-change",
      message: "Password changed. Revoke other sessions below if you want them ended too.",
    });
  }, [password, onBanner]);

  return (
    <section className="card mt-4 p-5">
      <span className="page-kicker">Credentials</span>
      <h2 className="mt-0.5 text-fs-title">Change password</h2>
      <p className="mt-1 text-fs-body leading-snug text-text-secondary">
        Change the password first, then revoke other sessions above if you want them ended.
        Doing it the other way round ends this session too, and the change never lands.
      </p>

      <label className="mt-3 block text-fs-sm font-semibold text-text-secondary" htmlFor="profile-password">
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
          className="absolute right-1.5 top-1/2 -translate-y-1/2 border-none bg-transparent px-1.5 py-1 text-fs-sm font-semibold text-text-secondary underline"
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
        <span className="min-w-[72px] text-fs-sm font-semibold text-text-secondary">
          {strength.label}
        </span>
      </div>
      <p className="mt-1.5 max-w-[360px] text-fs-xs leading-snug text-text-muted">
        {strength.hint}
      </p>

      <button
        type="button"
        disabled={changingPassword || password.length < MIN_PASSWORD_LENGTH}
        onClick={() => void onChangePassword()}
        className="mt-3 rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-fs-body font-semibold text-text-primary hover:bg-surface-2 disabled:opacity-[0.55]"
      >
        {changingPassword ? "Changing…" : "Change password"}
      </button>
    </section>
  );
}
