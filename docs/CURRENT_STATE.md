# AlphaEngine current-state ledger

**Source/worktree audited: 2026-08-31.** This page is the short, reproducible
release record for facts that change as the repository changes. Historical benchmark,
incident, deployment-probe and ADR dates elsewhere in the documentation remain
attached to the day they were actually observed; they are not silently
restamped to this source-audit date. It is not a fresh probe of any external
deployment.

## Repository and runtime topology

| Fact | Current value | Reproduction source |
|---|---:|---|
| Deployable units | 3 | Next.js workspace, FastAPI gateway, stateless OpenBB service |
| Workspace tabs | 11 | `Part2_Infrastructure/web/lib/workspace-nav.ts` |
| Addressable rail sections | 70 | Section arrays in `Part2_Infrastructure/web/lib/sections.ts`, excluding the derived `ENGINE_SECTIONS` concatenation |
| Quant-engine views | 64 | Markets 23, Proofs 25, Diffusion 16 from `Part2_Infrastructure/web/lib/section-views.ts` |
| Gateway OpenAPI | 76 paths, 79 HTTP operations | `Part2_Infrastructure/tools/openapi.json` |
| Web route handlers | 65 | `find Part2_Infrastructure/web/app/api -name route.ts` |
| Local developer default | `npm run dev` supervises gateway `:8000` and workspace `:3000`; `npm run dev:web` is frontend-only | `Part2_Infrastructure/web/package.json`; `scripts/start-dev-all.mjs` |
| Supabase migrations | 41 present in the worktree and generated bundle; live application not re-verified | `supabase/migrations/*.sql`; `supabase/apply_all.generated.sql` |
| Telegram commands | 138 total, 100 in the pushed menu, 6 guarded controls | `Part2_Infrastructure/modules/telegram/registry.py`; `tools/telegram_catalogue.py --check` |
| Repository catalogue | 2,283 paths | `cd Part2_Infrastructure/web && npm run build` prebuild check |

The gateway is a single application context: one lifespan-owned service graph
provides the risk gateway, audit/data stores, background jobs, latest-state
stream and Telegram runtime. HTTP handlers are adapters over those services;
they do not create a second trading state. The web workspace reads server-side
facades and same-origin route handlers, then preserves missing, loading,
degraded and measured-zero states as different facts. The OpenBB service is a
separately deployable, read-only research adapter and owns no trading state.

## Current deployment boundaries

- SQLite remains the complete default for the eight logical data-operations and
  Diffusion tables. In the current worktree, the opt-in PostgREST path has schema
  parity for all eight: migration `20260831120000` adds the missing Diffusion
  relations and fields, `PostgrestStore.count()` projects the shared `desk_id`,
  and `open_data_ops_store()` requires and passes an explicit
  `SUPABASE_DESK_ID`. Migration `20260831121000` refuses ambiguous legacy
  `desk_id='default'` rows while holding an exclusive migration lock, removes
  unsafe defaults, and installs constraints that reject the sentinel. These are worktree
  and generated-bundle facts, not proof that a live Supabase project has applied
  them; missing live relations still fail honestly rather than falling back.
- Research route scoping is a staged opt-in. Migration `20260831130000` supplies
  desk-scoped graph traversal, but `RESEARCH_SCOPE_TO_DESK` stays off by
  default. Once that migration is deployed, enabling the flag makes `/search`,
  `/ask` and `/graph/{document_id}` carry `SUPABASE_DESK_ID` through similarity
  and graph reads or refuse rather than run unscoped. With the flag off, no
  route-level desk predicate is added.
- Migration `20260831131000` supplies an atomic RAG chunk-replacement RPC so a
  re-index can upsert one complete current generation and delete stale siblings
  in one transaction. `modules/research_rag/replacement.py` prepares every
  physical chunk before that call. If any text embedding is pending, the whole
  proposed generation stays non-retrievable and the previous complete
  generation remains in place. The RPC migration must be applied before the new
  chunked ingest path is deployed. It is present and bundled; this audit did not
  verify that it has been applied to the live project.
- The optional Neo4j projection/read model is not currently desk-isolated:
  projected nodes and the community/centrality Cypher reads do not carry
  `desk_id`. The source read-model guard therefore refuses Neo4j whenever
  `RESEARCH_SCOPE_TO_DESK=1`; both reports automatically fall back to the
  desk-scoped Postgres corpus path. With the flag off, use Neo4j only for a
  single desk or an isolated database. No live Aura instance was probed in this
  audit.

None of these boundaries implies a second authoritative store. The gateway
remains single-process, Postgres owns the research graph, and SQLite remains the
zero-configuration data-operations default.

## Verified toolchain

| Component | Current repository/runtime value |
|---|---|
| Python used for the gateway verification | 3.12.14 |
| FastAPI / Pydantic / HTTPX in that environment | 0.141.1 / 2.13.4 / 0.28.1 |
| Node support declared by the workspace | `>=20.9.0 <27` |
| Next.js / React | 16.3.0 / 19.2.8 |
| Tailwind CSS | 4.3.3 |
| OpenBB service | FastAPI 0.136.3, OpenBB Core 1.6.13, OpenBB YFinance 1.6.3, YFinance 1.5.2 |

Versions above come from the active Python environment, `package-lock.json`,
and the OpenBB service's `pyproject.toml`. They describe this verification
environment and the committed lock files, not a claim that every production
host has already been upgraded.

## Test and build evidence

The repository-owned count generator was run on 2026-08-29:

| Suite | Result |
|---|---:|
| Gateway | 3,254 passed, 1 skipped - 3,255 total |
| Web | 6,519 tests across 1,408 suites - 6,513 passed, 6 skipped, 0 failed in the final full run |
| OpenBB service | 24 passed |
| Rendered layout | 872 passed, 0 failed - 109 addressable states at 8 responsive viewports |

The generated display contract is
`Part2_Infrastructure/web/lib/test-counts.generated.ts`. The web production
build also passed on 2026-08-29: its prebuild verified the canonical OpenAPI
digest `12b53e1fe2f51e399b3e133440a72dce2f13abfe8cdfc68f9b6da3ae81df96be`
and the 2,283-path repository catalogue before Next.js compiled and generated
all static pages.

The Playwright release sweep ran against the local webpack development server
at `127.0.0.1:3100`. It reported zero geometry failures and zero console
errors. Gateway-backed reads were intentionally recorded as typed unavailable
responses because the gateway was not part of that browser run; those 503s are
not hidden or counted as successful data reads.

On 2026-08-30 the two source-stability skips recorded above became passing
tests: Work Queue source promotion/backoff now uses the shared source machine,
and stale Portfolio/Risk books disable execution handoffs at the component and
handler. The 2026-08-29 full-suite totals remain historical until the next full
count refresh. A focused runtime check against the integrated local stack
returned 200 for gateway `/health` and the Next proxies
`/api/gateway/coherence/status`, `/api/gateway/diffusion/absorption`,
`/api/gateway/portfolio`, and `/api/gateway/data/work-items`; the Work Queue
response reported the SQLite backend and nine rows. `/api/data/work-items` is
the FastAPI path, not a Next.js route.

## Measurement boundary

No latency figure is made current merely by appearing in a current document.
The native-core qualification was measured on 2026-08-28 and remains recorded
in `Part2_Infrastructure/docs/NATIVE_LATENCY_OPERABILITY.md`. Venue RTT and
production gateway readings retain their own 2026-08-17 through 2026-08-20
dates in `docs/architecture/LATENCY_BUDGET.md`. External TLS and deployment
state must be re-probed before it is described as live.

## Documentation release rule

Documentation carrying **Source/worktree audited: 2026-08-31** was checked
against this tree. A dated example, migration filename, benchmark or incident
inside such a document remains historical. Generated artefacts must be
refreshed through their owning commands rather than edited by hand.
