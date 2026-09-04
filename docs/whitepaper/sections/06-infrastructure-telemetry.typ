// Chapter 6 — Infrastructure and telemetry specifications.
//
// The operational manual half of the document: where state lives, which store
// is authoritative for what, what travels over which protocol, at what
// threshold an automatic control engages and releases, which telemetry plane
// may make which claim, and which CI job proves which sentence.
//
// Every schema below is transcribed from the file that creates it and every
// threshold from the file that reads it. Sources read in full before writing:
// modules/audit/{schema,store,boundaries}.py, modules/data_ops_store.py,
// modules/data_quality_schema.py, modules/work_items.py, modules/schedule_runs.py,
// modules/single_writer.py, modules/risk_proxy/{monitor,kill_switch,rate_limit}.py,
// modules/tca_engine/{supervision,feed}.py, modules/api/{risk,tca,meta}.py,
// modules/metrics/{__init__,exposition,decision_latency}.py,
// modules/research_stages.py, modules/research_schedule.py,
// modules/research_generate{,_vision}.py, config.py, tests/conftest.py,
// tools/openapi.json, web/lib/gateway.ts, web/scripts/check-gateway-openapi-digest.mjs,
// web/lib/test-counts.generated.ts, web/tests/fixtures/gate-parity.json,
// web/tests/file-size.test.ts, supabase/migrations/*.sql, oracle/*.sql,
// .github/workflows/{ci,deploy,e2e,schema}.yml,
// docs/architecture/{ARCHITECTURE,LATENCY_BUDGET,DATA_OPS_BACKEND}.md,
// docs/testing/TESTING.md.

// The template is imported here as well as in main.typ because `include`
// evaluates a file in its own scope: `measured`, `illustrative` and `note` are
// not inherited from the including document. Helpers only; no page, font or
// numbering setup, which stays template.typ's job.
#import "../template.typ": illustrative, measured, note

= Infrastructure and telemetry specifications

This chapter is the operational half of the document. Chapters 2 to 5 argue what
the desk decides and why the mathematics is sound; this one specifies where the
resulting state lives, which store is believed when two disagree, what travels
over which protocol, at what threshold an automatic control engages and releases,
and which continuous-integration job proves which claim. Every schema below is
transcribed from the file that creates it, every threshold from the file that
reads it, and every figure carries the artefact it came from.

== The persistence topology, and what "authoritative" means here

Six stores are in play and only one of them is authoritative for decisions. The
distinction is not decorative. A system with two authoritative stores has no
authoritative store; it has a reconciliation problem it has not noticed yet.

#table(
  columns: (0.72fr, 2.28fr),
  [Store], [Authority, durability and rebuild contract],
  [DuckDB audit log], [Authoritative for orders, order/risk events, TCA
    snapshots, backtest runs and equity snapshots. It lives on the OCI VM's
    Docker volume and has no rebuild source.],
  [DuckDB coherence tape], [Domain record for prediction-market books, quote
    history, episodes, outcomes and calibration records. It lives at
    `COHERENCE_DB_PATH`, independently of the order ledger.],
  [Data-operations ledger], [Operational authority for eight logical
    data-operations and Diffusion tables. SQLite on the mounted volume is the
    complete default. The opt-in PostgREST backend covers the four original
    operations tables. A `diffusion_events` migration exists, but the generic
    count path assumes an `id` column that this table does not have; runs and
    texts are absent and studies lag current skill fields. Postgres therefore
    does not yet implement the current Diffusion store contract; selection is
    fail-closed, never an implicit fallback.],
  [Supabase Postgres], [Derived decision mirror plus the managed research
    corpus. Decision rows can be replayed from the audit log; corpus and
    account records follow their own ingest contracts.],
  [Neo4j], [Optional projection of `research_edges`; drop and re-project it
    whenever it disagrees with Postgres.],
  [Oracle Autonomous Database], [Optional in-database simulation surface; it
    owns no trading fact and is rebuilt by reapplying its schema.],
)

The rule that follows: *the audit log is embedded on purpose*, because the desk
must keep recording decisions when every network dependency is unreachable, and
everything downstream is a view. If Supabase is empty, the desk trades. If the
audit volume is empty, the desk has forgotten what it did, which is the only
failure in this list that cannot be repaired from somewhere else.

=== One writer, enforced twice

The gateway runs as a single Uvicorn worker because the position book, the
resting-order book, the token bucket and the kill switch are plain objects on
one heap. Two mechanisms stop a second writer, and they close different holes.

`tests/test_container_contract.py` fails the build if `--workers` or `gunicorn`
appears in the committed image definition. That reads the artefact, so it cannot
see `docker compose up --scale gateway=2`, a second container pointed at the same
named volume, or a command typed at a shell. `modules/single_writer.py` closes
that with a POSIX advisory `flock(2)` claim on one file in `DATA_DIR`, taken in
`RiskGateway.start()` and held for the life of the process. The reason given for
`flock` over a lock row in a database is that the kernel releases it when the
holder dies by any route, `SIGKILL` and out-of-memory included, so there is no
stale lock, no lease to renew and no timeout to tune.

Behind both sits a third guard in the audit store. `AuditStore._connect`
formerly caught every exception from `duckdb.connect` and fell back to SQLite at
a different path — correct for one of the two meanings of that exception and
catastrophic for the other, because a second live process holding the database is
also reported as an IO error. The second gateway therefore did not fail: it
opened a private ledger and began writing a divergent history while `/health`
reported `backend: sqlite` as though somebody had chosen it. The lock case is now
matched on the two phrases DuckDB builds that message from and raised as
`AuditLedgerConflict`; every other IO error still takes the fallback it always
took (`modules/audit/store.py`).

== The DuckDB audit log

Ten tables, created with `CREATE ... IF NOT EXISTS` in `modules/audit/schema.py`
and nowhere else. Columns added after the first databases existed are widened by
`AuditStore._migrate` instead: a column appended to the DDL list is created on a
fresh database and missing on every existing one, so the two diverge silently and
only whichever query names that column ever finds out.

The two central tables:

```sql
CREATE TABLE IF NOT EXISTS orders (
    ts              TIMESTAMP,   order_id        VARCHAR,
    client_order_id VARCHAR,     strategy        VARCHAR,
    symbol          VARCHAR,     side            VARCHAR,
    order_type      VARCHAR,     quantity        DOUBLE,
    notional        DOUBLE,      limit_price     DOUBLE,
    accepted        BOOLEAN,     rejected_by     VARCHAR,
    reason          VARCHAR,     latency_ms      DOUBLE,
    fill_price      DOUBLE,      fill_qty        DOUBLE,
    fee_usd         DOUBLE,      slippage_bps    DOUBLE,
    venue           VARCHAR,     checks_json     VARCHAR,
    source          VARCHAR,     status          VARCHAR,
    time_in_force   VARCHAR,     decided_at      TIMESTAMP
);

CREATE TABLE IF NOT EXISTS risk_events (
    ts   TIMESTAMP, event VARCHAR, severity VARCHAR,
    actor VARCHAR,  symbol VARCHAR, detail VARCHAR, payload VARCHAR
);
```

`decided_at` sits beside `ts` because a resting order fills hours after it was
decided and one timestamp cannot carry both facts. `checks_json` carries the full
gate battery rather than a single verdict, because an order routinely fails
several gates at once and a blotter that can name only one has lost the
diagnosis. The other eight tables are `order_events` (place, amend, cancel, fill,
with `replaces` linking an amendment to what it superseded), `tca_snapshots`,
`backtest_runs` (carrying `dsr`, `pbo`, `oos_sharpe` and the `data_hash` tying a
run to the exact bars it saw), `equity_snapshots`, `jobs`, `subscribers`,
`telegram_link_tokens` and `ohlcv_cache`.

=== Append-only by convention, and two different write contracts

Nothing in `modules/audit/` issues `UPDATE` or `DELETE` against `orders` or
`risk_events`. DuckDB cannot enforce that with a trigger, so the property is
carried by the module boundary and by review; the Postgres mirror, which can
enforce it, does (§6.4).

Within that module there are deliberately two write contracts, and mixing them
up would be a real defect in either direction:

- *Fire and forget.* `_exec` swallows a failed write and `query` returns an empty
  list. This is right for evidence: losing a TCA snapshot must never take the
  order path down with it.
- *Strict.* `modules/audit/boundaries.py` holds the two durable replay
  boundaries, `book_reset` and `session_rollover`. Both writes raise on failure
  and both reads raise on a closed or unreadable store, because silently treating
  an audit failure as a flat book would understate exposure. Both reads also
  refuse an exact timestamp tie rather than guess which of two boundaries
  happened second.

=== Replay as an algebra

The current session's paper book is not persisted as a position snapshot; it is
recomputed. Let $F_d$ be the accepted, filled orders of UTC session $d$ ordered
by $(t, "order_id")$, and let $r_d = max{t : "book_reset" in "risk_events", t in d}$
be the last reset boundary in that session. Then the rebuilt position in symbol
$s$ is

$ q_s = sum_(f in F_d, t_f > r_d) epsilon_f dot q_f, quad epsilon_f = cases(+1 "if" f "is a buy", -1 "if" f "is a sell") $

with the realised cash leg accumulated over the same set. Two properties are
load-bearing: `book_reset` is durable, so a reset survives a restart and is not
undone by replay; and the filter is `status IS NULL OR status = 'FILLED'` rather
than a test on `fill_qty`, because an accepted order that was cancelled or
expired never filled by design, and letting it through would make the caller read
missing fill evidence as corruption and refuse to start. What replay
deliberately does *not* reconstruct is overnight *positions*: only the profit and
loss earlier sessions banked and the equity this one opened on survive the
boundary, from `latest_session_rollover`. Positions need a durable snapshot this
schema does not carry, and the module says so rather than approximating it.

== The SQLite data-operations ledger

Four tables hold the state the gateway must not forget across a restart and for
which the audit log's fire-and-forget contract is wrong: a work item a person
just edited, or a quality finding another instance is about to read, needs a
write that raises when it fails and an `UPDATE` that reports whether it hit a
row. They live in a stdlib `sqlite3` file on the same mounted volume
(`modules/data_ops_store.py`).

```sql
CREATE TABLE IF NOT EXISTS data_quality_findings (
    id INTEGER PRIMARY KEY, instance TEXT NOT NULL, seq INTEGER NOT NULL,
    source TEXT NOT NULL, observed_at REAL NOT NULL, received_at REAL NOT NULL,
    capability TEXT NOT NULL, provider TEXT NOT NULL, symbol TEXT,
    key TEXT NOT NULL, passed INTEGER NOT NULL, fatal INTEGER NOT NULL,
    warn INTEGER NOT NULL, drift INTEGER NOT NULL, not_evaluated INTEGER NOT NULL,
    checks_json TEXT NOT NULL, UNIQUE(instance, seq));

CREATE TABLE IF NOT EXISTS data_work_items (
    id TEXT PRIMARY KEY,
    kind     TEXT NOT NULL CHECK(kind     IN ('request','ticket','bug')),
    priority TEXT NOT NULL CHECK(priority IN ('P0','P1','P2','P3')),
    status   TEXT NOT NULL CHECK(status   IN ('intake','ready','progress','resolved')),
    title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT 'Unassigned', area TEXT NOT NULL DEFAULT 'Pipeline',
    opened_at REAL NOT NULL, sla_due_at REAL, resolved_at REAL,
    created_by TEXT NOT NULL, updated_at REAL NOT NULL, updated_by TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1);
```

`UNIQUE(instance, seq)` is what makes finding ingestion idempotent under retry
from any number of web instances. `not_evaluated` is a first-class count beside
`passed`, `fatal`, `warn` and `drift`, which is the schema-level expression of
the house rule that a check which could not run is not a check that passed. The
remaining two tables are `data_quality_escalations` (with `acknowledged_at` and
`acknowledged_by` added later through a conditional widening, `NULL` meaning
nobody has taken it, which is also true of every row that predates the column)
and `data_schedule_runs`, keyed by `schedule_id` with `last_run_at`,
`last_job_id` and `last_outcome`.

=== The connection pragmas, and the concurrency lesson behind them

```python
conn = sqlite3.connect(path, timeout=BUSY_TIMEOUT_S,
                       check_same_thread=False, isolation_level=None)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA synchronous=NORMAL")
conn.execute("PRAGMA foreign_keys=ON")
```

`BUSY_TIMEOUT_S` is #measured("30 s", "modules/data_ops_store.py") against
Python's default of five, and the reason is a diagnosis rather than a
superstition. `PRAGMA journal_mode=WAL` is the first statement on every fresh
connection and it has to read the file. A WAL reader never waits for a WAL
writer, but it does wait for the `EXCLUSIVE` lock the *last* connection takes as
it closes, to checkpoint the WAL and delete the `-wal` and `-shm` files. Under
the previous test fixture that close happened whenever the garbage collector
reached a leaked handle, on whatever thread it was running, while the next test
was opening the same file, and on a loaded runner the checkpoint outlasted five
seconds. Thirty seconds is a wait a lock-holder cannot plausibly exceed and is
far shorter than a red build.

A busy timeout covers a lock another connection *holds*. It does not cover two
connections in one process opening the same file at the same instant and both
running the WAL pragma. Measured on a fresh file with six threads released by a
barrier, #measured("2 of 240 opens", "modules/data_ops_store.py") failed
immediately with `database is locked`, in 0.00 s, with the busy handler never
consulted. That is how the gateway's own shutdown failed in the suite: the event
loop and a worker thread each found the shared store unbuilt and each opened it.
A process-wide `threading.Lock` around `open_data_ops_db` turns a race SQLite
refuses to wait out into a queue; opens are rare and cost about a millisecond.

The connection is long-lived on purpose. A store that reconnected per statement
would pay the WAL open every time and, as the last handle each time, the
checkpoint-and-delete on close, which is precisely the contention the module
exists to avoid.

=== Versioned edits, and the second backend

Concurrent edits use optimistic concurrency rather than a lock held across a
human's thinking time: `BEGIN IMMEDIATE`, then `UPDATE ... WHERE id = ? AND
version = ?`, and a row count of zero is reported to the caller as a conflict
rather than retried. `DATA_OPS_BACKEND=postgres` swaps the store for one speaking
PostgREST, and the translation is exact rather than approximate.

#table(
  columns: (auto, 1fr, 1fr),
  [Concern], [`sqlite` (default)], [`postgres`],
  [Storage], [one file on the mounted volume], [Supabase, over PostgREST],
  [Identifier allocation], [`MAX(...) + 1` in a transaction], [a sequence, via `next_work_item_id`],
  [Versioned edit], [`BEGIN IMMEDIATE` then `WHERE version=?`], [`PATCH ?id=eq.X&version=eq.N`],
  [Aggregates], [`GROUP BY` in the query], [`data_quality_rollup`, one round trip],
)

#note[Parity in source; rollout remains separate][The current migration set is parity-complete for all four Diffusion adapters:
`20260831120000` adds runs, texts, `vote_line`, the current `skill_*` fields and
desk-qualified keys. The generic count path projects `desk_id`, and
`open_data_ops_store()` requires and passes an explicit `SUPABASE_DESK_ID`.
Migration `20260831121000` refuses ambiguous legacy `desk_id='default'` rows
before removing unsafe defaults. Those migrations are present in source and the
generated bundle; this source audit does not claim they have been applied to a
live project. SQLite remains the complete zero-configuration default.]

Two boundaries are stated plainly in `docs/architecture/DATA_OPS_BACKEND.md`.
Selecting `postgres` without credentials raises at startup rather than falling
back, because a fall-back would leave a deployment reporting one backend and
using another while the `backend` field on the wire said `sqlite`. And moving
these eight logical tables to Postgres does *not* make a second gateway process possible:
the book, the bucket and the kill switch remain process-local, held by the two
mechanisms of §6.1.

#note("What the offline suite proves about the Postgres path, and what it does not")[
  `tests/test_data_ops_postgrest.py` asserts the *request* the store builds, the
  `Prefer` headers, the filter grammar and the conflict target, against
  `httpx.MockTransport`. That is where the translation lives, and a test that
  only checked the parsed response would pass with `Prefer` missing entirely.
  The live pass skips with its reason printed unless `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DESK_ID` are exported for that run.
  `tests/test_data_quality_rollup.py` pins the Python `_AGGREGATE` and
  the SQL `data_quality_rollup` to the same six figures, because if one moves
  without the other both backends answer, neither errors, and they disagree.
]

== Postgres and Supabase: the mirror and the research corpus

=== The order blotter mirror

```sql
create table public.order_blotter (
  id uuid primary key default uuid_generate_v4(),
  desk_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid references auth.users(id) on delete cascade,
  decided_by public.desk_decider not null,
  gateway_order_id text, client_order_id text,
  symbol text not null, side public.order_side not null, order_type text,
  quantity numeric(24,10), notional numeric(15,2), venue text,
  fill_price numeric(18,8), filled_notional numeric(15,2) default 0.00,
  slippage_bps numeric(10,4), fee_usd numeric(12,4), latency_ms numeric(10,3),
  verdict public.order_verdict not null,
  rejected_by public.order_verdict[] not null default '{}',
  checks jsonb, status text, strategy_tag text, source text,
  decided_at timestamptz, occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint unique_decider_order unique nulls not distinct (decided_by, gateway_order_id));

create trigger order_blotter_append_only
  before update or delete on public.order_blotter
  for each row execute function public.reject_blotter_mutation();
```

The trigger is the point: what the DuckDB log holds by convention, Postgres holds
by constraint. `unique_decider_order` is what makes a retried mirror write
idempotent rather than a duplicate fill, and `rejected_by` is an array because an
order fails several gates at once. The blueprint this schema descends from
hardcoded `latency_ms` at `0.19` — a fabricated measurement, removed on principle
— and the column now carries the `RiskDecision.latency_ms` the gateway timed; the
numeric defaults mirror `config.py`'s real limits, with
`tests/test_supabase_schema.py` pinning the equality so the two cannot drift.

Delivery cannot slow an order. `modules/supabase_mirror.py` enqueues with
`put_nowait` into a bounded queue, so it cannot block, cannot raise past its own
frame, and on a full queue *counts the drop* rather than waiting. A mirror that
can slow an order down has become load-bearing, and this one structurally
cannot.

=== The pgvector research corpus

```sql
create table public.research_documents (
  id uuid primary key default gen_random_uuid(),
  desk_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid references auth.users(id) on delete cascade,
  kind public.research_doc_kind not null,
  source_ref text not null, symbol text, interval text, strategy text,
  occurred_at timestamptz not null, title text not null, body text not null,
  metrics jsonb not null default '{}', data_hash text,
  embedding extensions.vector(384), embedding_model text,
  embedding_status text not null default 'pending'
    check (embedding_status in ('pending','ready','failed')),
  created_at timestamptz not null default now(),
  constraint unique_desk_kind_ref unique (desk_id, kind, source_ref));

create index idx_research_docs_embedding
  on public.research_documents using hnsw (embedding extensions.vector_cosine_ops);
create index idx_research_docs_kind_time
  on public.research_documents (kind, occurred_at desc);
```

Three columns carry an argument each. `body` stores the exact text that was
embedded, so a later change to the card renderer cannot silently invalidate every
stored vector with no way to detect it. `data_hash` ties a document to the exact
bars its backtest saw. And `embedding` is nullable with
`embedding_status = 'pending'` on failure, *never* a zero vector: under cosine
distance the zero vector is equidistant from every query and would surface as
"similar" to anything asked, which is a wrong answer wearing the shape of a right
one. The same rule is restated in the Oracle schema for the same reason (§6.6).

Two indexes, two access patterns: HNSW under cosine for the dense arm of
retrieval, and a plain B-tree on `(kind, occurred_at desc)` for the ordinary
"most recent documents of this kind" read that a vector index answers badly.

=== Row-level security, and realtime as a subscription filter

The corpus and the blotter ship deny-by-default: `enable row level security`, an
explicit `revoke all ... from anon`, and policies only for `authenticated` keyed
on `(select auth.uid()) = user_id`. A later migration adds exactly one `anon`
policy, and it is narrow in three clauses at once:

```sql
create policy "Public demo desk blotter is readable anonymously"
  on public.order_blotter for select to anon
  using (desk_id = '00000000-0000-0000-0000-000000000001'::uuid
         and user_id is null
         and decided_by = 'gateway');
```

`user_id is null` is the clause that makes shipping a login later safe: rows
mirrored by the gateway have no owner, an authenticated trader's rows do, so the
policy cannot retroactively publish anyone's blotter. `decided_by = 'gateway'`
keeps the labelled two-gate sandbox from ever being served as the desk's own
decision. Risk limits stay closed entirely, on the grounds that publishing where
the gates sit tells anyone how to size an order that passes.

The property worth naming for a protocol chapter is what happens next:

#note("RLS is the subscription filter")[
  Supabase Realtime's `postgres_changes` delivers a row only if the subscribing
  role could `SELECT` it. The policy above therefore *is* the subscription
  filter, and an anonymous client cannot subscribe its way past it. There is no
  second authorisation surface to keep in step with the first, which is the
  usual way a websocket fan-out leaks rows a REST endpoint would have refused.
  `replica identity full` is set even though the table is append-only and only
  `INSERT` is ever delivered, because a published table without it produces
  silently incomplete payloads the day that stops being true.
]

Two limits are recorded rather than hidden. RLS on the research corpus is still
*bypassed* in practice, because the gateway reads with the service-role key and
the writer sets no `user_id`; what shipped instead is an optional
`filter_desk_id` predicate applied inside the candidate CTE *before* either
ranking is taken, so a scoped rank is a rank among rows the caller was allowed
rather than a rank among everybody. And the tenant scope is per desk, not per
user, because one shared gateway token means there is no per-user identity to key
on yet.

== Neo4j as a rebuildable read model

Postgres owns `research_edges`. `modules/research_graph_projection.py` merges that
derived state into Neo4j on a six-hourly sweep, and a daily sweep partitions the
corpus and writes both label sets back off one read
(`DEFAULT_RECONCILE_SCHEDULES = ("reconcile:graph@every=6h", "reconcile:communities@every=1d")`).
A dual write was the rejected alternative: two systems that must agree, with
drift detectable only if somebody goes looking. Projection makes divergence a
non-event, since a wrong graph is dropped and re-projected.

Four constraints govern the sweep, each with its reason in the file:
`RECONCILE_BATCH = 200` documents per tick, because edge derivation is quadratic
in what it is given and a backlog should drain across ticks rather than scan the
corpus; a retained tick history of 32, since an unbounded history is a leak that
grows for as long as the process stays healthy; a backoff doubling from 60 s to a
3 600 s ceiling, so an unreachable dependency is retried within the hour rather
than on all of its ticks; and an idle heartbeat every 20 ticks, because silence
is indistinguishable from a stopped scheduler.

Three properties keep the read model honest. A writer may not read its own
output, so the sweep is forced onto the corpus path; labels written by two
different sweeps refuse as "mid-rebuild", because community identifiers are
comparable only within one sweep; and request-time *traversal* never touches
Neo4j at all, since `/{document_id}` runs a Postgres recursive CTE. Absent Neo4j,
both the sweep and the read model report a named reason and the whole suite
passes. What is *not* claimed is that the algorithms run in the graph: Louvain
and PageRank live in the GDS library, which the Aura Free tier does not have and
CI cannot install, so the read model serves what the sweep computed rather than
computing genuinely different things under one field name.

== Oracle: in-database simulation

The Oracle Autonomous Database 23ai schema (`oracle/01_schema.sql`) exists for
one capability the other stores do not offer: running the simulation where the
data is, rather than moving rows to compute over them. Every statement is
re-runnable, since Oracle has no `CREATE TABLE IF NOT EXISTS` and a schema script
that cannot be run twice is one nobody dares run once.

```sql
CREATE TABLE strategy_research_rag (
  research_id      NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  kind             VARCHAR2(32)  NOT NULL,
  source_ref       VARCHAR2(200) NOT NULL,
  strategy_name    VARCHAR2(100), symbol VARCHAR2(32), data_hash VARCHAR2(64),
  title            VARCHAR2(300) NOT NULL,
  body             CLOB          NOT NULL,
  metrics          CLOB CHECK (metrics IS JSON),
  embedding        VECTOR(384, FLOAT32),
  embedding_status VARCHAR2(16) DEFAULT 'pending' NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT rag_ready_has_vector_ck
    CHECK (embedding_status <> 'ready' OR embedding IS NOT NULL),
  CONSTRAINT rag_source_uk UNIQUE (kind, source_ref));
```

`VECTOR(384, FLOAT32)`, not the blueprint's 1536, because the only embedding
source in the repository is the `embed-research` edge function running `gte-small`
at 384 dimensions. At 1536 the index could never be populated from the existing
corpus, and a query embedded by a different model returns confident, meaningless
neighbours, which is a failure that looks exactly like success.
`web/tests/oracle-contract.test.ts` asserts that the three numbers agree.
`rag_ready_has_vector_ck` is the zero-vector rule expressed as a constraint: a row
may claim `ready` only if it actually has a vector.

The HNSW index is created in its own block and is *allowed to fail*. An in-memory
neighbour graph needs `VECTOR_MEMORY_SIZE`, which is not enabled by default and
is not always settable on an Always Free instance. `VECTOR_DISTANCE` falls back
to an exact scan, which over a corpus this size is milliseconds, so a missing
index is a performance note rather than an outage. The rejected repair is
explicit in the file: do not lower the target accuracy, because a wrong
neighbour is worse than a slow one for evidence retrieval.

=== The Monte Carlo procedure, and four defects fixed

`run_monte_carlo_portfolio` simulates terminal equity under geometric Brownian
motion,

$ S_T = S_0 exp( (mu - 1/2 sigma^2) T + sigma sqrt(T) Z ), quad Z tilde cal(N)(0,1) $

and reports $"VaR"_99 = S_0 - Q_(0.01)(S_T)$, the mean terminal equity, and the
path count the cap actually allowed. Four differences from the blueprint it
descends from are load-bearing and each is recorded in the file's header:
`FORALL ... PARALLEL` is not valid PL/SQL, so the generator is set-based; the
`monte_carlo_runs` table it wrote to was never created anywhere; the percentile
was taken over that whole table with no predicate, so two callers read each
other's paths and the figure drifts further from the truth on every invocation;
and it persisted 100 000 rows per call from a procedure reachable by a public
serverless route. Nothing is written now, since the paths live in an inline
view that disappears when the statement ends.

The path cap, `c_max_paths = 50000` with `c_min_paths = 100`, is enforced in the
procedure and not only in the caller, because the route can be changed by anyone
editing TypeScript and the database is the last line that decides how much CPU one
anonymous request may spend. One honesty note travels with the output: this is a
*terminal-value* VaR, it says nothing about the path, and it must not be
presented as comparable to a maximum-drawdown figure.

== The lifespan-owned runtime boundary

`main.py` owns the FastAPI shell, middleware, routers, console routes and public
exception shape. `modules/application_lifecycle.py` owns process construction.
It claims the single-writer boundary, creates the stores and service facades,
starts bounded runtime and read models, then starts audit, schedulers, coherence
tasks, Telegram and core self-measurement under one `AsyncExitStack`. Cleanup is
registered before startup and runs in reverse order; one cleanup failure is
recorded without preventing the remaining graph from releasing.

The coherence tasks separate freshness from retention. Active browser reads
and the warm cache run on a 20-second cadence; the append-only book recorder is
enabled only when `COHERENCE_POLL_S` and either an explicit series watchlist or
`COHERENCE_LIVE_FAMILIES=1..200` are configured. Broad mode discovers one
bounded page of open event families and hydrates active books in chunks, so
coverage grows without an unbounded cursor crawl. The signed RFQ reader retries
one 429 or 5xx after 200 milliseconds; a second failure remains a typed upstream
outage rather than an empty quote set.

The published `ApplicationContext` is frozen and slot-backed. It contains one
runtime, market-data provider, execution gateway, risk manager, job service,
audit service, Telegram runtime, health service and latest-state stream. Routes
receive services from that context instead of retrieving module globals or
constructing an alternate book. `tests/test_application_lifecycle.py` proves
partial-start unwind, while `tests/test_application_runtime_contracts.py`
proves context immutability, service delegation, route ownership, budget classes
and the WebSocket topic.

Synchronous request work crosses one bounded `BackendRuntime` rather than the
global unbounded `asyncio.to_thread` queue. Its repository defaults and public
failure semantics are:

#table(
  columns: (1fr, auto, 1.35fr),
  [Boundary], [Committed default], [Operational contract],
  [Worker capacity], [4 running + 12 queued], [Admission is bounded; not-yet-started work may be cancelled, running Python threads are drained and never reported as killed.],
  [H1 / H2 / H3 / H4 / H5 budgets], [3 / 8 / 15 / 25 / 3 s], [The proxy sends the fixed class and remaining milliseconds; the gateway accepts only the tighter ceiling.],
  [Deadline], [HTTP 504], [The caller's budget ended before a trustworthy answer arrived.],
  [Saturation], [HTTP 503], [`Retry-After: 1`; capacity, not an upstream auth error, refused admission.],
  [Telemetry], [256-sample windows], [Queue and duration p95, counts by bounded operation label, and event-loop lag in milliseconds.],
)

The response echoes the sanitised request identity and budget class and emits
`Server-Timing` for total backend, queue and blocking duration. These are
instrumentation contracts, not live measurements; this revision does not claim
a current saturation rate or lag percentile.

== API and websocket protocols

=== The committed REST surface

The gateway's OpenAPI schema is a contract between two separately deployed units,
so it is committed rather than generated at runtime:
#measured("76 paths carrying 79 operations", "tools/openapi.json, counted 2026-08-29") -
#measured("57 GET, 20 POST, 1 PATCH, 1 DELETE", "tools/openapi.json") - clustered
by the tag each router carries: research (15), risk and orders (14), data and
data-quality (11), the Kalshi coherence lab (8), coherence (5), meta (5),
coherence history (5), audit (4), diffusion (4), machine-learning research (3),
telegram (3) and TCA (2). The paths are fewer than the operations because a few
serve two verbs each --- `/api/orders` submits and lists, `/api/data/work-items`
creates and lists.

Two of those are deliberately unauthenticated, `/health` and `/metrics`; every
other route resolves an actor first (`modules/api/meta.py`). The web workspace
verifies the contract before it ships: `prebuild` runs
`check-gateway-openapi-digest.mjs`, which canonicalises the JSON with sorted keys
and compares its SHA-256 against `COMMITTED_GATEWAY_OPENAPI_SHA256` in
`web/lib/gateway-openapi-digest.generated.ts`. Two independently deployed units
assert their shared contract before either one of them deploys. The verified
2026-08-29 digest is
#measured("fde95f8b7452...e4eef343ed2", "web/lib/gateway-openapi-digest.generated.ts").

=== Server-sent events: `/api/stream/desk`

The desk's equity, drawdown and kill-switch status previously reached the browser
by polling every 4 to 15 seconds against a book the gateway re-marks every
second: most requests returned a number the client already had, and the ones that
mattered arrived late. The stream replaces the transport, not the meaning.

```
id: 41
event: risk
data: {"equity":998214.5,"kill_switch_active":false, ...}

: ping
```

Four protocol properties, each with a stated reason in `modules/api/risk.py`:

- *Emission is on change, not on a timer.* A tick whose serialised body is
  identical to the last sends nothing, so an idle desk costs one heartbeat every
  15 s rather than a full payload every second. The comparison is on the
  serialised body, which is what a client would have to diff anyway.
- *Every event carries a monotonic `seq`.* A reconnecting client can distinguish
  "nothing happened while I was gone" from "I missed something", and SSE's own
  `Last-Event-ID` carries it back automatically. A UI that cannot tell those
  apart will eventually show a stale number as if it were live.
- *Heartbeats are SSE comments* (`: ping`), which every `EventSource`
  implementation discards silently. They exist so an idle connection is not
  reaped by an intermediary that cannot tell a healthy quiet stream from a dead
  one.
- *The tick interval is clamped to `risk_monitor_interval_s`.* Polling the
  stream faster than the mark-to-market cadence cannot produce a newer number,
  only the same one more often.

A browser cannot open an `EventSource` to the gateway directly: the page is
HTTPS and the gateway is plain HTTP, which no browser will mix, and the Caddy
sidecar's pinned internal certificate authority does not help a browser that has
no reason to trust it. The stream therefore reaches the client through a
same-origin route handler, and the first attempt at that proxy was removed for a
protocol reason worth recording. `EventSource` exposes neither the status code
nor the body, so a deliberate 503 on a gateway-less deployment was invisible to
the client and the panel read "connecting" for ever, on precisely the deployment
where that is the normal condition. The proxy now answers *200 in every case* and
puts the state in the first frame, where a client that cannot read status codes
can still read it:

```
event: desk-state
data: {"state":"unavailable","reason":"gateway_not_configured"}
```

On `unavailable` the hook closes the source rather than letting `EventSource`
retry every three seconds, which would be a poll wearing a push's clothes. The
stream is also a *signal*, not a second source of the numbers: it carries
`RiskState` while the book polls `/api/gateway/portfolio`, a larger and different
shape, because rebuilding the panels on the stream's shape would give the same
figures two sources that can disagree.

=== The book websocket

`/ws/book/{symbol}` pushes the consolidated ladder and a live TCA report from
one shared producer for each `book:{SYMBOL}` topic. The publication interval is
#measured("300 ms", "modules/latest_state_stream.py") for the depth visualiser:

```json
{ "type": "book", "symbol": "BTCUSDT",
  "consolidated_mid": 64182.15, "venues_online": 2,
  "books": [ { "venue": "BINANCE", "bids": [[p,q]...], "asks": [[p,q]...] } ],
  "tca":   { "per_venue": [...], "consolidated": {...} },
  "heartbeat": { "source_sequence": 42,
    "freshness": { "state": "live", "age_ms": 18.4 },
    "coalesced_total": 0 } }
```

Each consumer has a size-one queue and a two-second send budget. A slow consumer
may coalesce a superseded market snapshot; the next heartbeat exposes the count.
Order, execution, rejection, kill-switch and audit events never use this feed,
because replacing current state is valid and dropping a safety fact is not.
WebSockets are never part of an OpenAPI document, so this shape is pinned by
tests rather than by the committed schema, and `modules/api/tca.py` says so
rather than leaving a reader to wonder why the contract omits it. The browser's
own order book is a separate, faster path entirely: the
page opens sockets directly to Binance and Bybit, receives 100 ms depth snapshots
and publishes to React at 5 Hz. One hop, no backend; routing that through the
gateway would make it slower rather than faster.

=== The server-side proxy boundary

`ALPHAENGINE_GATEWAY_URL` and `ALPHAENGINE_GATEWAY_TOKEN` are read in
`web/lib/gateway.ts` and nowhere in the client bundle. The workspace owns
#measured("65 same-origin route handlers, 44 importing the gateway boundary", "web/app/api/**/route.ts, counted 2026-08-29"); those 44 are the only path from a
browser to gateway credentials. The
module does four things every route would otherwise repeat: resolve the base URL,
attach the token, bound the wait, and *classify* the failure. A context-free call
uses the 8 s default. A proxy request carries a fixed H1-H5 class, sanitised
request ID, caller cancellation and remaining budget; `callGateway` always uses
the smaller of its route timeout and that remaining budget.

The classification is the part that matters. A 401 from the gateway is not a 401
from this application, and relaying it straight through would make a browser
prompt for the wrong credential entirely. So upstream statuses are translated
into this application's own vocabulary — `gateway_not_configured`,
`gateway_misconfigured`, `gateway_auth_failed`, `gateway_unreachable`,
`gateway_timeout`, `gateway_rejected`, `gateway_invalid_payload` — each carrying
the status this application should answer with alongside the upstream status it
saw, so the caller always learns which side failed.

URL resolution is a four-state typed function rather than a nullable string,
because the three ways a URL can be wrong are three different statements:

$ "gatewayState" : "Env" -> {"url"(u), "absent", "invalid"(r), "loopback"(r)} $

`absent` means this is a demo deployment and the honest degraded path may run;
`invalid` and `loopback` mean an operator set a value that can never work and
must be told so rather than have it dressed up as an outage. `loopback` is in the
taxonomy because it shipped once: a serverless function fetching `127.0.0.1`
fetches *itself*, and the mistake spent a day reading as a gateway outage rather
than a configuration error.

== Circuit breaker and failover state machines

=== The drawdown breaker

Let $D$ be the daily drawdown as a fraction of start-of-day equity and
$L = "MAX_DAILY_DRAWDOWN_PCT" = 0.05$ its limit
(#measured("config.py", "Part2_Infrastructure/config.py")). The monitor loop runs
every #measured("1 s", "config.py, risk_monitor_interval_s"), reduced from 5 s
because every step is arithmetic over an in-memory book, so the faster tick costs
almost nothing and the breaker reacts four seconds sooner.

```
                 D >= 0.80 L                D >= L
   [ NORMAL ] ───────────────> [ WARNED ] ─────────> [ HALTED ]
       ^                           │                     │
       └───────────────────────────┘                     │
                 D < 0.70 L                     operator release,
                                                with a stated reason
   Reduce-only rides alongside:  D/L >= 0.80  or  operator override
       risk-increasing orders refused, risk-reducing orders still pass
```

Three thresholds and one asymmetry. The kill switch trips at $D >= L$ with actor
`circuit-breaker` and no human in the loop. The warning is *edge-triggered with
hysteresis*: it fires at $D >= 0.8 L$ and rearms only below $0.7 L$, because
alerting on every tick spent above 80 % of the limit was roughly 720 Telegram
messages an hour at the old 5 s cadence and the tick is now 1 s. A warning that
repeats every second is not a warning; it is why the next real one goes unread.
With $w_t in {0,1}$ the warned state,

$ w_t = cases(1 &"if" D_t >= 0.8 L, 0 &"if" D_t < 0.7 L, w_(t-1) &"otherwise") $

which is a Schmitt trigger with a 10 % of budget dead band, the same shape the
venue watchdog uses.

Between warning and halt sits a graduated regime. At
$D \/ L >= "REDUCE_ONLY_THRESHOLD" = 0.80$, or under an operator override, the
desk goes reduce-only: risk-increasing orders are refused while risk-reducing
ones still pass. `config.py` records the reasoning as the practice of letting a
desk close out of trouble but not deeper into it; setting the threshold to 1.0
restores the all-or-nothing behaviour.

Three details of the trip are handled explicitly. `trigger_kill` cancels the
working book *before* it alerts, because the alert says "all new orders are now
rejected" and with resting orders alive that sentence is false: a halt that does
not reach the resting orders is not a halt. The release records *why*, since
"resumed after the feed recovered" and "resumed because the desk wanted to keep
trading" are the two answers a post-incident review must tell apart, and the
halt's own reason is carried onto the resume as `tripped_by` so the pair reads as
one incident. And the session rollover, which runs first on every tick, sits in
its own exception guard: a propagating durable-write failure would skip the
drawdown check, and because a failed roll deliberately leaves `session_date` on
yesterday it would skip it again on every tick, for ever. Measuring against an
un-rolled baseline is stale in the conservative direction, because that baseline
still holds whatever the desk lost, so the breaker can only trip sooner than it
should. Fail-closed on the boundary is right; fail-closed on the breaker is
not.

=== The venue feed watchdog and synthetic failover

Classification is per venue, on a 5 s tick, and produces four states with a human
reason attached (`modules/tca_engine/supervision.py`):

$ "state"(v) = cases(
  "down" &"if not connected, or connected with no book",
  "stale" &"if every symbol's book is stale",
  "degraded" &"if some but not all are stale",
  "up" &"otherwise") $

with staleness at `VENUE_STALE_AFTER_S = 10 s`. Only *transitions* are recorded,
so a venue that stays down does not re-alert; and the first observation of a
venue is treated as a baseline rather than an incident, which is what stops a
restart from paging on startup order. Severity follows the destination state:
`info` on recovery, `warning` on degraded, `critical` on stale or down, each
written to `risk_events` with actor `feed-watchdog` and the previous state in the
payload.

```
   all venues dark for one 5 s tick
   ────────────────────────────────> enable SIM (synthetic book)
   [ LIVE ] <──────────────────────── [ SYNTHETIC ]
              any venue live again
```

Failover to the synthetic book engages only when *every* real venue is dark, is
gated on `ALLOW_SYNTHETIC_BOOK`, and every payload it produces is tagged
`synthetic: true` — including the `synthetic` column on `tca_snapshots`, so a
snapshot taken during a blackout can never later be mistaken for market data.
The health check is wrapped in its own guard above the failover, because
observability must never be the reason the failover stops running.

The reconnect state machine underneath is exponential backoff with jitter. With
base $b = 1 s$ and ceiling $c = 30 s$,

$ d_0 = b, quad d_(n+1) = min(2 d_n, c), quad "sleep"_n = d_n + U(0, 0.3 d_n) $

and a clean exit resets $d$ to $b$. The jitter term is what stops every symbol's
socket from reconnecting in the same instant after a shared outage.

=== The order rate limiter

`TokenBucket` is a classic bucket at
#measured("5 orders/s sustained with a burst of 10", "config.py") and the choice
is argued rather than assumed: a fixed window lets twice the limit through across
a boundary, which is precisely the pattern that triggers exchange bans. It also
keeps a 256-entry deque of consume timestamps purely for observability, so
`observed_rate` reports what actually happened rather than what the configuration
permits. The consume *mutates*, so it must run exactly once per decision and
therefore stays in Python outside the compiled core.

== The telemetry planes, and what each may claim

The house rule that most shapes every surface is that a figure never appears
under another plane's label. A tile that puts a nanosecond figure under a
microsecond label is the defect, not a rounding choice.

#table(
  columns: (auto, auto, 1fr, auto),
  [Plane], [Unit], [What is timed], [Measured],
  [Whole risk decision], [µs], [`submit()` under the lock, gates to verdict], [12.4 µs p50 native, 23.1 µs Python],
  [Compiled core], [ns], [the C++ arithmetic battery inside `decide()`], [83 ns p50 dev Mac, 320 ns production VM],
  [Network], [ms], [data age in, order transit out], [69.1 ms in, 72.7 ms out (Binance)],
)

All three columns are read from `docs/architecture/LATENCY_BUDGET.md`, whose
table regenerates from `tools/bench_decision.py` (5 000 orders after 500 warm-up,
two venues, arm64, Python 3.12.14, median of nine runs). The production figures
were read off the live `/metrics` on 2026-08-17 from a `VM.Standard3.Flex`, 2
OCPU of a shared Xeon 8358; the two machines' numbers are published side by side
and never merged, because the Mac number is what the code can do and the VM
number is what the deployment does.

Three instrument-design decisions follow from what these planes are for.

*Never a mean.* The decision histogram reports p50, p99, p99.9, p99.99 and max.
The mean of a latency distribution is the one statistic that reliably hides the
thing being measured.

*Never a sliding window.* `modules/metrics/decision_latency.py` is a log-linear
histogram over the whole life of the process, at eight linear sub-buckets per
power of two from 1 µs to about 1 s, or roughly 12 % bucket resolution. A
200-sample ring cannot express p99.9 at all: the 99.9th percentile of 200 samples
is the maximum wearing a decimal point. Every sample is counted for ever, because
"we had a 4 ms decision last night" is exactly the fact a window is designed to
forget. Memory is bounded regardless of volume because counts are stored per
bucket, and the record path allocates nothing: `bisect_left` over a preallocated
edge list, and an increment that reuses CPython's small-integer cache. A recorder
that allocates is measuring its own garbage.

*Never a fabricated zero.* In `modules/metrics/exposition.py`, `_num` returns
`None` for an absent reading and the writer skips the line entirely rather than
emitting a zero, since a fabricated zero is indistinguishable from a measured one
and poisons every average downstream. The complementary rule is that a metric
whose value is genuinely zero is still emitted: `alphaengine_jobs{status="failed"}`
exists at 0 before the first failure, because "the kill switch metric
disappeared" must not read as "the kill switch is fine". The two rules together
are the whole exposition policy — *absent is absent, zero is zero*, and they are
different series.

The bucket resolution is deliberately coarse for the same reason: reporting p99.9
to four significant figures out of a process sharing a core with two feed
handlers would be inventing precision the measurement does not have. The core row
makes this concrete. `steady_clock` on the development machine advances in
41.677 ns steps, so 83 ns *is* two ticks and 125 ns *is* three; the figure with
the resolution is not the p99 but the fraction of calls inside two ticks, which
nine runs at $n = 5000$ put at
#measured("0.9932 to 0.9976", "docs/architecture/LATENCY_BUDGET.md").

=== A second plane the same discipline governs: the research bulkhead

The re-rank stage runs in the same process as the pre-trade risk checks, and the
number that bounds it was set by measurement rather than by intuition.
`tools/bench_rerank.py` against real `BAAI/bge-reranker-base` weights on an
18-core arm64 machine, median of seven runs, twenty pairs:

#table(
  columns: (1fr, auto, auto),
  [Input], [Wall clock], [CPU],
  [short rows, about 200 characters], [#measured("197 ms", "modules/research_stages.py")], [1 776 ms],
  [at `MAX_DOCUMENT_CHARS` = 2 000], [#measured("1 523 ms", "modules/research_stages.py")], [12 573 ms],
)

The CPU column divided by the wall column is the finding: `asyncio.to_thread`
occupies exactly one thread, and onnxruntime's intra-op pool then spreads that
single re-rank across about nine of the eighteen cores, so a bulkhead counting
*workers* was bounding the wrong resource entirely. Measured directly, two
simultaneous re-ranks took 307 ms against 199 ms for one on short rows and
2 122 ms against 1 456 ms at the ceiling — a second slot buys 1.30 to 1.37 times
the throughput at 1.46 to 1.54 times the latency on every request, and double the
CPU claim against the plane that may not wait. The semaphore is therefore *one*.
A `wait_for` timeout stays rejected because `to_thread` cannot cancel the thread:
a timeout at 1.5 s would release the waiting request while the abandoned one
still owned nine cores.

The same discipline sets the generation budgets. Text generation is bounded at
`TIMEOUT_MS = 20 000`; multimodal generation is bounded separately at
`VISION_TIMEOUT_MS = 45 000`, from
#measured("two live multimodal calls of 20.6 s and 29.9 s", "modules/research_generate_vision.py"),
because a timeout that fires on healthy calls trains people to retry and doubles
the spend for the same answer.

== Generated-gate contracts and CI topology

=== The generated artefacts and their gates

Eight files in the tree are generated, and each one exists because the same fact
was previously written by hand in two places and drifted. Each is paired with its
generator and either a drift gate or an explicit evidence boundary.

#table(
  columns: (1fr, 1fr, 1.1fr),
  [Artefact], [Generator], [Verification or evidence contract],
  [`web/lib/gateway-openapi-digest.generated.ts`], [`tools/export_openapi.py`], [`prebuild` re-hashes canonical `tools/openapi.json`; the web build refuses to ship against a contract it has not seen],
  [`web/lib/test-counts.generated.ts`], [`scripts/refresh-test-counts.mjs`], [`check-test-counts.mjs`, run one step *outside* the suite against the runner's own summary line],
  [`web/lib/repository-manifest.generated.json`], [`generate-codebase-manifest.mjs`], [`--check` in `prebuild`],
  [`web/lib/gateway-contract.generated.ts`], [`generate-gateway-client.ts`], [typecheck: a route the gateway removed stops compiling],
  [`web/lib/mc-parity-reference.generated.ts`], [`generate-mc-parity.ts`], [the Monte Carlo parity suite],
  [`supabase/apply_all.generated.sql`], [`tools/bundle_migrations.py`, at the repository root], [`tests/test_migration_bundle.py` fails when the bundle is behind `supabase/migrations/`; the fix is to regenerate it, never to edit the SQL],
  [`docs/architecture/latency-bench.generated.json`], [`tools/bench_decision.py`], [regenerated, never edited; the block stamps its own UTC date],
  [`Part2_Infrastructure/docs/native-latency.generated.json`], [`tools/bench_native_boundary.py`], [`tests/test_native_latency_benchmark.py` pins nearest-rank and release-criterion evaluation; the operability document preserves the measurement boundary and reproduction command],
)

At this revision the repository manifest records
#measured("2 422 paths", "web/lib/repository-manifest.generated.json, verified 2026-09-02"),
and the source audit found #measured("42 ordered migrations present in the worktree and generated bundle", "supabase/migrations/*.sql and supabase/apply_all.generated.sql"). The newest RFQ-membership successor provisions every existing and future authenticated account for the fixed paper-only desk while leaving anonymous guests denied. Combined schema workflow run `33653417165` applied and verified all 42 migrations plus Oracle on 2026-09-03. Deployment run `33652700698` then completed every OCI gate; the earlier E2E run `33633746350` passed all 16 production checks, including Neo4j readback. These are dated deployment observations rather than timeless runtime-health claims.

The test count is the one figure in the repository that *cannot* be asserted
from inside the thing it measures, since a test that checks the total changes the
total. It is therefore generated, checked from outside, and is a measurement with
a date rather than a contract. As of
#measured("2026-09-02", "web/lib/test-counts.generated.ts") the dated generated figures
are gateway #measured("3 492 total, 3 491 passed, 1 skipped", "web/lib/test-counts.generated.ts"),
web #measured("6 846 tests across 1 461 suites", "web/lib/test-counts.generated.ts")
and service #measured("24", "web/lib/test-counts.generated.ts"). The skip cause
belongs to the runner output for that dated run, not to an inference from the
total. These figures are a dated snapshot, not a timeless invariant: never
quote a count from a document, including this one, as proof of a later run. Run
the suite, or read the freshly generated file.

A second contract of the same kind pins the two implementations of the pre-trade
gates against each other. `web/tests/fixtures/gate-parity.json` holds
#measured("20 bit-exact scenarios", "web/tests/fixtures/gate-parity.json") at
`version: 1` — among them `concentration_breach`, `gross_breach`, `price_band`,
`slippage_breach`, `slippage_partial`, `rate_limited`, `kill_switch_on`,
`symbol_halted`, `working_book_full`, `duplicate_client_id`, the two paper-equity
paths and the two reduce-only directions. Each carries the books, the token-bucket
state (`tokens`, `rate`, `burst`), a frozen clock, and the *entire* expected check
vector with every gate's `limit`, `observed` and `passed`. Freezing the clock and
the bucket is what makes it reproducible: a rate-limit scenario whose bucket
refilled between runs would be a flaky test dressed as a parity test. For the C++
core the tolerance is zero, and the fixture is what caught two silent-wrongness
bugs — CPython's compensated `sum()` against a plain C++ fold, and FMA
contraction fusing a multiply-add one unit in the last place off even under
`-ffp-contract=off` until pinned with `#pragma STDC FP_CONTRACT OFF`.

=== Six workflows, and what each is allowed to prove

#table(
  columns: (auto, auto, 1fr),
  [Workflow], [Trigger], [What it proves],
  [`ci.yml`], [push, PR, dispatch], [the code is correct, offline],
  [`deploy.yml`], [push to main], [the gateway image builds, ships, swaps and verifies, or rolls back],
  [`e2e.yml`], [dispatch, twice daily], [everything deployed as it is right now still works together],
  [`schema.yml`], [dispatch only], [committed DDL applied to Oracle and Supabase],
  [`oracle-keepalive.yml`], [schedule], [an Always Free database stops itself after 7 idle days and is reclaimed after about 90; only a session resets that timer],
  [`openbb-keepalive.yml`], [schedule], [a Vercel function stays warm 5 to 15 minutes, and a cold OpenBB import lands in the desk's upstream tail as a genuine multi-second sample],
)

The separation between the first three is the argument. `ci.yml` is network-free
by design so that *a red build means the code broke, never that a service was
slow*. `e2e.yml` is the opposite job and contacts the live gateway, the live
Vercel deployment and the live databases, answering the one question no offline
suite can. It is manual and scheduled and never on push, because a venue outage
or an idle database is not a reason to block a code change. The justification for
its existence is empirical: every deployment failure this repository has actually
had passed the full offline suite first — a directory excluded from the upload,
an image that pushed but never swapped, a database that requires a wallet, an
environment file truncated to five variables. `schema.yml` is manual for a
different reason: DDL that rides a code deploy is how a table gets altered by
someone who was shipping a stylesheet change.

`ci.yml` runs four always-on jobs. *Gateway*: build the native extension (a
missing core is a red build, never a silent fall-back to Python), `ruff` over the
whole tree, `pytest`, `export_openapi.py --check`, and `tools/synthetic_probe.py`
as a smoke over the money path from book to cost to risk gate to audit. *OpenBB
service*: its own `pytest`. *Web*: `npm ci`, the suite piped through `tee` under
`set -o pipefail` — mandatory, because GitHub's default bash does not set it and
`tee` alone would mask a red suite behind its own exit zero — then the
committed-count check, `tsc --noEmit`, and a production build, because a
type-safe component can still fail during route analysis, metadata generation or
bundling and CI must exercise the artefact Vercel will deploy. *Repository
audit*: `check_repo_complete.sh`, which exports `HEAD` with `git archive` to
catch a file that builds locally only because a `.gitignore` pattern silently
matched it.

=== Network-free by construction

Offline is arranged, not hoped for. `tests/conftest.py` sets the environment
*before* `config` is imported, precisely so it wins over a local `.env`, since
python-dotenv does not override a variable that already exists. The interesting
part is that two different mechanisms are used and they encode two different
policies.

#table(
  columns: (auto, 1fr, 1fr),
  [Mechanism], [Variables], [Policy],
  [`os.environ.setdefault`], [`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEO4J_URI`, `NEO4J_PASSWORD`, `DB_PATH`, `ENABLE_MARKET_DATA`], [consent: an exported variable survives, so a documented opt-in stays possible],
  [`os.environ[...] = ""`], [`GEMINI_API_KEY`, `RERANK_MODEL_PATH`], [refusal: an exported variable is overwritten, so nothing can leak in],
)

The difference is the whole claim. `setdefault` only wins over a `.env`; an
*exported* variable is already in `os.environ` and reaches `settings` untouched.
`tests/test_research_answer.py` drives the real `/api/research/rag/ask` route and
patches neither the settings nor the SDK — it relies on that one assignment — so
under `setdefault` a shell exporting a real key would spend a live model call per
test while the file said it could not happen. The conftest records that this was
*measured*, not deduced. `RERANK_MODEL_PATH` is assigned for the second half of
the rule, so a seeded fastembed cache cannot make the "no model downloaded" tests
load about 110 million parameters off a directory nobody mentioned.

=== The two deliberate opt-ins, and what they name when they skip

The skip line is a report, not noise. Each of the two suites that can skip states
in full what it did *not* exercise.

+ *Live Postgres.* `tests/test_data_ops_postgrest.py::TestAgainstTheRealProject`
  skips unless `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
  `SUPABASE_DESK_ID` are exported. Its
  message says CI is network-free by design, so a green suite there has *not*
  reached Postgres. `live-smoke` in `ci.yml` is the dispatch-only counterpart:
  it sends a `HEAD` to PostgREST and treats 401 or 403 as the pass, because
  deny-by-default RLS means anon can read nothing and *a 200 there is the bug*.
+ *Seeded re-ranker weights.* `tests/test_research_rerank_real.py` skips unless
  `RERANK_TEST_MODEL_PATH` is set, naming that no cross-encoder weights were
  offered and the real ONNX path was not exercised. The `rerank-real` job is its
  counterpart, and is a separate job rather than a step in `gateway` for a
  measured reason: `BAAI/bge-reranker-base`'s fp32 ONNX blob is
  #measured("1 112 459 588 bytes, about 22 s to fetch cold", ".github/workflows/ci.yml"),
  and hanging a gigabyte off the job that gates every push would slow the default
  red-green for everyone in exchange for an extra a normal deployment does not
  configure.

Two assertions inside that job are worth transcribing, because they are what
stops an opt-in from proving nothing. The suite runs with `HF_HUB_OFFLINE=1`,
which is the assertion rather than a precaution: "no network at request time once
the model directory is seeded" is the entire argument for choosing local ONNX
over a hosted re-rank API, and running with the hub switched off is what turns
that sentence into a test. And the job greps its own output for `skipped` and
fails if it finds one, because a suite that skipped would leave the job green
having proved nothing. *Count the skips, not the passes.* A mirrored step then
runs the same files with the opt-in unset on a runner where the weights are
sitting on disk and asserts that exactly one skip occurs, which is how the
default suite is held weight-free.

A missing native core, by contrast, is a *failure* and never a skip:
`tests/test_decision_core_native.py` treats an unimportable `modules/_decision_core`
as a red build unless `DECISION_CORE=python` was set deliberately, because a
quiet fall-back to the Python reference is exactly what CI exists to catch. The
deploy job applies the same rule to the running container, refusing to keep one
that fell back when native was built for it.

#note("What this chapter does not claim")[
  Three absences are load-bearing and are named rather than glossed. There is no
  hardware timestamping and no PTP source on a cloud VM, so every latency figure
  here is in-process: it excludes the kernel network stack, the driver and the
  wire, and is a *floor* on the real latency rather than the real latency. The
  gateway remains single-process, and moving the data-operations tables to
  Postgres does not change that. And a green CI run has, by construction, not
  reached Supabase, Neo4j, Oracle, a venue or a model provider — which is the
  property that makes it trustworthy as a statement about the code, and useless
  as a statement about the deployment. `e2e.yml` exists because those are
  different questions.
]
