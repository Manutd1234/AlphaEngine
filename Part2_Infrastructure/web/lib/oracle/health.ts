/**
 * Oracle readiness for the reliability matrix.
 *
 * Three states, and keeping them apart is the whole job:
 *
 *   not configured — no credentials in this deployment. Not a fault. The
 *                    default state of the public demo, and it must never render
 *                    as red.
 *   unavailable    — configured, did not answer. An Always Free instance that
 *                    has been idle auto-stops, so "did not answer" genuinely
 *                    does not mean "broken".
 *   ready          — answered, with the round trip it took.
 *
 * `/api/system/health` is polled. Probing the database on every poll would put
 * a TCP connect and a TLS handshake on a hot path and, when the instance is
 * stopped, make every poll wait out the timeout — so the result is cached and
 * the probe is skipped while a recent one stands.
 */

import { ORACLE_CONN_ENV, ORACLE_PASSWORD_ENV, oracleConfig, oraclePing } from "./client";

export interface OracleReadiness {
  id: "oracle-adb";
  label: string;
  configured: boolean;
  ready: boolean;
  statusDetail: string;
  latencyMs: number | null;
  checkedAt: string | null;
  /** The classified failure code, for an operator who needs to act on it. */
  reason: string | null;
}

/** Long enough that polling is free, short enough that a recovery shows up. */
const CACHE_MS = 30_000;
/** Well under the health endpoint's own budget: this must never be the reason it is slow. */
const PROBE_TIMEOUT_MS = 3_000;

let cached: { at: number; value: OracleReadiness } | null = null;

function unconfigured(): OracleReadiness {
  return {
    id: "oracle-adb",
    label: "Oracle Autonomous DB (vector search, in-database VaR)",
    configured: false,
    ready: false,
    statusDetail: `Not configured; set ${ORACLE_CONN_ENV} and ${ORACLE_PASSWORD_ENV}.`,
    latencyMs: null,
    checkedAt: null,
    reason: null,
  };
}

export async function oracleReadiness(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OracleReadiness> {
  if (!oracleConfig(env)) return unconfigured();
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  // Raced against a timer rather than relying on the driver's own deadline: a
  // stopped instance can leave a connect attempt hanging well past it, and this
  // function is on a polled path.
  const ping = await Promise.race([
    oraclePing(env),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PROBE_TIMEOUT_MS)),
  ]);

  const checkedAt = new Date().toISOString();
  const value: OracleReadiness = ping === null
    ? {
      ...unconfigured(),
      configured: true,
      statusDetail: "Configured, but the probe exceeded its budget.",
      checkedAt,
      reason: "oracle_timeout",
    }
    : ping.ok
      ? {
        id: "oracle-adb",
        label: "Oracle Autonomous DB (vector search, in-database VaR)",
        configured: true,
        ready: true,
        // Says which TLS mode actually connected rather than asserting one.
        // This read "walletless TLS" unconditionally, written when that was the
        // only mode the client had. It survived the addition of mutual TLS and
        // then told an operator the opposite of the truth on a panel whose
        // entire job is telling states apart — and "walletless" is exactly the
        // word someone greps for when a wallet is the thing they suspect.
        statusDetail: oracleConfig(env)?.walletPemB64
          ? "Answered SELECT 1 over mutual TLS, using the configured wallet."
          : "Answered SELECT 1 over walletless TLS.",
        latencyMs: ping.data,
        checkedAt,
        reason: null,
      }
      : {
        id: "oracle-adb",
        label: "Oracle Autonomous DB (vector search, in-database VaR)",
        configured: true,
        ready: false,
        statusDetail: ping.failure.error,
        latencyMs: null,
        checkedAt,
        reason: ping.failure.code,
      };

  cached = { at: Date.now(), value };
  return value;
}

/** Test seam. */
export function resetOracleReadinessCache(): void {
  cached = null;
}
