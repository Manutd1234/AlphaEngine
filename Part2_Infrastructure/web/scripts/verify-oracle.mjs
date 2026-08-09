#!/usr/bin/env node
/**
 * Live probe of the Oracle Autonomous Database — the blueprint's Phase 7 check,
 * with a real error taxonomy.
 *
 *   node scripts/verify-oracle.mjs
 *
 * The blueprint's version is `.then(() => console.log('CONNECTED')).catch(console.error)`,
 * which prints an ORA stack and leaves you to guess. Every failure mode here has
 * a different fix, and printing which one you hit is the entire value:
 *
 *   wrong password           → rotate ORACLE_PASSWORD
 *   instance stopped         → start it in the OCI console (Always Free auto-stops)
 *   mTLS still required      → disable mutual TLS, or you need the wallet
 *   no sessions              → too many warm lambdas; use the _low service
 *   schema not applied       → run oracle/01_schema.sql and 02_monte_carlo.sql
 *
 * Reads the same variables the app does, so a pass here means the app works.
 * Exits non-zero on any failure so CI can gate on it.
 */

import { readFileSync } from "node:fs";

// `.env.local` is not loaded outside Next, and asking people to export five
// variables by hand before a verification script is how the script stops being
// run at all.
function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local: the caller exported them, or they are genuinely missing —
    // the configuration check below reports that clearly either way.
  }
}

const steps = [];
function record(name, ok, detail) {
  steps.push({ name, ok });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Turn an ORA code into the thing you should actually go and do. */
function advise(error) {
  const message = String(error?.message ?? error);
  const ora = /ORA-(\d{5})/.exec(message)?.[1] ?? "";
  switch (ora) {
    case "01017":
      return "wrong username/password — check ORACLE_PASSWORD (and ORACLE_USER)";
    case "28000":
      return "the account is locked — unlock it in the OCI console";
    case "28001":
      return "the password has expired — reset it in the OCI console";
    case "12506":
    case "12514":
      return "the service name in ORACLE_CONN_STRING is not registered with the listener";
    case "12516":
    case "12520":
      return "no free session — reduce poolMax, or point at the _low/_tp service";
    case "12170":
      return "TCP connect timed out — the instance may be STOPPED (Always Free auto-stops when idle), or the ACL blocks this address";
    case "29024":
      return "certificate validation failed — the descriptor is not the walletless tcps one";
    case "00942":
      return "table or view does not exist — apply oracle/01_schema.sql";
    case "06550":
      return "procedure not found — apply oracle/02_monte_carlo.sql";
    default:
      if (/mutual|mTLS|wallet/i.test(message)) {
        return "this database still requires mutual TLS — disable it, or supply a wallet";
      }
      return message.split("\n")[0];
  }
}

/**
 * Remote mode: verify the DEPLOYED app instead of connecting from here.
 *
 *   node scripts/verify-oracle.mjs --remote https://your-app.vercel.app
 *
 * This exists because the credentials usually live in Vercel and nowhere else,
 * and the honest way to check a deployment is to ask the deployment. It reads
 * the `oracle` row that `/api/system/health` already publishes — which is the
 * same probe the Reliability tab renders, so a pass here means what a user sees
 * is real. No credential is needed, and none is transmitted.
 */
async function verifyRemote(origin) {
  let base;
  try {
    base = new URL(origin);
    if (base.protocol !== "https:" && base.hostname !== "localhost") {
      throw new Error("use https for a deployed origin");
    }
  } catch (error) {
    console.log(` FAIL  --remote target — ${error.message}`);
    process.exit(1);
  }

  console.log(`Probing ${base.origin} (no credentials are sent)\n`);
  let payload;
  try {
    const response = await fetch(new URL("/api/system/health", base), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      record("health endpoint", false, `HTTP ${response.status}`);
      process.exit(1);
    }
    payload = await response.json();
    record("health endpoint", true, `HTTP 200 from ${base.host}`);
  } catch (error) {
    record("health endpoint", false, error.message);
    process.exit(1);
  }

  const oracle = payload.oracle;
  if (!oracle) {
    record("oracle row present", false,
      "the deployment predates the Oracle integration, or the build is stale");
    process.exit(1);
  }
  record("oracle row present", true, oracle.label);

  if (!oracle.configured) {
    record("configured in the deployment", false,
      "ORACLE_CONN_STRING / ORACLE_PASSWORD are not set on this environment. "
      + "Vercel scopes variables per environment — check Production AND Preview.");
    process.exit(1);
  }
  record("configured in the deployment", true, "credentials present");

  record(
    "database reachable",
    oracle.ready,
    oracle.ready
      ? `${oracle.latencyMs}ms round trip, checked ${oracle.checkedAt}`
      : `${oracle.statusDetail} (${oracle.reason ?? "unclassified"})`,
  );

  const failed = steps.filter((s) => !s.ok);
  console.log(
    failed.length
      ? `\n${failed.length} of ${steps.length} checks failed on the deployed app.`
      : `\nAll ${steps.length} checks passed. The deployed Oracle panels render live data.`,
  );
  process.exit(failed.length ? 1 : 0);
}

const remoteFlag = process.argv.indexOf("--remote");
if (remoteFlag !== -1) {
  const target = process.argv[remoteFlag + 1];
  if (!target) {
    console.log(" FAIL  --remote needs an origin, e.g. --remote https://your-app.vercel.app");
    process.exit(1);
  }
  console.log("AlphaEngine — Oracle verification (remote)\n");
  await verifyRemote(target);
}

loadEnvLocal();

const connectString = process.env.ORACLE_CONN_STRING?.trim();
const password = process.env.ORACLE_PASSWORD;
const user = process.env.ORACLE_USER?.trim() || "ADMIN";

console.log("AlphaEngine — Oracle Autonomous Database verification\n");

if (!connectString || !password) {
  console.log(" FAIL  configuration — ORACLE_CONN_STRING and ORACLE_PASSWORD must both be set");
  console.log("\nNothing was contacted. This is the app's default state and it is safe:");
  console.log("the Oracle panels read 'unavailable' rather than showing an empty result.");
  console.log("");
  console.log("If the credentials live in Vercel rather than here, verify the deployment");
  console.log("instead — no credential needed, and it checks what users actually see:");
  console.log("  node scripts/verify-oracle.mjs --remote https://your-app.vercel.app");
  process.exit(1);
}

// Mutual TLS when a wallet is configured. An Autonomous Database permits
// walletless TLS only once it has a network ACL or a private endpoint; with
// "secure access from everywhere" Oracle requires mTLS, and then the wallet is
// not a preference but the only way to connect. Thin mode reads `ewallet.pem`
// alone, so the secret is one base64 blob rather than the downloaded zip.
const walletPemB64 = process.env.ORACLE_WALLET_PEM_B64?.trim();
const walletPassword = process.env.ORACLE_WALLET_PASSWORD;
let walletLocation;
if (walletPemB64) {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const pem = Buffer.from(walletPemB64, "base64").toString("utf8");
  if (!pem.includes("-----BEGIN")) {
    record("configuration", false, "ORACLE_WALLET_PEM_B64 does not decode to a PEM");
    process.exit(1);
  }
  // mkdtemp is 0700 by definition; the key inside it is written 0600.
  walletLocation = mkdtempSync(join(tmpdir(), "alphaengine-wallet-"));
  writeFileSync(join(walletLocation, "ewallet.pem"), pem, { mode: 0o600 });
}

record(
  "configuration",
  true,
  `user ${user}, ${walletLocation ? "mutual TLS (wallet configured)" : "walletless"} ` +
    `${/tcps/i.test(connectString) ? "tcps" : "NON-TLS — check the descriptor"}`,
);
if (!/tcps/i.test(connectString)) {
  console.log("        the blueprint's guardrail requires tcps:// on 1521; this descriptor is not TLS");
}
if (/_high/i.test(connectString)) {
  console.log("        note: _high is a high-concurrency service. Serverless pools are better served by _low or _tp.");
}

let oracledb;
try {
  oracledb = (await import("oracledb")).default;
  record("driver", true, `node-oracledb ${oracledb.versionString}, thin mode: ${oracledb.thin}`);
} catch (error) {
  record("driver", false, `could not load node-oracledb — ${error.message}`);
  process.exit(1);
}

let connection;
try {
  const started = Date.now();
  connection = await oracledb.getConnection({
    user, password, connectString,
    ...(walletLocation ? { walletLocation, walletPassword } : {}),
  });
  record(
    "connect", true,
    `${Date.now() - started}ms, ${walletLocation ? "mutual" : "walletless"} TLS, no Instant Client`,
  );
} catch (error) {
  record("connect", false, advise(error));
  process.exit(1);
}

try {
  const { rows } = await connection.execute("SELECT banner_full FROM v$version");
  record("version", true, String(rows?.[0]?.[0] ?? "").split("\n")[0]);
} catch {
  record("version", true, "connected (v$version not readable by this user, which is fine)");
}

try {
  const { rows } = await connection.execute(
    "SELECT COUNT(*) AS total, COUNT(embedding) AS embedded FROM strategy_research_rag",
    [],
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const { TOTAL, EMBEDDED } = rows[0];
  record("schema: strategy_research_rag", true, `${TOTAL} document(s), ${EMBEDDED} embedded`);
  if (TOTAL > 0 && EMBEDDED === 0) {
    console.log("        every row is still embedding_status='pending' — search will return nothing");
  }
} catch (error) {
  record("schema: strategy_research_rag", false, advise(error));
}

try {
  const result = await connection.execute(
    `BEGIN run_monte_carlo_portfolio(:e, :m, :s, :d, :n, :var, :exp, :paths); END;`,
    {
      e: 1_000_000, m: 0.08, s: 0.45, d: 30, n: 5000,
      var: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      exp: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      paths: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    },
  );
  const { var: var99, exp, paths } = result.outBinds;
  const plausible = var99 > 0 && var99 < 1_000_000 && paths === 5000;
  record(
    "schema: run_monte_carlo_portfolio",
    plausible,
    `VaR99 ${Math.round(var99).toLocaleString()} on 1,000,000 over 30d, ${paths} paths, `
      + `expected ${Math.round(exp).toLocaleString()}`,
  );
  if (!plausible) {
    console.log("        a VaR outside (0, equity) means the procedure is not the committed one");
  }
} catch (error) {
  record("schema: run_monte_carlo_portfolio", false, advise(error));
}

await connection.close();

const failed = steps.filter((s) => !s.ok);
console.log(
  failed.length
    ? `\n${failed.length} of ${steps.length} checks failed.`
    : `\nAll ${steps.length} checks passed. The Oracle panels will render live data.`,
);
process.exit(failed.length ? 1 : 0);
