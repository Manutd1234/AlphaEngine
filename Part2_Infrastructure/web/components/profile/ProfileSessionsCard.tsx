"use client";

/**
 * Active sessions, and the one control that ends the others.
 *
 * Split out of `ProfileScreen`; the rows are loaded by the screen because the
 * page head counts them, and the revoke lives here with the button that fires
 * it.
 *
 * Two claims this panel is not allowed to make, both preserved verbatim from
 * the screen. `signOut({ scope: "others" })` is called directly rather than
 * through the shared `signOutUser()`, which defaults to scope 'global' and
 * would end this session too — after which the password form above it would
 * 401 on the next thing the reader did. And the confirmation says access ends
 * "within the hour" rather than immediately, because an access token cannot be
 * revoked and the other devices keep working until theirs expires.
 */

import { useCallback, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/auth-flow";
import { dateTime } from "@/lib/format";
import { describeDevice, describeSessionSource, formatIp, type SessionSource } from "@/lib/profile";

import type { ReportBanner } from "./banner";

export interface SessionRow {
  session_id: string | null;
  created_at: string | null;
  refreshed_at: string | null;
  user_agent: string | null;
  ip: string | null;
  is_current: boolean;
  source: SessionSource;
}

/** Milliseconds from an ISO string, or null — never NaN reaching a formatter. */
function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

interface ProfileSessionsCardProps {
  sessions: SessionRow[] | null;
  sessionsState: "loading" | "ready" | "unconfigured";
  source: SessionSource;
  /** Re-read the rows after a revoke, so the list matches what is left. */
  onReload: () => Promise<void>;
  onBanner: ReportBanner;
}

export default function ProfileSessionsCard({
  sessions,
  sessionsState,
  source,
  onReload,
  onBanner,
}: ProfileSessionsCardProps) {
  const [revoking, setRevoking] = useState(false);

  const onRevokeOthers = useCallback(async () => {
    const supabase = authClient();
    if (!supabase) return;
    setRevoking(true);
    onBanner(null);
    // Called directly rather than through `signOutUser()`, which defaults to
    // scope 'global' and would end this session too — after which the password
    // form below would 401 on the next thing you did.
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setRevoking(false);
    if (error) {
      onBanner({ tone: "error", message: describeAuthError(error) });
      return;
    }
    await onReload();
    onBanner({
      tone: "context-change",
      // Not "signed out everywhere". Access tokens cannot be revoked, so other
      // devices keep working until their current one expires.
      message: "Other sessions revoked. Their access ends within the hour, as issued tokens run out.",
    });
  }, [onReload, onBanner]);

  const otherSessions = (sessions ?? []).filter((row) => !row.is_current).length;

  return (
    <section className="card mt-4 p-5">
      <span className="page-kicker">Devices</span>
      <h2 className="mt-0.5 text-fs-title">Active sessions</h2>

      {sessionsState === "unconfigured" ? (
        <p className="mt-2 text-fs-body leading-snug text-text-secondary">
          The session listing is not installed on this project, so this cannot say where the
          account is signed in.
        </p>
      ) : sessionsState === "loading" ? (
        <span className="skeleton mt-3 block h-[11px] w-[60%]" />
      ) : (
        <>
          <p className="mt-1 text-fs-body leading-snug text-text-secondary">
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
                    <span className="text-fs-body font-semibold" title={row.user_agent ?? undefined}>
                      {describeDevice(row.user_agent)}
                    </span>
                    {/* Word, not a coloured dot. A dot alone carries nothing
                        for a reader who cannot see the colour. */}
                    {row.is_current && (
                      <span className="rounded-[6px] border border-border px-1.5 py-0.5 text-fs-2xs font-semibold text-success-text">
                        This device
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-fs-xs text-text-muted">
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
              className="mt-3 inline-flex items-center gap-1.5 rounded-[9px] border border-[color-mix(in_srgb,var(--status-critical)_45%,var(--border))] bg-surface-1 px-3 py-2 text-fs-body font-semibold text-critical-text hover:bg-[color-mix(in_srgb,var(--status-critical)_8%,var(--surface-1))]"
            >
              <ShieldCheck size={13} aria-hidden />
              {revoking ? "Revoking…" : `Revoke ${otherSessions} other session${otherSessions === 1 ? "" : "s"}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
