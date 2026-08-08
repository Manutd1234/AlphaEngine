/**
 * The Oracle SQL and the TypeScript that calls it agree — checked offline.
 *
 * `tests/test_supabase_schema.py` plays exactly this trick against the Supabase
 * migrations, for exactly this reason: a column renamed on one side of a
 * process boundary is invisible to a type checker and shows up as a 500 the
 * first time someone opens the panel. Parsing the committed DDL is cheap and
 * turns that into a red build.
 *
 * The dimension check is the one worth reading twice. The master blueprint
 * specifies `VECTOR(1536, FLOAT32)`, but the only embedding source in this
 * repository is `supabase/functions/embed-research`, which runs gte-small at
 * **384** dimensions. At 1536 the Oracle index could never be populated from
 * the existing corpus, and — worse — a query embedded by a different model
 * returns confident, meaningless neighbours. That failure looks exactly like
 * success, which is why it is asserted rather than commented.
 *
 * No network, no database, no credentials: this runs in the same network-free
 * CI as everything else.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SIMULATIONS,
  EMBEDDING_DIMENSIONS,
  MAX_SIMULATIONS,
  MONTE_CARLO_IN_BINDS,
  MONTE_CARLO_OUT_BINDS,
  MONTE_CARLO_PROCEDURE,
  MONTE_CARLO_SQL,
  RAG_SEARCH_BINDS,
  RAG_SEARCH_SQL,
  RAG_TABLE,
  RESEARCH_KINDS,
  similarityFromDistance,
} from "../lib/oracle/queries";
import { notConfigured, oracleConfig, ORACLE_USER_ENV } from "../lib/oracle/client";

const repoRoot = new URL("../../../", import.meta.url);
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, repoRoot)), "utf8");

const schemaSql = read("oracle/01_schema.sql");
const monteCarloSql = read("oracle/02_monte_carlo.sql");

/**
 * SQL with `--` comments blanked. These files explain at length what was
 * REMOVED from the blueprint — the FORALL that did not compile, the INSERT that
 * made a public route a way to fill the tablespace — so a scan for those very
 * keywords finds the explanation and reports the fix as the bug.
 */
const strip = (sql: string) => sql.replace(/--[^\n]*/g, "");

/** Statement text with quoted literals blanked, for scanning bind placeholders. */
const unquoted = (sql: string) => sql.replace(/'[^']*'/g, "''");
const appUserSql = read("oracle/03_app_user.sql");
const pgvectorMigration = read("supabase/migrations/20260808120400_pgvector_research_documents.sql");
const embedFunction = read("supabase/functions/embed-research/index.ts");

// --------------------------------------------------------------------------
// The dimension has to match, everywhere
// --------------------------------------------------------------------------

describe("both vector stores embed at the same dimension", () => {
  it("Oracle's VECTOR column matches lib/oracle/queries.ts", () => {
    const declared = /VECTOR\((\d+),\s*FLOAT32\)/i.exec(schemaSql);
    assert.ok(declared, "strategy_research_rag has no VECTOR column");
    assert.equal(
      Number(declared[1]),
      EMBEDDING_DIMENSIONS,
      "the Oracle schema and the TypeScript disagree about the embedding width",
    );
  });

  it("and matches the pgvector migration", () => {
    const pg = /vector\((\d+)\)/i.exec(pgvectorMigration);
    assert.ok(pg, "the pgvector migration has no vector column");
    assert.equal(
      Number(pg[1]),
      EMBEDDING_DIMENSIONS,
      "Oracle and Supabase would index the same corpus at different widths, so their "
        + "results could never be compared",
    );
  });

  it("and matches what the embedding service actually produces", () => {
    // gte-small is 384. If the model here ever changes, both stores need
    // re-embedding and this is the test that says so.
    assert.match(
      embedFunction,
      /gte-small/,
      `the embedding model changed; ${EMBEDDING_DIMENSIONS} may no longer be its width, and `
        + "every stored vector needs regenerating",
    );
  });
});

// --------------------------------------------------------------------------
// The RAG query binds what the schema declares
// --------------------------------------------------------------------------

describe("the similarity query matches the committed schema", () => {
  it("selects from the table the schema creates", () => {
    assert.match(schemaSql, new RegExp(`CREATE TABLE ${RAG_TABLE}\\b`, "i"));
    assert.ok(RAG_SEARCH_SQL.includes(RAG_TABLE));
  });

  it("every column it selects exists", () => {
    const ddl = schemaSql.slice(schemaSql.indexOf(`CREATE TABLE ${RAG_TABLE}`));
    const columns = ["research_id", "kind", "source_ref", "strategy_name", "symbol",
      "title", "body", "metrics", "embedding", "embedding_status", "occurred_at"];
    for (const column of columns) {
      assert.match(
        RAG_SEARCH_SQL.toLowerCase(),
        new RegExp(`\\b${column}\\b`),
        `${column} is declared but never read — or the query drifted`,
      );
      assert.match(ddl.toLowerCase(), new RegExp(`\\b${column}\\b`), `${column} is not a column`);
    }
  });

  it("declares exactly the binds it uses", () => {
    // Unquoted: the TO_CHAR format mask contains `HH24:MI:SS`, and `:MI` is not
    // a bind placeholder however much it looks like one.
    const used = new Set([...unquoted(RAG_SEARCH_SQL).matchAll(/:(\w+)/g)].map((m) => m[1]));
    assert.deepEqual([...used].sort(), [...RAG_SEARCH_BINDS].sort());
  });

  it("excludes rows whose vector is not ready", () => {
    // A pending row has a NULL embedding, and VECTOR_DISTANCE against NULL
    // orders unpredictably rather than being excluded — a half-ingested corpus
    // would return arbitrary rows as "most similar".
    assert.match(RAG_SEARCH_SQL, /embedding_status\s*=\s*'ready'/);
    assert.match(schemaSql, /rag_ready_has_vector_ck/, "the schema no longer forbids a ready row with a NULL vector");
  });

  it("filters by kinds the schema actually permits", () => {
    const check = /kind IN \(([^)]+)\)/i.exec(schemaSql);
    assert.ok(check, "the kind CHECK constraint is gone");
    const allowed = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual([...RESEARCH_KINDS].sort(), allowed);
  });
});

// --------------------------------------------------------------------------
// The Monte Carlo call matches the procedure signature
// --------------------------------------------------------------------------

describe("the VaR call matches the procedure", () => {
  const signature = monteCarloSql.slice(
    monteCarloSql.indexOf(`PROCEDURE ${MONTE_CARLO_PROCEDURE}`),
    monteCarloSql.indexOf(") AS"),
  );

  it("calls a procedure that exists", () => {
    assert.match(monteCarloSql, new RegExp(`CREATE OR REPLACE PROCEDURE ${MONTE_CARLO_PROCEDURE}`, "i"));
    assert.ok(MONTE_CARLO_SQL.includes(MONTE_CARLO_PROCEDURE));
  });

  it("passes the right number of arguments in the right direction", () => {
    const params = [...signature.matchAll(/p_(\w+)\s+(IN|OUT)\b/g)].map((m) => ({
      name: m[1],
      dir: m[2],
    }));
    const ins = params.filter((p) => p.dir === "IN").length;
    const outs = params.filter((p) => p.dir === "OUT").length;
    assert.equal(ins, MONTE_CARLO_IN_BINDS.length, "IN parameter count drifted");
    assert.equal(outs, MONTE_CARLO_OUT_BINDS.length, "OUT parameter count drifted");
    const bound = [...MONTE_CARLO_SQL.matchAll(/:(\w+)/g)].map((m) => m[1]);
    assert.equal(bound.length, params.length, "the anonymous block passes the wrong arity");
  });

  it("the route's cap cannot exceed the database's", () => {
    // Both exist on purpose: the route is editable by anyone touching
    // TypeScript, the procedure is the layer an attacker cannot reach.
    const dbCap = /c_max_paths\s+CONSTANT\s+NUMBER\s*:=\s*(\d+)/i.exec(monteCarloSql);
    assert.ok(dbCap, "the procedure lost its own path cap");
    assert.ok(
      MAX_SIMULATIONS <= Number(dbCap[1]),
      `the route allows ${MAX_SIMULATIONS} paths but the procedure caps at ${dbCap[1]}`,
    );
    assert.ok(DEFAULT_SIMULATIONS <= MAX_SIMULATIONS);
  });

  it("persists nothing", () => {
    // The blueprint's version INSERTed one row per path from a public endpoint.
    assert.doesNotMatch(
      strip(monteCarloSql),
      /\bINSERT\b/i,
      "the Monte Carlo writes rows again. It is reachable from a public route, so persisting "
        + "per-path makes anonymous traffic a way to fill the tablespace.",
    );
    assert.doesNotMatch(
      strip(monteCarloSql),
      /\bFORALL\b/i,
      "FORALL is back — it iterates a collection and has no PARALLEL clause; the blueprint's "
        + "version did not compile",
    );
  });

  it("the percentile is taken over one call's own paths", () => {
    // The blueprint read the whole table with no predicate, so concurrent calls
    // contaminated each other and VaR drifted on every invocation.
    assert.match(strip(monteCarloSql), /FROM \(\s*SELECT/i);
    assert.match(strip(monteCarloSql), /CONNECT BY LEVEL <= p_paths_used/i);
  });
});

// --------------------------------------------------------------------------
// Credentials and failure classification
// --------------------------------------------------------------------------

describe("the client is configuration-safe by default", () => {
  it("is unconfigured, not broken, with no environment", () => {
    assert.equal(oracleConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv), null);
    const failure = notConfigured("Research search");
    assert.equal(failure.code, "oracle_not_configured");
    assert.equal(failure.status, 503);
  });

  it("defaults to ADMIN so today's Vercel variables work unchanged", () => {
    const config = oracleConfig(
      { NODE_ENV: "test", ORACLE_CONN_STRING: "x", ORACLE_PASSWORD: "y" } as NodeJS.ProcessEnv,
    );
    assert.equal(config?.user, "ADMIN");
  });

  it("but the least-privilege user is one variable away", () => {
    const config = oracleConfig({
      NODE_ENV: "test",
      ORACLE_CONN_STRING: "x",
      ORACLE_PASSWORD: "y",
      [ORACLE_USER_ENV]: "ALPHAENGINE_APP",
    } as NodeJS.ProcessEnv);
    assert.equal(config?.user, "ALPHAENGINE_APP");
    assert.match(appUserSql, /CREATE USER alphaengine_app/i);
    // The point of that user is that it cannot do what ADMIN can.
    assert.doesNotMatch(strip(appUserSql), /GRANT\s+DBA\b/i);
    assert.doesNotMatch(strip(appUserSql), /GRANT\s+RESOURCE\b/i);
    assert.match(appUserSql, /GRANT SELECT ON strategy_research_rag/i);
    assert.match(appUserSql, /GRANT EXECUTE ON run_monte_carlo_portfolio/i);
  });

  it("no failure message can leak connection material", () => {
    const failure = notConfigured("Research search");
    for (const secret of ["tcps://", "adb.", "oraclecloud", "password="]) {
      assert.ok(!failure.error.toLowerCase().includes(secret), `leaked ${secret}`);
    }
  });
});

describe("cosine distance maps to the similarity the panel renders", () => {
  it("is 1 for an identical vector and 0 for an opposite one", () => {
    assert.equal(similarityFromDistance(0), 1);
    assert.equal(similarityFromDistance(1), 0);
  });

  it("stays inside [0, 1] for the whole cosine range", () => {
    for (const distance of [-0.1, 0, 0.5, 1, 1.5, 2, 2.4]) {
      const similarity = similarityFromDistance(distance);
      assert.ok(similarity >= 0 && similarity <= 1, `${distance} → ${similarity}`);
    }
  });
});
