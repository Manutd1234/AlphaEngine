"use client";

/**
 * Connected accounts — the sign-in methods this account can be reached by.
 *
 * Split out of `ProfileScreen`. The list itself is loaded by the screen,
 * because the page head counts it; the linking state, the redirect and the two
 * mutations live here, where nothing else reads them.
 *
 * Two rules survive the move intact. Unlink is only offered where it can
 * succeed — `canUnlink` needs a second identity, and a sole method that could
 * be removed would leave no way into the account — and the disabled control
 * says why rather than only dimming. And the link redirect is explicit: an
 * origin GoTrue has not allow-listed is silently rewritten to the project's
 * Site URL, so a link begun from an alias would land somewhere else entirely.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import type { Provider, UserIdentity } from "@supabase/supabase-js";

import { authClient, fetchEnabledProviders } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-flow";
import { LINKABLE_PROVIDERS, canUnlink, providerLabel } from "@/lib/profile";

import type { ReportBanner } from "./banner";

interface ProfileConnectionsCardProps {
  identities: UserIdentity[] | null;
  identitiesState: "loading" | "ready" | "unconfigured";
  /** Re-read the list after an unlink, so the count and the buttons agree. */
  onReload: () => Promise<void>;
  onBanner: ReportBanner;
}

export default function ProfileConnectionsCard({
  identities,
  identitiesState,
  onReload,
  onBanner,
}: ProfileConnectionsCardProps) {
  const [enabledProviders, setEnabledProviders] = useState<Set<string> | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

  useEffect(() => {
    void fetchEnabledProviders().then((enabled) => {
      if (enabled) setEnabledProviders(enabled);
    });
  }, []);

  /** Explicit and allow-listed. `window.location.origin` alone is what silently
   *  sends a preview or alias origin back to the project's Site URL instead. */
  const redirectTo = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/profile`),
    [],
  );

  const onLink = useCallback(async (provider: string) => {
    const supabase = authClient();
    if (!supabase) return;
    setLinkBusy(provider);
    onBanner(null);
    const { error } = await supabase.auth.linkIdentity({
      provider: provider as Provider,
      options: { redirectTo },
    });
    if (error) {
      setLinkBusy(null);
      onBanner({ tone: "error", message: describeAuthError(error) });
    }
    // No success branch: a successful call navigates away to the provider.
  }, [redirectTo, onBanner]);

  const onUnlink = useCallback(async (identity: UserIdentity) => {
    const supabase = authClient();
    if (!supabase) return;
    setLinkBusy(identity.provider);
    onBanner(null);
    const { error } = await supabase.auth.unlinkIdentity(identity);
    setLinkBusy(null);
    if (error) {
      onBanner({ tone: "error", message: describeAuthError(error) });
      return;
    }
    await onReload();
    onBanner({ tone: "context-change", message: `${providerLabel(identity.provider)} unlinked.` });
  }, [onReload, onBanner]);

  const identityCount = identities?.length ?? 0;
  const linked = new Set((identities ?? []).map((identity) => identity.provider));

  return (
    <section className="card mt-4 p-5">
      <span className="page-kicker">Sign-in methods</span>
      <h2 className="mt-0.5 text-fs-title">Connected accounts</h2>

      {identitiesState === "unconfigured" ? (
        <p className="mt-2 text-fs-body leading-snug text-text-secondary">
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
                <span className="text-fs-body font-semibold">
                  {providerLabel(identity.provider)}
                </span>
                <button
                  type="button"
                  disabled={!canUnlink(identityCount) || linkBusy === identity.provider}
                  onClick={() => void onUnlink(identity)}
                  aria-describedby={canUnlink(identityCount) ? undefined : "profile-unlink-note"}
                  className="rounded-[8px] border border-border bg-surface-1 px-2.5 py-1.5 text-fs-sm font-semibold text-text-secondary hover:bg-surface-2"
                >
                  {linkBusy === identity.provider ? "Working…" : "Unlink"}
                </button>
              </li>
            ))}
          </ul>

          {!canUnlink(identityCount) && (
            <p id="profile-unlink-note" className="mt-2 text-fs-xs leading-snug text-text-muted">
              Unlink needs a second method to fall back on. Removing the only one would leave no
              way in, so the library refuses.
            </p>
          )}

          <div className="mt-3 border-t border-grid pt-3">
            <span className="text-fs-sm font-semibold text-text-secondary">Add a method</span>
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
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-fs-body font-semibold text-text-primary hover:bg-surface-2"
                  >
                    <Link2 size={13} aria-hidden />
                    {provider.label}
                  </button>
                );
              })}
              {LINKABLE_PROVIDERS.every((provider) => linked.has(provider.id)) && (
                <span className="text-fs-xs text-text-muted">Every provider is already linked.</span>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
