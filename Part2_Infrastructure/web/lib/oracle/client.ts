/**
 * Oracle Autonomous Database client — walletless TLS, thin mode.
 * ==============================================================
 *
 * Deliberately shaped like `lib/gateway.ts`: a typed result, never a throw, and
 * a classified failure that carries no credential, hostname or raw ORA text.
 * The panels that read this have to tell "not configured" from "unreachable"
 * from "found nothing", and they can only do that if this layer refuses to
 * flatten the three into an empty array.
 *
 * **Thin mode** (`oracledb.thin`, the default in node-oracledb 6+) is a pure
 * JavaScript implementation of the Oracle wire protocol. It needs no Instant
 * Client binary, which is what makes this deployable to a serverless runtime at
 * all, and it speaks `tcps://` on 1521 directly — satisfying the blueprint's
 * walletless-TLS guardrail without shipping `cwallet.sso`.
 *
 * **Pooling.** The pool is module-scoped so it survives warm invocations, with
 * `poolMin: 0` so a scaled-down instance holds no ADB sessions. `poolMax` is
 * deliberately tiny: Vercel scales lambdas independently and each one would
 * hold its own pool, so a per-instance maximum of 2 against a low ADB session
 * limit is the difference between graceful queueing and ORA-12516 under mild
 * load. Prefer a `_low`/`_tp` service in ORACLE_CONN_STRING for the same reason.
 */

import type oracledbTypes from "oracledb";

export const ORACLE_CONN_ENV = "ORACLE_CONN_STRING";
export const ORACLE_PASSWORD_ENV = "ORACLE_PASSWORD";
export const ORACLE_USER_ENV = "ORACLE_USER";

export interface OracleFailure {
  code:
    | "oracle_not_configured"
    | "oracle_auth_failed"
    | "oracle_unreachable"
    | "oracle_timeout"
    | "oracle_busy"
    | "oracle_schema_missing"
    | "oracle_invalid_payload";
  /** Safe to render. Never contains the connect string, host, user or ORA text. */
  error: string;
  status: number;
}

export type OracleResult<T> = { ok: true; data: T } | { ok: false; failure: OracleFailure };

export interface OracleConfig {
  user: string;
  password: string;
  connectString: string;
}

/**
 * Configuration, or null. Reading `ORACLE_USER` with an ADMIN default is what
 * lets `oracle/03_app_user.sql` be adopted as a one-variable change rather than
 * a code change — see that file for why you should.
 */
export function oracleConfig(env: NodeJS.ProcessEnv = process.env): OracleConfig | null {
  const connectString = env[ORACLE_CONN_ENV]?.trim();
  const password = env[ORACLE_PASSWORD_ENV];
  if (!connectString || !password) return null;
  return { user: env[ORACLE_USER_ENV]?.trim() || "ADMIN", password, connectString };
}

export function notConfigured(what: string): OracleFailure {
  return {
    code: "oracle_not_configured",
    error:
      `${what} needs an Oracle Autonomous Database. Set ${ORACLE_CONN_ENV} and `
      + `${ORACLE_PASSWORD_ENV} to enable it; without them this stays unavailable rather `
      + "than reporting an empty result.",
    status: 503,
  };
}

/**
 * ORA codes → the classification a reader can act on.
 *
 * The message is written here rather than passed through: Oracle's own text
 * includes the service name and sometimes the host, and this value reaches a
 * browser.
 */
function classify(error: unknown): OracleFailure {
  const code = String((error as { code?: string })?.code ?? "");
  const message = String((error as Error)?.message ?? "");
  const ora = /ORA-(\d{5})/.exec(message)?.[1] ?? "";

  // Wrong password, expired password, locked account.
  if (["01017", "28000", "28001", "01005"].includes(ora)) {
    return {
      code: "oracle_auth_failed",
      error: `The database rejected the configured credentials (${ORACLE_USER_ENV}/${ORACLE_PASSWORD_ENV}).`,
      status: 502,
    };
  }
  // Listener has no free session handlers / resource busy: the shape a serverless
  // fan-out produces against a small instance.
  if (["12516", "12520", "00018", "00020"].includes(ora)) {
    return {
      code: "oracle_busy",
      error: "The database has no session available right now. This usually clears in seconds.",
      status: 503,
    };
  }
  // Credentials are good, the instance answered, the objects are not there.
  // Without this the default below reports "could not be reached", which sends
  // you to the OCI console to check an instance that is running perfectly —
  // `verify-oracle.mjs` already distinguishes these two and the runtime must
  // agree with it.
  if (["00942", "04043", "06550"].includes(ora)) {
    return {
      code: "oracle_schema_missing",
      error:
        "The database answered, but the AlphaEngine objects do not exist. Apply "
        + "oracle/01_schema.sql and oracle/02_monte_carlo.sql to this database.",
      status: 503,
    };
  }
  if (["12170", "03135", "03113"].includes(ora) || code === "ETIMEDOUT" || /timeout/i.test(message)) {
    return {
      code: "oracle_timeout",
      error: "The database did not answer within the request budget.",
      status: 504,
    };
  }
  // An Always Free instance auto-stops when idle; that is unavailable, not down.
  return {
    code: "oracle_unreachable",
    error:
      "The database could not be reached. An Always Free instance that has been idle may be "
      + "stopped and needs starting from the OCI console.",
    status: 503,
  };
}

/**
 * The module-scoped pool, created once per warm instance.
 *
 * Held as a promise so concurrent first calls share one creation rather than
 * racing to build several pools against the same small session budget.
 */
let poolPromise: Promise<oracledbTypes.Pool> | null = null;

async function getPool(config: OracleConfig): Promise<oracledbTypes.Pool> {
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    // Imported lazily so a deployment with no Oracle configured never loads the
    // driver at all — it is the largest dependency in the tree.
    const oracledb = (await import("oracledb")).default;
    oracledb.fetchAsString = [oracledb.CLOB];
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    return oracledb.createPool({
      user: config.user,
      password: config.password,
      connectString: config.connectString,
      poolMin: 0,
      poolMax: 2,
      poolTimeout: 30,
      // Fail fast rather than piling requests onto an instance that is already
      // out of sessions: the caller degrades to "busy", which is truthful.
      queueTimeout: 4000,
    });
  })().catch((error) => {
    poolPromise = null; // let the next request retry rather than caching a failure
    throw error;
  });
  return poolPromise;
}

/**
 * Runs one statement and hands back a typed result.
 *
 * Every caller goes through here so the classification, the timeout and the
 * redaction exist in exactly one place.
 */
export async function withOracle<T>(
  subject: string,
  run: (connection: oracledbTypes.Connection) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OracleResult<T>> {
  const config = oracleConfig(env);
  if (!config) return { ok: false, failure: notConfigured(subject) };

  let connection: oracledbTypes.Connection | null = null;
  try {
    const pool = await getPool(config);
    connection = await pool.getConnection();
    return { ok: true, data: await run(connection) };
  } catch (error) {
    return { ok: false, failure: classify(error) };
  } finally {
    // A leaked connection is one fewer session for every later request, and with
    // poolMax 2 it takes two to deadlock the instance.
    if (connection) await connection.close().catch(() => {});
  }
}

/** Cheap liveness probe for the reliability matrix. */
export async function oraclePing(env: NodeJS.ProcessEnv = process.env): Promise<OracleResult<number>> {
  const startedAt = Date.now();
  const result = await withOracle(
    "the Oracle health probe",
    async (connection) => {
      await connection.execute("SELECT 1 FROM DUAL");
      return Date.now() - startedAt;
    },
    env,
  );
  return result;
}

/** Test seam: drops the cached pool so a suite can vary the environment. */
export function resetOraclePool(): void {
  poolPromise = null;
}
