# AlphaEngine current-state ledger

**Source/worktree and deployment evidence audited: 2026-09-03.** This page is the short, reproducible
release record for facts that change as the repository changes. Historical benchmark,
incident, deployment-probe and ADR dates elsewhere in the documentation remain
attached to the day they were actually observed; they are not silently
restamped to this source-audit date. External claims below name the workflow run
that observed them; source facts are still reproducible from the tree.

## Repository and runtime topology

| Fact | Current value | Reproduction source |
|---|---:|---|
| Deployable units | 3 | Next.js workspace, FastAPI gateway, stateless OpenBB service |
| Workspace tabs | 11 | `Part2_Infrastructure/web/lib/workspace-nav.ts` |
| Addressable rail sections | 70 | Section arrays in `Part2_Infrastructure/web/lib/sections.ts`, excluding the derived `ENGINE_SECTIONS` concatenation |
| Quant-engine views | 71 | Markets 26, Proofs 29, Diffusion 16 from `Part2_Infrastructure/web/lib/section-views.ts` |
| Addressable non-default view cells | 50 | Derived and asserted by `Part2_Infrastructure/web/scripts/desk-sweep-plan.mjs` |
| Gateway OpenAPI | 76 paths, 79 HTTP operations | `Part2_Infrastructure/tools/openapi.json` |
| Web route handlers | 65 | `find Part2_Infrastructure/web/app/api -name route.ts` |
| Local developer default | `npm run dev` supervises gateway `:8000` and workspace `:3000`; `npm run dev:web` is frontend-only | `Part2_Infrastructure/web/package.json`; `scripts/start-dev-all.mjs` |
| Supabase migrations | 42 present, bundled and applied to the live project | `supabase/migrations/*.sql`; `supabase/apply_all.generated.sql`; combined Oracle/Supabase schema run `33653417165` |
| Telegram commands | 138 total, 100 in the pushed menu, 6 guarded controls | `Part2_Infrastructure/modules/telegram/registry.py`; `tools/telegram_catalogue.py --check` |
| Repository catalogue | 2,424 paths | `web/lib/repository-manifest.generated.json`; `cd Part2_Infrastructure/web && npm run build` prebuild check |

The gateway is a single application context: one lifespan-owned service graph
provides the risk gateway, audit/data stores, background jobs, latest-state
stream and Telegram runtime. HTTP handlers are adapters over those services;
they do not create a second trading state. The web workspace reads server-side
facades and same-origin route handlers, then preserves missing, loading,
degraded and measured-zero states as different facts. The OpenBB service is a
separately deployable, read-only research adapter and owns no trading state.

## Current deployment boundaries

- SQLite remains the complete zero-configuration default for the eight logical
  data-operations and Diffusion tables. The PostgREST path has schema parity for
  all eight: migration `20260831120000` adds the Diffusion relations and fields,
  `PostgrestStore.count()` projects the shared `desk_id`, and
  `open_data_ops_store()` requires and passes an explicit `SUPABASE_DESK_ID`.
  Migration `20260831121000` refuses ambiguous legacy `desk_id='default'` rows,
  removes unsafe defaults and installs constraints that reject the sentinel.
  Workflow `schema.yml` run `33653417165` applied and verified the complete
  Oracle and Supabase schema, deployed the edge functions and proved the anon
  denial boundary. Missing live relations still fail honestly rather than
  falling back.
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
  generation remains in place. The RPC migration is present in the live schema
  verified by run `33653417165`.
- Migration `20260902090000` removes email-specific RFQ provisioning: it
  backfills the fixed desk's active `PAPER_ONLY` membership from every existing
  `auth.users.id` and installs an after-insert trigger for future accounts.
  Anonymous guests remain denied, authenticated users can read only their own
  limits row, and browsers still cannot write memberships. Combined schema run
  `33653417165` applied it; an independent aggregate service-role read then
  found 3 Auth users, 3 active RFQ members, 0 missing and 0 orphan memberships.
- The optional Neo4j projection/read model is configured in the live deployment.
  E2E run `33633746350` read back 15 documents, 48 edges and 2 communities from
  sweep `deploy-33633139022-1`. It is still not desk-isolated:
  projected nodes and the community/centrality Cypher reads do not carry
  `desk_id`. The source read-model guard therefore refuses Neo4j whenever
  `RESEARCH_SCOPE_TO_DESK=1`; both reports automatically fall back to the
  desk-scoped Postgres corpus path. With the flag off, use Neo4j only for a
  single desk or an isolated database. A corpus result while desk scoping is on
  is therefore the intended safety fallback, not evidence that Aura is down.

Deployment run `33633139022` restored and verified the complete Diffusion
ledger in Supabase before the OCI cutover: 62 events, 248 runs, 62 texts and 4
studies for dataset `fomc-issuer-evidence-2019-01-30--2026-07-29-v2`. Gateway
readiness then reported 14 assessable findings and the 57-meeting scored study
`prior:guidance:d10:s7`. E2E run `33633746350` subsequently passed all 16 live
checks: production gateway health/auth, Vercel reachability and proxying,
Oracle, Supabase RLS, the decision mirror and Neo4j readback.

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

The repository-owned count generator and main-branch CI were run on 2026-09-02:

| Suite | Result |
|---|---:|
| Gateway | Local generated record: 3,495 passed, 1 skipped (3,496 total). Main CI shape before the RFQ provisioning successor: 3,482 passed, 3 skipped; the separate real-model job ran 8 cases with 0 skips |
| Web | 6,846 tests across 1,461 suites - 6,840 passed, 6 skipped, 0 failed |
| OpenBB service | 24 passed |
| Rendered layout | 872 passed, 0 failed - 109 addressable states at 8 responsive viewports |

The generated display contract is
`Part2_Infrastructure/web/lib/test-counts.generated.ts`. The web production
build also passed on 2026-09-02: its prebuild verified the canonical OpenAPI
digest `6f50ebed6ccc76c0bc733d18ca9e8f86d8d2789f3092526076e727dba0282321`
and the 2,424-path repository catalogue before Next.js compiled and generated
all static pages.

CI run `33652700677` completed all seven jobs successfully with zero
annotations: gateway, native ASan/UBSan, OpenBB, web test/typecheck/build,
committed-tree audit, live Oracle/Supabase services and the real cross-encoder.
On `main`, the last two are required results rather than grey skips. Pull
requests deliberately omit live services and run the real-model job only when
labelled `rerank`.

The Playwright release sweep ran against the local webpack development server
at `127.0.0.1:3100`. It reported zero geometry failures and zero console
errors. Gateway-backed reads were intentionally recorded as typed unavailable
responses because the gateway was not part of that browser run; those 503s are
not hidden or counted as successful data reads.

The local browser sweep remains a separate qualification tool because it needs
a running desk and Chromium. Its last full rendered-layout measurement is kept
at its actual 2026-08-29 date above; the September 2 CI and live E2E evidence do
not silently restamp it.

## Measurement boundary

No latency figure is made current merely by appearing in a current document.
The native-core qualification was measured on 2026-08-28 and remains recorded
in `Part2_Infrastructure/docs/NATIVE_LATENCY_OPERABILITY.md`. Venue RTT and
production gateway readings retain their own 2026-08-17 through 2026-08-20
dates in `docs/architecture/LATENCY_BUDGET.md`. External TLS and deployment
state were re-probed on 2026-09-02 by the named deployment and E2E runs above;
later claims must name a later probe.

## Documentation release rule

Documentation carrying **Source/worktree audited: 2026-09-02** was checked
against this tree. A dated example, migration filename, benchmark or incident
inside such a document remains historical. Generated artefacts must be
refreshed through their owning commands rather than edited by hand.
