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
  /**
   * Whether this mode has a provider region at all — signin and signup do,
   * forgot and reset do not. Deliberately NOT "whether there are providers to
   * draw": the region is reserved before the answer exists, which is the whole
   * of the layout fix, so its presence may not depend on the answer.
   */
  showProviderSlot: boolean;
  /** Null only while the probe is still out — see `LoginScreen`'s three states. */
  probePending: boolean;
  probeFailed: boolean;
  /** The probe answered, and it named at least one provider we can offer. */
  providersOffered: boolean;
  offeredProviders: typeof PROVIDERS;
  onProvider: (provider: Provider) => void;
}

export default function LoginCard({
  copy, banner, mode, email, onEmailChange, password, onPasswordChange,
  showPassword, onShowPasswordChange, remember, onRememberChange, busy,
  onSubmit, onSwitchMode, showPasswordField, showRemember, showProviderSlot,
  probePending, probeFailed, providersOffered, offeredProviders, onProvider,
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

      {showProviderSlot && (
        /**
         * The async region, reserved rather than mounted into.
         *
         * The button column was empty at ZERO height while the probe was out —
         * measured, not assumed — and the answer lands after paint: 688ms over
         * the network, 4.09s when `AbortSignal.timeout` gives up. The card then
         * grew by a whole button row, and because `.auth-shell` centres the
         * column with auto margins, that growth moved the masthead up by half
         * and the guest action down by half in the same frame. Reserving one
         * row under the divider makes the probing card and the answered card
         * the same box; `14k-login-layout-stability.css` carries the numbers.
         *
         * `role="status"` because the reserve is deliberately silent to a
         * screen reader — nothing is hidden and revealed, so no name and no
         * focus stop appears out of nowhere — and what is worth announcing is
         * what finally settled into it. Same shape as `AuthCallback`.
         */
        <div className="auth-providers" role="status" aria-live="polite">
          <p className="mt-5 mb-3 text-center text-fs-sm uppercase tracking-[0.08em] text-text-muted">
            {/* Not a bare "or" while the probe is out: a divider above nothing
                is the headless-section case, and saying what is being waited
                for costs one word. Not "or" once the answer is none either —
                "or" promises an alternative that does not exist. */}
            {probePending
              ? "checking sign-in options"
              : providersOffered ? "or" : "sign-in options"}
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
            <p className="auth-providers__note mb-3 text-center text-fs-body leading-snug text-text-muted">
              We could not check which of these are enabled here, so one may not complete.
            </p>
          )}
          <div className="auth-providers__options flex flex-col gap-2">
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
            {!probePending && !providersOffered && (
              /* Absence is a typed state with a named reason, and the reason
                 fills the reserve rather than leaving it blank. This state used
                 to drop the whole region, so an answer of "none enabled" made
                 the card 48.71 to 55.67px SHORTER than the probing card — the
                 one path where the page jumped upward instead of down. */
              <p className="text-center text-fs-body leading-snug text-text-muted">
                No provider is enabled in this deployment.
              </p>
            )}
          </div>
        </div>
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
