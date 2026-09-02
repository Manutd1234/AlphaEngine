# Splitting a file in this codebase

**Last verified: 2026-09-02.** Paths and examples below were checked after the
Telegram, metrics and application-lifecycle package splits.

Two ratchets hold the ceiling — `tests/test_file_size.py` and
`web/tests/file-size.test.ts`. Both are allow-lists that may shrink and must
not grow. Neither can catch the rule below, which is why it is written here.

## A moved method's function-scope import stays function-scope

The Python import graph is acyclic **only because the cycles were already
pushed into function bodies.** The Telegram implementation now lives under
`modules/telegram/`; its mixins retain function-scope imports into portfolio,
risk, operations and data-ops modules. `modules/metrics/render.py` and
`modules/metrics/runtime.py` likewise import lifecycle-owned services inside
their functions.

The natural instinct when moving a method into a new file is to hoist its local
import to the top of that file. Do that once — for `_latency_rows`, say, which
does `from modules import metrics` inside the method — and you create
`telegram/* → metrics → telegram` at module scope, and the gateway fails to
boot with `ImportError: cannot import name 'get_bot' from partially initialized
module`.

No lint rule catches this. `ruff`'s `I001` sorts imports; it does not know
which ones may be hoisted. The rule is: **if it was inside a function, it stays
inside a function.**

The two modules with zero `modules.*` edges in either direction —
`quant_risk.py` and `audit.py` — are the only ones that can be split with no
import-order risk at all.

## Things that break on a file move, and are not obvious

- **`monkeypatch.setattr(telegram_module.httpx, ...)`** patches the reference
  held by *that specific module*. Move `_post` to a new file and the patch
  silently stops applying — the test then either hits the real network or
  passes vacuously.
- **`tests/test_supabase_schema.py`** harvests risk-gate names by regexing the
  raw text of `modules/risk_proxy.py` for `add("...")`. `RiskGateway.submit`
  cannot leave that literal file.
- **`docker/gateway.Dockerfile`** copies root modules BY NAME
  (`COPY main.py config.py celery_tasks.py worker.py ./`). Splitting `main.py`
  into a root package ships an image missing its routes, and no test catches
  it — it fails at runtime.
- **`web/tests/api-catalogue.test.ts`** enumerates `app/api/**/route.ts` by
  filename. Logic may move out of a route handler; the `export async function
  GET` may not.
- **`workspace-routing.test.ts`** asserts `app/dashboard/page.tsx` and
  `components/DeveloperConsole.tsx` exist BY PATH. They may shrink; they may
  not move.
- **Occurrence counts inside one file**: `TEST_COUNTS.generatedOn` ≥2 in
  `DeveloperConsole.tsx`, `DRIFT_PROMPT` ≥3 in `PortfolioWorkspace.tsx`,
  `Inspect data health →` exactly 1 in `page.tsx`. Any extraction moves these,
  and each needs rewriting deliberately rather than mechanically.
- **New web files stay inside `app/`, `components/`, `lib/`, `tests/`,
  `scripts/`.** A new top-level directory escapes six recursive-scan tests,
  breaks `dead-css`'s [18, 24] window, and falls through `areaForPath()` into
  the wrong Developer-console area.

## Every commit

`npm run catalog:refresh` — the `prebuild` manifest gate fails the build on any
path change, so a batch of twenty commits with one refresh at the end is
nineteen commits that cannot build. `npm run counts:refresh` whenever a test is
added or removed.
