# Supabase — Postgres mirror + pgvector research index

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

Sixteen migrations, applied in filename order. Five tables, and the reason each
one exists on this side rather than in DuckDB:

| Object | Why it is here |
|---|---|
| `order_blotter` | The durable mirror of the audit log. Append-only by trigger; `decided_by` records which side decided. |
| `desk_risk_limits` | The limits a mirrored decision was judged against, so a historical row can be re-read in its own context. |
| `research_documents` | pgvector index. DuckDB has no vector type, so this is the one capability the mirror adds rather than duplicates. |
| `user_preferences` | Theme, detail level and last-open tab, per account. Browser state that should survive a new device. |
| `telegram_link` | Binds a Telegram chat to a signed-in desk identity. `user_id` is a foreign key onto `auth.users`, which is why a **guest** binding cannot live here and is held by the gateway alone. |

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
- RLS deny-by-default: zero `anon` policies, explicit `REVOKE`.
- `order_blotter` is append-only by trigger.
- Every `SECURITY DEFINER` function pins `search_path`.

`Part2_Infrastructure/tests/test_supabase_schema.py` asserts all of the above
from the committed SQL, offline, including that the SQL limit defaults equal
`config.py`'s — change either side alone and the suite goes red.
