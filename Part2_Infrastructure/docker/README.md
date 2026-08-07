# Docker — the always-on gateway

One container, one process, host port 8000. The compose file lives at the
repository root; this directory holds the image definition.

```bash
# from the repository root
docker compose up -d --build
docker compose ps                                   # wait for (healthy)
curl -fsS http://127.0.0.1:8000/health | head -c 200
docker compose exec gateway python tools/synthetic_probe.py   # money path
```

Secrets arrive only through `Part2_Infrastructure/.env` (copy
`.env.example`); the committed files contain none and
`tests/test_container_contract.py` keeps it that way.

## Verifying the volume actually persists

Ask the **running process**, not a second one. DuckDB is single-writer: a
`docker compose exec … python -c "get_audit()"` opens a second process against
the file PID 1 has locked, silently falls back to the SQLite sibling, and
reports on the wrong store (verified — that is exactly what it did). The
gateway's own API reads the real log:

```bash
docker compose restart gateway && sleep 5
curl -fsS -H "X-AlphaEngine-Token: $WEB_API_TOKEN" \
  http://127.0.0.1:8000/api/audit/stats
# expect: backend "duckdb" and counts that survive the restart —
# each boot appends a gateway_start risk event
```

(The same caveat applies to `tools/synthetic_probe.py` run via `exec`: its
gate maths and rejection path are real, but its audit write lands in the
SQLite sibling while the gateway holds the DuckDB lock.)

## Deploying to the Oracle Cloud instance (or any Docker host)

Full walkthrough in the main README §11 ("Oracle Cloud — the public origin
Vercel can reach"). The short form: verify shape/region/public IP → open
ingress in **both** the VCN security list and the OS firewall → clone, write
`.env`, `docker compose up -d --build` → Caddy in front for HTTPS → set Vercel
`ALPHAENGINE_GATEWAY_URL=https://<host>` + the matching token and redeploy.

Design rationale (single process, core requirements, named volume, non-root,
stdlib health probe) is written as comments inside `gateway.Dockerfile` and
`docker-compose.yml` — the files are the documentation of record.
