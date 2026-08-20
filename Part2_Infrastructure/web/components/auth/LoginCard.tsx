"use client";

/**
 * The sign-in card itself: banner, form, providers, and the link that swaps
 * modes.
 *
 * Presentation only. Every decision it renders was already made in
 * `LoginScreen` — which mode is showing, whether the provider probe has
 * answered, which providers may be offered — and arrives as a prop. The split
 * is what keeps the screen's effects, deadlines and Supabase calls readable
 * beside the markup they end up drawing; nothing here calls Supabase, and
 * nothing here decides what a reader is allowed to click.
 */

import type { Banner, FormMode, PROVIDERS } from "@/components/auth/login-copy";
import type { Provider } from "@supabase/supabase-js";

interface LoginCardProps {
  copy: { title: string; blurb: string; submit: string };
  banner: Banner | null;
  mode: FormMode;
  email: string;
  onEmailChange: (next: string) => void;
  password: string;
  onPasswordChange: (next: string) => void;
  showPassword: boolean;
  onShowPasswordChange: (next: (shown: boolean) => boolean) => void;
  remember: boolean;
  onRememberChange: (next: boolean) => void;
  busy: boolean;
  onSubmit: (event: React.FormEvent) => void;
  onSwitchMode: (next: FormMode) => void;
  showPasswordField: boolean;
  showRemember: boolean;
  showProviders: boolean;
  /** Null only while the probe is still out — see `LoginScreen`'s three states. */
  probePending: boolean;
  probeFailed: boolean;
  offeredProviders: typeof PROVIDERS;
  onProvider: (provider: Provider) => void;
}

export default function LoginCard({
  copy, banner, mode, email, onEmailChange, password, onPasswordChange,
  showPassword, onShowPasswordChange, remember, onRememberChange, busy,
  onSubmit, onSwitchMode, showPasswordField, showRemember, showProviders,
  probePending, probeFailed, offeredProviders, onProvider,
}: LoginCardProps) {
  return (
    <div className="card auth-card">
      <h1>{copy.title}</h1>
      <p className="auth-blurb">{copy.blurb}</p>

      {banner && (
        <div className={`banner ${banner.tone} mt-3`} role={banner.tone === "error" ? "alert" : "status"}>
          <span aria-hidden>{banner.tone === "error" ? "✕" : banner.tone === "warn" ? "◌" : "✓"}</span>
          <div>{banner.message}</div>
        </div>
      )}

      <form className="mt-5 flex flex-col gap-4" onSubmit={onSubmit}>
        {mode !== "reset" && (
          <div>
            <label className="block font-semibold text-text-secondary" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              className="mt-1 w-full"
            />
          </div>
        )}

        {showPasswordField && (
          <div>
            <label className="block font-semibold text-text-secondary" htmlFor="auth-password">
              {mode === "reset" ? "New password" : "Password"}
            </label>
            <div className="relative mt-1 flex">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                spellCheck={false}
                required
                className="w-full pr-[68px]"
              />
              <button
                type="button"
                onClick={() => onShowPasswordChange((shown) => !shown)}
                aria-pressed={showPassword}
                aria-controls="auth-password"
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent px-1.5 py-1 text-fs-md font-semibold text-text-secondary underline"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        )}

        {showRemember && (
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-fs-lg text-text-secondary" htmlFor="auth-remember">
              <input
                id="auth-remember"
                type="checkbox"
                checked={remember}
                onChange={(event) => onRememberChange(event.target.checked)}
                className="h-auto w-auto"
              />
              Remember me
            </label>
            {mode === "signin" && (
              <button
                type="button"
                className="auth-link"
                onClick={() => onSwitchMode("forgot")}
              >
                Forgot password?
              </button>
            )}
          </div>
        )}

        <button type="submit" className="primary-action" disabled={busy}>
          {busy ? "Working…" : copy.submit}
        </button>
      </form>

      {showProviders && (
        <>
          <p className="mt-5 mb-3 text-center text-fs-sm uppercase tracking-[0.08em] text-text-muted">
            {/* Not a bare "or" while the probe is out: a divider above nothing
                is the headless-section case, and saying what is being waited
                for costs one word. */}
            {probePending ? "checking sign-in options" : "or"}
          </p>
          {probeFailed && (
            /**
             * The buttons are drawn, and the warning is the price of drawing
             * them. The probe failing is not evidence a provider is missing —
             * that is why this fails open — but it is also not evidence one
             * works, and this project has two providers that answer
             * "provider is not enabled". Without this line, a reader clicking
             * Google would leave the app for a page of raw JSON with no
             * warning at all, which is the defect this whole branch exists to
             * bound.
             */
            <p className="mb-3 text-center text-fs-body leading-snug text-text-muted">
              We could not check which of these are enabled here, so one may not complete.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {offeredProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={busy}
                onClick={() => onProvider(provider.id)}
                className="auth-provider"
              >
                Continue with {provider.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-5 border-t border-grid pt-4 text-fs-lg text-text-secondary">
        {mode === "signin" ? (
          <>
            No account?{" "}
            <button
              type="button"
              className="auth-link"
              onClick={() => onSwitchMode("signup")}
            >
              Create account
            </button>
          </>
        ) : (
          <button
            type="button"
            className="auth-link"
            onClick={() => onSwitchMode("signin")}
          >
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}
