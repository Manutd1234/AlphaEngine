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
