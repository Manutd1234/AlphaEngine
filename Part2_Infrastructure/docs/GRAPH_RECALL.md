# Graph recall — walking the research graph from a terminal

`tools/graph_recall.py` answers the question hybrid search cannot:

> every run sharing this data_hash that later tripped the breaker

Retrieval ranks documents by resemblance. That question is not about
resemblance — it is a relation between documents, and a fused similarity score
has no way to express one. The sweep and the incident it preceded read nothing
alike; no keyword and no embedding puts them next to each other.

The tool is a reader. It writes nothing, it is invoked by a person, and nothing
in `modules/` or `main.py` imports it.

## What it reads

| Object | Where it comes from | What it gives |
| --- | --- | --- |
| `research_edges` | migration `20260820090400`; rows written by `modules/research_graph.persist_edges` | the link table: `src_id`, `dst_id`, `relation`, `evidence` |
| `traverse_research_graph` | migration `20260820090500` | a recursive CTE, depth capped at 4, refusing revisits, carrying `depth`, `arrived_by`, `evidence` and `path` |
| `research_documents` | migration `20260808120400` and later | the rows an edge points at |

Edges are derived from STRUCTURED columns — symbol, interval, strategy,
`data_hash`, kind, and regime off the metrics — with no LLM in the ingest path.
That is what makes a traversal replayable: the same corpus produces the same
graph next month, and a graph whose edges change when nobody changed anything
is a graph nobody can reason from.

## Entry points

Each is a query the schema can actually serve. The round-trip count is what the
tool costs per invocation.

| Flag | Question | Round trips |
| --- | --- | --- |
| `--from-run <id\|source_ref>` | what is this run linked to, and by what relation | 2: resolve the document, then the traversal RPC |
| `--data-hash <hash>` | every run over the same bars, and what followed each | 3: the runs, their `followed_by`/`promoted_to` edges, then the far ends of those edges |
| `--incident <order-id>` | what led to this incident | 2: an incident's `source_ref` **is** its order id, so this resolves it with `kind=eq.risk_incident` and walks back |
| `--symbol <sym>` / `--strategy <name>` | which documents exist here, and how connected each one is | 2: the documents, then one edge read counted locally |

Modifiers: `--depth N` (the CTE caps it at 4 whatever you ask for), `--relation`
(repeatable, restricted to the enum the migration declares), `--limit`,
`--json`, `--narrate`.

**Flags that are deliberately absent.** `--interval` and `--kind` are not entry
points because `research_graph._LINKABLE` excludes them: every 4h document
matching every other 4h document is a candidate set with no discriminating
power, so no edge is ever written for them and the flag would be a lie in the
help text. Regime is not an entry point either — it lives inside the `metrics`
JSON rather than in a column, and is absent on most rows — but `same_regime`
edges do exist, and `--from-run <id> --relation same_regime` traverses them.

## Three states, and none of them collapse

`● ok` — the graph was walked. The rows may be empty, which means *connected to
nothing*, and the note says so. That is an answer.

`▲ partial` — the primary read succeeded and a secondary one did not. The rows
are real; the field that could not be read is `None`, printed as `—`, with the
reason above it. Never `0`, never `[]`.

`✕ unavailable` — the query could not be made. The reason names the cause, and
the row list is empty **because there is no answer**, not because the corpus
holds nothing:

```
GRAPH RECALL  every run over data_hash 9f2c1a77, and what followed each
✕ unavailable  0 rows
  reason: Supabase is not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY unset.
  The graph could not be read, which is not the same fact as a graph that holds nothing.
```

This is the repository's sharpest recorded defect, in its own shape: `list_runs`
once turned a PostgREST failure into an empty list, and the panel above it read
"reachable, holds no runs". Unconfigured must never look like empty.

Exit status: `0` answered, `1` answered in part, `2` could not be asked. A
narration that did not happen never changes it.

## What it looks like

```
$ graph_recall.py --data-hash 9f2c1a77

GRAPH RECALL  every run over data_hash 9f2c1a77, and what followed each
● ok  2 rows
  2 runs over the same bars. A row with a followed_by incident is a run that later tripped
  the breaker; results that disagree over one data_hash disagree about method, not data.

  ●  backtest_run  job-4412  BTCUSDT  ma_cross  2026-08-12T09:14:00Z
    Sweep: MA crossover BTCUSDT 4h
    → followed_by  on BTCUSDT  risk_incident  ord-88ab  Breaker: daily drawdown
  ●  ml_run  run-77  BTCUSDT  gbdt  2026-08-13T11:00:00Z
    Fitted: GBDT BTCUSDT 4h
    → nothing downstream in the graph
```

`→ nothing downstream in the graph` and `→ — what followed could not be read`
are different lines because they are different facts.

A traversal carries the relation that reached each row, so the output can say
*shares a data hash* rather than *is related*:

```
$ graph_recall.py --from-run job-4412 --depth 2

  ●  depth 1  via same_data  on 9f2c1a77
    ml_run  run-77  BTCUSDT  gbdt  2026-08-13T11:00:00Z
    Fitted: GBDT BTCUSDT 4h
  ●  depth 1  via followed_by  on BTCUSDT
    risk_incident  ord-88ab  BTCUSDT  —  2026-08-12T18:02:00Z
    Breaker: daily drawdown
```

The `—` under `strategy` is an incident, which has none. A dash is a value the
corpus does not hold; it is never rendered as zero.

## The narrator, and its boundary

`--narrate` pipes the finished rows to the `claude` CLI for a prose summary of
how they connect. Four rules hold it in place.

1. **The traversal runs first and is completely deterministic.** Its output is
   the answer and is fully usable with no Claude present.
2. **Shelling out is the only integration.** No Anthropic SDK in
   `requirements-core.txt`, no npm dependency, no API key read by this process
   and none passed on a command line — argv lands in the process table and the
   shell history. The prompt goes over stdin; `claude` manages its own auth.
   The tool's only argument to it is `-p`, which the test asserts.
3. **An absent or failing narrator is reported, never skipped.** Each case
   names its cause and the rows print anyway:

   ```
   ✕ NARRATION NOT AVAILABLE  the `claude` CLI is not on PATH, so nothing narrated
   this result. The rows above are the complete answer and did not need it.

   ✕ NARRATION NOT AVAILABLE  `claude` exited 3: not logged in. The rows above stand.

   ✕ NARRATION NOT AVAILABLE  `claude` exited 0 and printed nothing. The rows above stand.
   ```

   A fourth case is a skip rather than a failure, and it is still reported: when
   the traversal returned no rows — because the read failed, or because the
   corpus genuinely holds nothing — `claude` is not invoked at all, and the line
   says so. Prose over an empty result would describe nothing, and prose over a
   failed read would describe a corpus that was never consulted.

4. **A narration never replaces its evidence.** It is printed after the rows,
   under a header that says what it is — *Claude, over the N rows above. Prose
   about those rows, not a retrieval and not evidence; the rows are the answer.*
   A summary that replaces the rows is how a reproducible desk stops being one.

`--narrate` is never required for a scriptable answer: `--json` emits
`state`, `reason`, `rows`, `row_count`, `notes` and a `narration` object that is
`null` when no narrator was asked for.

## Running it

```sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
    venv/bin/python tools/graph_recall.py --data-hash 9f2c1a77 --narrate
```

Credentials come from the environment only. There is no `--key` flag and there
will not be one. `requirements-recall.txt` is the optional extra — it pins one
package, `httpx`, which `requirements-core.txt` already has, and exists so the
tool runs from a minimal environment.

## Why this is not in the gateway

A `claude` invocation is non-deterministic and unbounded in latency. Putting one
in a request path would contradict the argument the rest of the codebase makes:
two implementations pinned against each other, fixtures replayed byte for byte,
an append-only audit log. `tests/test_graph_recall.py` holds the line with a
source scan — no file under `modules/` and not `main.py` may mention
`graph_recall`, and none may invoke `"claude"`.

The suite also checks the parts that are easy to fake and expensive to get
wrong: the traversal runs against an `httpx.MockTransport` that filters on
`desk_id`, projects to the selected columns and rejects any RPC argument the
migration does not declare — the argument names are read out of the migration
file, so the fake cannot drift from the schema. The narrator paths run real
processes on a real PATH: one that exits 3, one that prints nothing, one that
answers and records what arrived on stdin and in argv.
