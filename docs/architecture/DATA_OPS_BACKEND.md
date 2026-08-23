# The data-operations backend

*Checked against the tree on 24 August 2026. Every claim below names the module
or migration that makes it checkable; where a figure could not be re-measured
offline, it says so rather than being restated.*

Four tables hold the state the gateway must not forget across a restart:
`data_quality_findings`, `data_quality_escalations`, `data_schedule_runs` and
`data_work_items`. `DATA_OPS_BACKEND` decides where they live.

| | `sqlite` (default) | `postgres` |
|---|---|---|
| Storage | one file on the mounted data volume | Supabase, over PostgREST |
| Owner | [`modules/data_ops_store.py`](../../Part2_Infrastructure/modules/data_ops_store.py) — `SqliteStore` | [`modules/data_ops_postgrest.py`](../../Part2_Infrastructure/modules/data_ops_postgrest.py) — `PostgrestStore` |
| Needs | nothing | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, migrations applied |
| Id allocation | `MAX(...) + 1` inside a transaction, plus a counter table | a real sequence, via the `next_work_item_id` RPC |
| Versioned edit | `BEGIN IMMEDIATE` then `WHERE version=?` | `PATCH ?id=eq.X&version=eq.N` |
| Aggregates | `GROUP BY` in the query | the `data_quality_rollup` RPC, one round trip |

There is a **fifth** table, and it exists on one side only:
`data_work_item_ids` (`modules/work_items.py:122`) is a `prefix → n` counter
that SQLite needs because it has no sequences. `_next_id` explains why it is not
just `MAX + 1`: the floor is the highest id still in the table, the counter is
the highest ever minted, and a delete lowers the first without lowering the
second — so an id a deleted row carried stays retired and an audit line naming
it keeps naming one thing. Postgres gets that property from the sequence for
free, which is why the counter table has no Postgres migration.

## The factory, and the bug that produced it

`modules/data_ops_backend.py` opens with the reason it exists, and it is worth
repeating because it is the failure this whole page guards against: the factory
used to live in `data_ops_store.py`, the config field existed, the tests passed
— and `grep -rn open_data_ops_store modules/ main.py` returned nothing but the
definition. Every production site constructed `SqliteStore` directly through the
`str` path argument, so **`DATA_OPS_BACKEND=postgres` selected a backend nothing
ever asked for**, and a commit message claimed the setting had "stopped being
inert" while it was still inert everywhere it mattered.

Three things came out of that, and each is held by a test in
[`tests/test_data_ops_backend.py`](../../Part2_Infrastructure/tests/test_data_ops_backend.py):

```mermaid
flowchart TD
    CFG["config.settings.data_ops_backend<br/>DATA_OPS_BACKEND, default 'sqlite'"]
    CFG --> FACTORY["open_data_ops_store()<br/>data_ops_backend.py"]
    FACTORY -->|"'sqlite'"| SQL["SqliteStore(data_ops_db_path)"]
    FACTORY -->|"'postgres' + credentials"| PG["PostgrestStore(url, key)"]
    FACTORY -->|"'postgres', no credentials"| RAISE["ValueError — refuses to fall back"]
    FACTORY -->|"anything else"| RAISE2["ValueError — refuses to default"]
    SQL --> PROTO{{"DataOpsStore Protocol<br/>migrate · fetch · fetch_one · add<br/>patch · remove · count · close"}}
    PG --> PROTO
    PROTO --> CACHE["get_data_ops_store()<br/>one per process, behind _build_lock"]
    CACHE --> USERS["work_items · data_quality · schedule_runs · data_scheduler"]
```

- **A Protocol, not a base class.** The two stores share no implementation — one
  wraps a `sqlite3` connection, the other an `httpx.Client` — so a common
  ancestor would be either an empty ABC or a place for one backend's assumptions
  to leak into the other. What they share is a shape.
  `test_both_backends_satisfy_the_declared_protocol` checks both structurally,
  so a method added to one and forgotten on the other fails in CI rather than on
  whichever deployment opted in. The raw-SQL helpers on `SqliteStore` are
  deliberately **absent** from the Protocol: they are the SQLite-only escape
  hatch for the quality ledger's aggregates, and declaring them would announce
  an interface PostgREST cannot honour.
- **One store per process.** `get_data_ops_store()` caches, because four call
  sites want it and under Postgres each construction is an `httpx.Client` with
  its own pool — `data_scheduler._record_outcome` built a fresh store on *every
  job completion* and dropped it. `test_the_store_is_shared_rather_than_rebuilt`
  and `test_each_singleton_builds_through_the_configured_backend` hold it.
- **The build is serialised.** `_build_lock` exists because two threads that
  both find `_shared` unbuilt each construct a store, and two first-opens of one
  SQLite file at the same instant is a race SQLite answers with `database is
  locked` rather than waiting out. Double-checked locking, so the fast path
  costs one read.

## Why this state is not in the audit log

The audit log is DuckDB and its write helpers are **fire-and-forget by design**:
`_exec` swallows a failed write and `query` returns `[]`, because a lost TCA
snapshot must never take the order path down with it. `data_ops_store.py`'s
header states the corollary — that is the right contract for evidence and the
wrong one for *a work item a person just edited or a quality finding another
instance is about to read*. Those need a write that **raises** when it fails and
an UPDATE that reports whether it hit a row. Two stores, two failure contracts,
neither borrowed from the other.

Two SQLite constants carry measurements rather than defaults, and both are
argued in place:

- **`BUSY_TIMEOUT_S = 30.0`** (`PRAGMA busy_timeout=30000`). Python's default is
  five, and that was a CI flake: `PRAGMA journal_mode=WAL` is the first
  statement on every fresh connection and has to read the file; a WAL reader
  never waits for a WAL writer, but it does wait for the EXCLUSIVE lock the last
  connection takes as it closes to checkpoint the WAL — and on a loaded runner
  that checkpoint outlasted five seconds.
- **`_OPEN_LOCK`, one open at a time process-wide.** The busy timeout covers a
  lock another connection *holds*. It does not cover two connections in one
  process opening the same file at the same instant: measured on a fresh file
  with six threads released by a barrier, **2 of 240 opens failed at once** with
  `database is locked`, in 0.00 s, the busy handler never consulted.

## What the backend switch changes, and what it does not

It removes the **storage** half of the single-container boundary. Those four
tables stop being local to one filesystem, so a redeploy or a second container
reads the same rows.

It does **not** make a second gateway process possible. The position book, the
resting-order book, the token bucket and the kill switch are process-local
mutable state, and
[`tests/test_container_contract.py`](../../Part2_Infrastructure/tests/test_container_contract.py)
fails the build on `--workers` or `gunicorn` with the reason inline: *"a second
worker forks the in-memory book and localises the kill switch."* That boundary
is a design decision with a test behind it, not an oversight.

## Turning it on

1. Apply the migrations. Either paste
   [`supabase/apply_all.generated.sql`](../../supabase/apply_all.generated.sql)
   into the Supabase SQL editor, or
   `supabase link --project-ref <ref> && supabase db push`. The seven that
   matter here are `20260820100000_data_quality_findings.sql`,
   `…100100_data_quality_escalations.sql`, `…100200_data_schedule_runs.sql`,
   `…100300_data_work_items.sql` (which also creates `next_work_item_id`),
   `…100400_data_quality_rollup.sql`, `…100500_data_quality_provider_stats.sql`
   and `…100600_data_ops_grants.sql`.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Set `DATA_OPS_BACKEND=postgres`.

Step 2 is not optional and is not defaulted: selecting `postgres` without
credentials **raises at startup rather than falling back to SQLite**. A
fall-back would leave a deployment reporting one backend and using another, and
the `backend` field on `DataQualityView` and `WorkItemsResponse` would say
`sqlite` while somebody believed otherwise — a field nobody reads twice.

An unknown value — `DATA_OPS_BACKEND=postgress` — is refused for the same
reason, rather than defaulted to `sqlite`.

**The grants migration is part of the set, not an extra.**
`20260820100600_data_ops_grants.sql` revokes `execute` on
`data_quality_rollup` and `data_quality_provider_stats` from `public`, `anon`
and `authenticated` — they answered for anyone holding the anon key — and does
the same for `next_work_item_id`, which is worse in kind because it is not a
read: an anonymous caller could consume the id sequence, and the migration
records that two calls made while probing the project's schema did exactly
that. Its third section re-seeds the sequences, but **only on an empty table** —
`create sequence if not exists` cannot correct one that already exists, so a
burned number stays burned.

## Verifying it

`backend` is on the wire, typed `Literal["sqlite", "postgres"]` on both
`DataQualityView` (`modules/data_quality_models.py:114`) and `WorkItemsResponse`
(`modules/work_items.py:83`), and is read off the store rather than written as a
literal:

```bash
curl -s $GATEWAY/api/data-quality/view  | jq .backend
curl -s $GATEWAY/api/data/work-items    | jq .backend
```

Both models declare **every** field as required, for the reason
`DataQualityView`'s docstring gives: a response field with a default publishes
itself as optional in the OpenAPI contract, and a generated client would then
hedge against an absence that cannot happen.

Do not confuse this `backend` with the one on `DataJobAccepted` and
`DataJobsResponse` (`modules/schemas_data.py:51,65`). Those name the **job
queue's** executor — in-process or Celery — and are a different plane with a
different vocabulary. Same word, two questions.

## Every read is desk-scoped, and the caller does not say so

`PostgrestStore` stamps `desk_id` on inserts and filters every read by it
without the caller asking — `test_every_read_is_desk_scoped_without_the_caller_saying_so`
and `test_insert_stamps_the_desk_and_asks_for_nothing_back_by_default` pin that.
The same predicate is inside the aggregate: `test_the_rollup_is_scoped_by_desk`
reads `20260820100400_data_quality_rollup.sql` for `desk_id = p_desk_id`,
because an unscoped rollup would aggregate every desk's findings into one desk's
panel. `SUPABASE_DESK_ID` defaults to
`00000000-0000-0000-0000-000000000001` (`config.py:139`).

## What the tests do and do not prove

[`tests/test_data_ops_postgrest.py`](../../Part2_Infrastructure/tests/test_data_ops_postgrest.py)
asserts the **request** this store builds — the `Prefer` headers, the filter
grammar, the conflict target — against `httpx.MockTransport`. That is where the
SQLite-to-PostgREST translation lives, and a test that only checked the parsed
response would pass with `Prefer` missing entirely. Ten of the file's eleven
tests are that shape and they run everywhere, offline, with no credentials: six
on the request it builds (`TestTheRequestItBuilds`) and four on how it refuses
(`TestItRefusesQuietly` — a 4xx raises rather than reading as no rows, the error
text never carries the key or the URL, a non-JSON 2xx raises rather than
returning nothing, and `migrate` issues no DDL).

The live pass is **one test**, `TestAgainstTheRealProject::test_the_four_tables_are_reachable`,
and it **skips with its reason printed** unless `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are in the environment. Export both — one variable
per command, never `set -a && . ./.env`, for the reason
[`TESTING.md`](../testing/TESTING.md) gives — and the file reads eleven passed
instead of ten passed and one skipped. CI is network-free by design, so a green
suite there has not reached Postgres, and it says so rather than implying
otherwise.

*(An earlier version of this page said the live pass "runs eleven tests green".
It does not: eleven is the whole file, ten of which never needed Postgres. The
skip is a single test.)*

[`tests/test_data_quality_rollup.py`](../../Part2_Infrastructure/tests/test_data_quality_rollup.py)
pins `_AGGREGATE` in Python and `data_quality_rollup` in SQL to the same six
figures — `evaluated`, `passed`, `fatal`, `warn`, `drift`, `not_evaluated`
(`data_quality_read.py::_counts`). If one moves without the other, both backends
answer, neither errors, and they disagree about how many checks a provider
failed. It is the same shape as the gate-parity fixtures — mirrored maths,
asserted to stay mirrored — one level cheaper, because it compares **column
names** rather than results. Comparing results needs a live Postgres, which
network-free CI does not have. The file also guards its own reader: it asserts
that query text was recovered at all, so a scan that found nothing cannot read
as a clean bill of health.

## Not built, and named rather than hidden

- **No live-Postgres result comparison in CI.** The rollup pair is pinned by
  column name only, for the reason above. Closing it needs a Postgres in the
  job, which is a different piece of work from a different budget.
- **No migration for `data_work_item_ids`.** It is deliberately SQLite-only; the
  Postgres side uses a sequence. A migration would create a table nothing reads.
- **The read path's SQL helpers are not in the Protocol**, so the quality
  ledger's aggregate path is genuinely two implementations rather than one
  interface with two drivers. That is why `test_data_quality_rollup.py` exists
  at all.

*Related: [`DATA_PROCESSING_FLOW.md`](DATA_PROCESSING_FLOW.md) for where these
tables sit in the data plane; [`TESTING.md`](../testing/TESTING.md) for the
opt-in skip and the trap that turns it into eighty 401s;
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the single-writer boundary this page
only half-removes.*
