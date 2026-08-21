# The data-operations backend

Four tables hold the state the gateway must not forget across a restart:
`data_quality_findings`, `data_quality_escalations`, `data_schedule_runs` and
`data_work_items`. `DATA_OPS_BACKEND` decides where they live.

| | `sqlite` (default) | `postgres` |
|---|---|---|
| Storage | one file on the mounted data volume | Supabase, over PostgREST |
| Needs | nothing | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, migrations applied |
| Id allocation | `MAX(...) + 1` in a transaction | a real sequence, via `next_work_item_id` |
| Versioned edit | `BEGIN IMMEDIATE` then `WHERE version=?` | `PATCH ?id=eq.X&version=eq.N` |
| Aggregates | `GROUP BY` in the query | `data_quality_rollup`, one round trip |

## What this changes, and what it does not

It removes the **storage** half of the single-container boundary. Those four
tables stop being local to one filesystem, so a redeploy or a second container
reads the same rows.

It does **not** make a second gateway process possible. The position book, the
resting-order book, the token bucket and the kill switch are process-local
mutable state, and `tests/test_container_contract.py` fails the build on
`--workers` or `gunicorn` with the reason inline: *"a second worker forks the
in-memory book and localises the kill switch."* That boundary is a design
decision with a test behind it, not an oversight.

## Turning it on

1. Apply the migrations. Either paste `supabase/apply_all.generated.sql` into
   the Supabase SQL editor, or `supabase link --project-ref <ref> && supabase db push`.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Set `DATA_OPS_BACKEND=postgres`.

Step 2 is not optional and is not defaulted: selecting `postgres` without
credentials raises at startup rather than falling back to SQLite. A fall-back
would leave a deployment reporting one backend and using another, and the
`backend` field on `DataQualityView` and `WorkItemsResponse` would say
`sqlite` while somebody believed otherwise.

An unknown value — `DATA_OPS_BACKEND=postgress` — is refused for the same
reason.

## Verifying it

`backend` is on the wire, typed `"sqlite" | "postgres"`, and is read off the
store rather than written as a literal:

```bash
curl -s $GATEWAY/api/data-quality/view  | jq .backend
curl -s $GATEWAY/api/data/work-items    | jq .backend
```

## What the tests do and do not prove

`tests/test_data_ops_postgrest.py` asserts the **request** this store builds —
the `Prefer` headers, the filter grammar, the conflict target — against
`httpx.MockTransport`. That is where the SQLite-to-PostgREST translation lives,
and a test that only checked the parsed response would pass with `Prefer`
missing entirely.

The live pass is `TestAgainstTheRealProject` and it **skips with its reason
printed** unless `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are in the
environment. CI is network-free by design, so a green suite there has not
reached Postgres, and it says so rather than implying otherwise.

`tests/test_data_quality_rollup.py` pins `_AGGREGATE` in Python and
`data_quality_rollup` in SQL to the same six figures. If one moves without the
other, both backends answer, neither errors, and they disagree — which is why
they are pinned rather than trusted.
