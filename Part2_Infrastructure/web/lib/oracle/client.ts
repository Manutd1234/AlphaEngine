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
export const ORACLE_WALLET_ENV = "ORACLE_WALLET_PEM_B64";
export const ORACLE_WALLET_PASSWORD_ENV = "ORACLE_WALLET_PASSWORD";

export interface OracleFailure {
  code:
    | "oracle_not_configured"
    | "oracle_auth_failed"
    | "oracle_unreachable"
    | "oracle_timeout"
    | "oracle_busy"
    | "oracle_schema_missing"
    | "oracle_wallet_invalid"
    | "oracle_service_unknown"
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
  /** Base64 `ewallet.pem`, present only when the database requires mutual TLS. */
  walletPemB64?: string;
  walletPassword?: string;
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
  return {
    user: env[ORACLE_USER_ENV]?.trim() || "ADMIN",
    password,
    connectString,
    // Optional, and its absence is the common case. An Autonomous Database only
    // permits TLS without a wallet once it has a network ACL or a private
    // endpoint; with "secure access from everywhere" Oracle forces mutual TLS,
    // and then a wallet is not a preference but the only way to connect.
    walletPemB64: env[ORACLE_WALLET_ENV]?.trim() || undefined,
    walletPassword: env[ORACLE_WALLET_PASSWORD_ENV] || undefined,
  };
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

  // Mutual TLS, and it is worth its own branch because every neighbouring
  // failure sends you somewhere useless. A missing or wrong wallet surfaces as
  // a certificate or handshake error, which reads like a network fault; the
  // actual fix is a secret, and the actual cause is that this database has no
  // network ACL, so Oracle will not permit walletless TLS at all.
  if (
    message === "wallet_pem_invalid"
    || ["29024", "29061", "28759", "28860"].includes(ora)
    || /wallet|mutual tls|mtls|certificate|handshake|self.?signed/i.test(message)
  ) {
    return {
      code: "oracle_wallet_invalid",
      error:
        `This database requires mutual TLS. Set ${ORACLE_WALLET_ENV} to the base64 of `
        + `ewallet.pem from its wallet, and ${ORACLE_WALLET_PASSWORD_ENV} to the wallet `
        + "password — or give the database a network ACL and turn mutual TLS off.",
      status: 502,
    };
  }
  // Service name absent from the listener. Distinct from unreachable: the
  // instance answered and refused to route, which is a stopped database or a
  // service name that does not exist — never a password.
  if (["12514", "12506", "12154"].includes(ora)) {
    return {
      code: "oracle_service_unknown",
      error:
        `The listener answered but has no such service. Check the service name in `
        + `${ORACLE_CONN_ENV} against the console's connection strings, and that the `
        + "database is not stopped.",
      status: 502,
    };
  }
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

/** Resolved wallet directory for this instance, created at most once. */
let walletDirPromise: Promise<string> | null = null;

/**
 * Writes `ewallet.pem` somewhere the driver can read it, and returns the directory.
 *
 * Thin mode reads the PEM only — none of the `.sso`, `.p12` or `.jks` files in
 * the downloaded wallet — so the secret carries one base64 blob rather than a
 * zip. It is written per instance rather than baked into the image because it is
 * a **private key**: in an env var it is rotatable and scoped to the deployment,
 * whereas in the repository it would be permanent and public.
 *
 * `mkdtemp` creates the directory `0700` by definition — owner-only, which is
 * why no mode is passed — and the PEM is written `0600` inside it. The path is
 * never logged. On Vercel this lands in the function's own writable `/tmp`,
 * private to that instance and discarded with it.
 */
async function walletDirectory(config: OracleConfig): Promise<string> {
  if (walletDirPromise) return walletDirPromise;
  walletDirPromise = (async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "alphaengine-wallet-"));
    const pem = Buffer.from(config.walletPemB64 as string, "base64").toString("utf8");
    // A truncated or non-base64 secret decodes to something that is not a PEM,
    // and the driver's error for that is far less obvious than this one.
    if (!pem.includes("-----BEGIN")) {
      throw new Error("wallet_pem_invalid");
    }
    await writeFile(join(dir, "ewallet.pem"), pem, { mode: 0o600 });
    return dir;
  })().catch((error) => {
    walletDirPromise = null;
    throw error;
  });
  return walletDirPromise;
}

async function getPool(config: OracleConfig): Promise<oracledbTypes.Pool> {
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    // Imported lazily so a deployment with no Oracle configured never loads the
    // driver at all — it is the largest dependency in the tree.
    const oracledb = (await import("oracledb")).default;
    oracledb.fetchAsString = [oracledb.CLOB];
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

    // Only when the database demands it. Passing a wallet to an instance that
    // accepts walletless TLS is harmless but pointless, and leaving these
    // undefined keeps the walletless path exactly as it was.
    const mutualTls = config.walletPemB64
      ? {
        walletLocation: await walletDirectory(config),
        walletPassword: config.walletPassword,
      }
      : {};

    return oracledb.createPool({
      user: config.user,
      password: config.password,
      connectString: config.connectString,
      ...mutualTls,
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
