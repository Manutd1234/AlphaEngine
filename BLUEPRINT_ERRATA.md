# Master Blueprint — errata

`ALPHAENGINE_QUANT_OS_MASTER_BLUEPRINT.md` specifies seven phases. This file
records where its listings do not run, where they contradict this repository's
own tests, and where the repository deliberately diverges. It exists so the next
person executing the blueprint does not re-derive the same defects.

Every item below is enforced by a test, named at the end of the entry. Prose
drifts; the tests are what keep this accurate.

---

## §1 Guardrails

| Guardrail | State |
|---|---|
| No `NEXT_PUBLIC_` secrets | Held — no *secret* is published. Two public Supabase variables now are, scoped by RLS to one demo desk; `deployment-contract.test.ts` asserts every clause of that scope (see Phase 5) |
| Sub-millisecond edge evaluation | Not measurable as specified — see Phase 7 |
| Host port **8000** | Held. `docker-compose.yml` publishes `8000:8000` |
| Walletless TLS, `tcps://`, 1521 | Implemented in Phase 4 via node-oracledb thin mode |

**The blueprint breaks its own first guardrail.** Its Phase 3 `docker-compose.yml`
hardcodes `GATEWAY_AUTH_TOKEN=dev_alphaengine_token_998833` and a
`SUPABASE_SERVICE_ROLE_KEY` literal. `tests/test_container_contract.py::TestNoSecretShapes`
fails any credential-shaped literal in a committed container file. The repo's
`env_file` indirection stands.

---

## Phase 1 — Supabase schema & RLS · **done, superseded**

Applied, and deliberately different. Each deviation is justified in the
migration headers:

- **15 real gate names** from `modules/risk_proxy.py`, not the blueprint's 6
  invented labels. `FAT_FINGER` and `DRAWDOWN_HALT` are kept as aliases so
  blueprint-derived clients keep parsing.
- **Limit defaults mirror `config.py`** (50k / 500k / 150k), not the
  blueprint's invented 250k / 500k.
- **`latency_ms` is measured.** The blueprint hardcodes `0.19` — a fabricated
  measurement presented as data.
- **`decided_by` provenance**, append-only trigger, `search_path` pinned on
  every `SECURITY DEFINER`, deny-by-default RLS. (Originally zero `anon`
  policies; there is now exactly one, added in Phase 5 and scoped to the public
  demo desk. Risk limits remain revoked.)

*Enforced by `tests/test_supabase_schema.py`.*

**Added since:** `supabase/migrations/20260808120600_desk_blotter_view.sql`.
With a second writer (Phase 2), `decided_by` only protects anything if every
reader filters on it — and the table is append-only, so a query that forgets
produces a blended blotter that cannot be cleaned up. `public.desk_blotter` is
the read surface; reaching past it is now a visible act in a diff.

---

## Phase 2 — `evaluate-order` Edge Function · **six defects**

The listing does not boot, and would not insert if it did.

1. **`import { Deno } from "https://deno.land/std@0.177.0/http/server.ts"`** —
   `Deno` is a runtime global; that module exports `serve`. The import fails at
   boot. (`embed-research` already shows the correct shape: no import.)
2. **The INSERT omits `decided_by`**, which is `NOT NULL` in the Phase 1 schema
   that shipped. Every insert fails. The blueprint's Phase 2 does not match its
   own Phase 1.
3. **`blendedVwap = weightedSum / targetNotional`** divides by the *requested*
   notional. When the venues cannot fill the order, the unfilled remainder
   silently improves the reported average — a better fill than happened.
4. **`allocations[0].venue` throws** on a zero or negative `targetNotional`.
5. **Slippage is linear in size** (`slipBps * alloc / 100_000`). This repo models
   impact as square-root everywhere else (`k·√(order ÷ ADV)`), and two engines
   disagreeing about the cost of the same order is worse than either being
   approximate.
6. **`Access-Control-Allow-Origin: *`** on a function deployed `--no-verify-jwt`
   that writes rows. Narrowed to the deployed origins.

Corrected in `supabase/functions/evaluate-order/index.ts`, which remains a
labelled **two-gate sandbox** — the fifteen-gate decision is the Python
gateway's alone. *Enforced by `tests/test_supabase_schema.py::TestSandboxIsolation`.*

---

## Phase 3 — Dockerized gateway · **done**

`8000:8000` rather than the blueprint's `8000:8080`; the guardrail only
constrains the host port. The named volume and `stop_grace_period` reasoning in
the compose header is load-bearing — a bind mount degrades DuckDB to an
unwritable SQLite fallback, and the 10s default risks SIGKILL mid-write.

*Enforced by `tests/test_container_contract.py` and `deployment-contract.test.ts`.*

---

## Phase 4 — Oracle 23ai engines · **four defects**

The listing does not compile.

1. **`FORALL i IN 1..p_simulations PARALLEL` is not valid PL/SQL.** `FORALL`
   iterates a bound collection and has no `PARALLEL` clause.
2. **`monte_carlo_runs` is referenced but never created.**
3. **The percentile reads the whole table with no predicate**, so concurrent or
   repeat calls read each other's paths and the reported VaR drifts further from
   the truth on every invocation — a wrong number that looks plausible.
4. **`VECTOR(1536, FLOAT32)` is the wrong width.** The only embedding source in
   this repository is `supabase/functions/embed-research`, which runs
   `gte-small` at **384** dimensions, matching `extensions.vector(384)` in the
   pgvector migration. At 1536 the Oracle index could never be populated from
   the existing corpus — and a query embedded by a different model returns
   confident, meaningless neighbours, a failure that looks exactly like success.

Also changed, on security grounds rather than correctness:

- **The procedure persists nothing.** The blueprint wrote 100,000 rows per call
  from what is now a public serverless route: a way for anonymous traffic to
  fill the tablespace of an Always Free instance. Paths are generated in an
  inline view and discarded when the statement ends.
- **The path count is capped in two places** — the route and the procedure. The
  route is editable by anyone touching TypeScript; the database is the layer an
  attacker cannot reach.
- **`oracle/03_app_user.sql`** creates a least-privilege user. The blueprint puts
  the **ADMIN** password in a serverless function's environment, which grants
  full DBA to anything that can read an env var. `ORACLE_USER` defaults to
  `ADMIN` so existing configuration works unchanged; switching is one variable.
- **The HNSW index is created separately and tolerates failure.** An in-memory
  neighbour graph needs `VECTOR_MEMORY_SIZE`, which is not enabled by default
  and may not be settable on Always Free. Exact search still answers.

*Enforced by `tests/oracle-contract.test.ts`.*

---

## Phase 5 — Frontend & realtime · **implemented, after unblocking it**

As specified it could not work, for two reasons worth keeping on the record
because they explain the shape of what shipped:

1. RLS revoked all from `anon` with zero `anon` policies, so a browser anon-key
   subscription to `order_blotter` returned nothing. Blueprint Phase 5 assumes
   the blueprint's permissive Phase 1, not the one that shipped.
2. `app/api/system/events/route.ts` records a deliberate decision *against*
   streaming for the event log: an SSE connection pins a client to one
   serverless instance whose ring buffer is the only one it can see. That
   reasoning still stands for that endpoint — it is why the tape below streams
   from Postgres rather than from a Next route.

**Now implemented, with the blocker removed deliberately.**
`supabase/migrations/20260808120700_anon_demo_realtime.sql` adds the anon SELECT
policy the design needs, scoped by three clauses that each do work:
`desk_id = <public demo desk>`, `user_id is null` (so a future login story does
not retroactively publish anyone's blotter), and `decided_by = 'gateway'` (so
the sandbox is never served as the desk's decision). Risk limits stay revoked —
publishing where the gates sit tells anyone how to size an order that passes.

Two corrections to the blueprint's hook while porting it:

- **It is a tape, not a source.** The blueprint's `useAlphaEngineRealtime`
  returns the blotter, implying the subscription is the record. A realtime
  channel drops silently while it reconnects, so the gateway's DuckDB blotter
  stays authoritative and `useBook` still polls it. `lib/use-desk-tape.ts`
  streams what has *just* been decided, beside the complete record.
- **`unavailable` is a state, never an empty list.** The blueprint's hook has no
  way to say the channel died; an empty array renders identically to a quiet
  desk. `TapeState` distinguishes unconfigured / connecting / live / unavailable.

The L2 depth broadcast in the blueprint's listing is not implemented: the
gateway already consolidates venue books and the web project never opens an
exchange socket.

## Phase 6 — Vercel environment matrix

Added: `ORACLE_CONN_STRING`, `ORACLE_PASSWORD`, `ORACLE_USER`, all documented in
`web/.env.example` and all read at **runtime only** — a build-time read turns a
missing credential into a failed deployment rather than a feature that reads
"unavailable".

Not added, deliberately:

- **`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are now
  published** — the deliberate decision the RLS migration reserved. What makes
  that safe is not the key being secret (it is not, by definition) but the
  policy above: the key can reach gateway-decided, unowned rows of one demo desk
  and nothing else, with SELECT only. `deployment-contract.test.ts` asserts each
  clause of that scope rather than asserting the key's absence.

- **`BINANCE_WS_URL`** belongs to the gateway's `.env`; the web project never
  opens an exchange socket.

*Enforced by `deployment-contract.test.ts`.*

---

## Phase 7 — Verification

**`latencyMs < 1.0ms` is not measurable as specified.** The function's
`performance.now()` delta excludes TLS, the PostgREST round trips on the accept
path and any cold start. Sub-millisecond describes in-function compute only. The
field is named `computeMs` in the corrected function so it cannot be read as an
end-to-end number.

Added: `web/scripts/verify-oracle.mjs` — the blueprint's `node -e` one-liner with
an error taxonomy that names the fix for each failure (wrong password, stopped
instance, mTLS still required, no free session, schema not applied) instead of
printing an ORA stack.

CI keeps its network-free guarantee: the live probes are a `workflow_dispatch`
job that skips cleanly without secrets. A red build must mean the code broke,
never that an idle Always Free database had auto-stopped.
