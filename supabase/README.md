# Supabase — Postgres mirror + pgvector research index

**Source/worktree audited: 2026-09-02.** The 41 ordered migrations and generated
bundle were audited against the current gateway architecture. Schema workflow
run `33633200876` also applied and verified all migrations, both edge functions
and the RLS denial boundary in the live project. Volatile repository counts are centralised in
[`../docs/CURRENT_STATE.md`](../docs/CURRENT_STATE.md).

DuckDB in the gateway is **authoritative**; everything here is a durable
mirror and a research index. The gateway keeps trading when this is absent.

## Apply the schema

```bash
supabase link --project-ref umwnjwhwemvvygtdkcxr
supabase db push          # applies migrations/ in filename order
supabase db lint
psql "$SUPABASE_DB_URL" -f seed.sql   # or paste seed.sql in the SQL editor
supabase functions deploy embed-research
```

Connection gotchas (verified): the direct host `db.<ref>.supabase.co:5432`
resolves to an **AAAA record only** — on an IPv4-only network use the session
pooler string from the dashboard (`aws-1-<region>.pooler.supabase.com`, user
`postgres.<ref>`). Percent-encode special characters in the password. The
password is shell-only; the gateway itself talks to PostgREST over HTTPS with
the service-role key and never holds the Postgres connection string.

## What is in here

The worktree contains forty-one migrations, and the generated bundle contains
the same set. The schema workflow applies them in filename order; run
`33633200876` confirmed their live application on 2026-09-02. Together they define 19
application tables, grouped by ownership rather than presented as one flat database:

| Plane | Tables | Why Postgres owns them |
|---|---|---|
| Decision mirror | `order_blotter`, `desk_risk_limits` | Durable, contextual mirror of gateway decisions; `order_blotter` is append-only and records `decided_by`. |
| Account state | `user_preferences`, `telegram_link` | Per-user state that must survive a browser/device. Guest Telegram bindings remain gateway-owned because they have no `auth.users` row. |
| Research corpus and graph | `research_documents`, `research_edges`, `research_chart_images` | Tenant-scoped pgvector, graph and image-embedding materialisations that DuckDB does not provide to the browser tier. |
| ML lineage | `ml_runs`, `ml_folds`, `ml_features`, `ml_artefacts` | Immutable run/fold/feature/artefact custody used to compare experiments without inventing provenance. |
| Data operations | `data_quality_findings`, `data_quality_escalations`, `data_schedule_runs`, `data_work_items` | Durable quality, escalation, schedule and work-queue state consumed by the Data workspace. |
| Diffusion research | `diffusion_events`, `diffusion_runs`, `diffusion_texts`, `diffusion_studies` | Point-in-time events and texts, absorption runs and study results behind the dedicated Diffusion workspace. |

The Diffusion successor migration mirrors all four SQLite ledgers, including
late `vote_line`/`skill_*` fields and desk-qualified natural keys. The shared
PostgREST store stamps and filters the configured desk on every read and write;
the scope guard refuses ambiguous legacy `desk_id='default'` rows instead of
silently hiding them, locks out legacy writers during the transition, and
installs constraints that reject the sentinel afterward. These are current-worktree and generated-bundle
contracts. The live project has them because schema run `33633200876`
succeeded; a different project does not gain them until the manual schema
workflow below succeeds.

Migration `20260831131000_research_chunk_replace.sql` adds the transactional
RAG chunk-replacement RPC: upsert the current chunk set and delete stale sibling
chunks in one database transaction. `modules/research_rag/replacement.py`
prepares the full physical set first; if any text embedding is pending, the RPC
keeps the proposed generation non-retrievable and retains the previous complete
generation. Apply this migration before deploying the new chunked ingest path.
It is present in the migration directory and generated bundle and was verified
applied to the live project by schema run `33633200876`.

Two edge functions: `embed-research` (writes the vectors) and
`evaluate-order` (the labelled sandbox gate behind `submit_alphaengine_order`).

Applying the schema is a manual workflow — Actions → **Apply database schema**,
`target: supabase`. It is deliberately not part of the code deploy: DDL that
rides a code deploy is how a table gets altered by someone shipping a CSS
change. Re-running is safe; `supabase db push` skips migrations already
recorded.

## What the schema deliberately does differently

- `order_blotter.decided_by` (`gateway` | `supabase_rpc`) — provenance on
  every row. `submit_alphaengine_order` is a labelled two-gate **sandbox**;
  the seventeen-gate decision is the Python gateway's alone.
- `latency_ms` is the measured decision latency, never a constant.
- RLS is deny-by-default with explicit `REVOKE`s. The sole anonymous table
  policy is a read-only, row-filtered demo view of `order_blotter`; no anonymous
  insert, update, delete, research, ML, data-ops or diffusion access is granted.
- `order_blotter` is append-only by trigger.
- Every `SECURITY DEFINER` function pins `search_path`.

`Part2_Infrastructure/tests/test_supabase_schema.py` asserts all of the above
from the committed SQL, offline, including that the SQL limit defaults equal
`config.py`'s — change either side alone and the suite goes red.
