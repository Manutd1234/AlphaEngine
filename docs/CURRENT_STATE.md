# AlphaEngine current-state ledger

**Source/worktree and deployment evidence audited: 2026-09-04.** This page is the short, reproducible
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
| Repository catalogue | 2,432 paths | `web/lib/repository-manifest.generated.json`; `cd Part2_Infrastructure/web && npm run build` prebuild check |

The gateway is a single application context: one lifespan-owned service graph
provides the risk gateway, audit/data stores, background jobs, latest-state
stream and Telegram runtime. HTTP handlers are adapters over those services;
they do not create a second trading state. The web workspace reads server-side
facades and same-origin route handlers, then preserves missing, loading,
degraded and measured-zero states as different facts. The OpenBB service is a
separately deployable, read-only research adapter and owns no trading state.

## Live prediction-market coverage

- Broad discovery is opt-in through `COHERENCE_LIVE_FAMILIES=1..200`. The
  current browser route requests 200, and the gateway caps the effective value
  at both the configured limit and Kalshi's bounded event-page maximum. One
  nested open-event read discovers the families; order books are hydrated in
  chunks of 100 with at most three concurrent bulk reads. A failed depth chunk
  retains the same live listing's top of book with an explicit qualification
  instead of dropping the family.
- The active Markets and Proofs reads poll every 20 seconds. The lifespan-owned
  warm loop uses the same cadence for the configured universe, while the
  append-only recorder uses `COHERENCE_POLL_S` and remains deliberately off
  when that setting is zero. A displayed observation carries its age, and a
  timeout, venue refusal or stale cache is not relabelled live.
- Numeric strike ladders produce survival, mass and moment summaries. Named
  mutually exclusive outcomes produce live categorical probability bars and
  deliberately withhold a numeric mean; unrelated YES/NO markets produce an
  `independent` surface and withhold a joint total. Those are mathematical
  shape distinctions, not failed data reads.
- Proofs no longer calls an otherwise healthy family “untestable” merely
  because Kalshi supplies no cross-market relation. The fallback `book` family
  certifies three executable constraints per quoted market: ask at least zero,
  bid at most one and non-negative ask/bid spread. Structural families still
  use their stronger joint linear programme.
- The signed RFQ route distinguishes authentication policy, an empty successful
  response and quotes-in-hand. HTTP 429/5xx responses receive one bounded
  200-millisecond retry; a persistent 503 remains an upstream venue outage and
  is reported as such rather than converted into demo data.

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

The repository-owned count generator was run locally on 2026-09-04. The CI
figures below retain their own earlier run date:

| Suite | Result |
|---|---:|
| Gateway | Local generated record: 3,507 passed, 1 skipped (3,508 total). Main CI shape before the RFQ provisioning successor: 3,482 passed, 3 skipped; the separate real-model job ran 8 cases with 0 skips |
| Web | 6,856 tests across 1,464 suites - 6,850 passed, 6 skipped, 0 failed |
| OpenBB service | 24 passed |
| Rendered layout | 360 passed, 0 failed - all 120 addressable states at 320×844, 390×844 and 1280×900 on 2026-09-04; the earlier 872/872 eight-viewport release record remains dated 2026-08-29 |

The generated display contract is
`Part2_Infrastructure/web/lib/test-counts.generated.ts`. The web production
build also passed on 2026-09-04: its prebuild verified the canonical OpenAPI
digest `fde95f8b7452b6b9a04c06db5a3c99b645e07fdf4202a3b7e3b77e4eef343ed2`
and the 2,432-path repository catalogue before Next.js compiled and generated
all static pages.

CI run `33652700677` completed all seven jobs successfully with zero
annotations: gateway, native ASan/UBSan, OpenBB, web test/typecheck/build,
committed-tree audit, live Oracle/Supabase services and the real cross-encoder.
On `main`, the last two are required results rather than grey skips. Pull
requests deliberately omit live services and run the real-model job only when
labelled `rerank`.

The 2026-09-04 Playwright sweep ran against the integrated local desk and
gateway. It reported zero geometry failures and zero console errors across all
120 registered states at the three requested phone/desktop viewports. One guest
RFQ 401 was an expected access-policy read, not a console failure or a failed
public-data route. The local browser sweep remains a separate qualification
tool because it needs a running desk and Chromium; it does not replace the
earlier eight-viewport release record or silently widen this run beyond its
three measured sizes.

## Measurement boundary

No latency figure is made current merely by appearing in a current document.
The native-core qualification was measured on 2026-08-28 and remains recorded
in `Part2_Infrastructure/docs/NATIVE_LATENCY_OPERABILITY.md`. Venue RTT and
production gateway readings retain their own 2026-08-17 through 2026-08-20
dates in `docs/architecture/LATENCY_BUDGET.md`. External TLS and deployment
state were re-probed on 2026-09-02 by the named deployment and E2E runs above;
later claims must name a later probe.

## Documentation release rule

Documentation carrying **Source/worktree audited: 2026-09-04** was checked
against this tree. A dated example, migration filename, benchmark or incident
inside such a document remains historical. Generated artefacts must be
refreshed through their owning commands rather than edited by hand.
