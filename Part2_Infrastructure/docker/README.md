# Docker — the always-on gateway

**Last verified: 2026-09-02.** The image/compose contract was checked against
the current single-process application-context architecture. Live host and TLS
claims keep the dates of their last external probe; see
[`../../docs/CURRENT_STATE.md`](../../docs/CURRENT_STATE.md).

One container, one process, host port 8000. The compose file lives at the
repository root; this directory holds the image definition.

```bash
# from the repository root
docker compose up -d --build
docker compose ps                                   # wait for (healthy)
curl -fsS http://127.0.0.1:8000/health | head -c 200
docker compose exec gateway python tools/synthetic_probe.py \
  --url http://127.0.0.1:8000                       # money path, against PID 1
```

`--url` is not optional here, and the reason is the next section: the probe's
default mode boots a **second** in-process gateway, which on the same data
volume is now refused rather than tolerated. With `--url` it drives the running
one over HTTP, which is what an operator wanted to check anyway. Add
`--token $WEB_API_TOKEN` when `REQUIRE_AUTH=1`.

Secrets arrive only through `Part2_Infrastructure/.env` (copy
`.env.example`); the committed files contain none and
`tests/test_container_contract.py` keeps it that way.

The image is two stages: the builder installs `requirements-native.txt` and
compiles the C++ decision core (`native/decision_core/`), and the runtime
stage copies the resulting `modules/_decision_core*.so` across — so the
container decides on the compiled engine while carrying no compiler.
`/health` reports `decision_engine` and the deploy workflow warns if a build
came up on the Python fallback.

## Verifying the volume actually persists

Ask the **running process**, not a second one. DuckDB is single-writer, and a
`docker compose exec … python -c "get_audit()"` opens a second process against
the file PID 1 has locked.

**What that used to do, and what it does now.** It used to fall back *silently*
to a SQLite sibling at a different path and report on the wrong store — verified,
that is exactly what it did, and `/health` said `backend: sqlite` to nobody in
particular. Two guards closed that, and both fail loudly instead:

* `modules/single_writer.py` takes a `flock(2)` on `$DATA_DIR/gateway.writer.lock`
  in `RiskGateway.start()` and holds it for the life of the process. A second
  gateway on the same volume — `--workers 4`, `docker compose up --scale
  gateway=2`, a second container on the same named volume — raises
  `SingleWriterConflict` and never reaches the part of startup where it would
  accept orders against a book the first one is also mutating. An observed
  conflict is proof and so it raises; a filesystem that cannot do advisory locks
  at all is not evidence of anything, so that logs and continues, and `status()`
  reports which of the two happened so "unenforced" is visible rather than
  assumed. It does **not** make the gateway multi-process; nothing here shares a
  book. What changed is only the failure mode.
* `modules/audit/store.py` raises `AuditLedgerConflict` when DuckDB reports a
  lock conflict, where a bare `except Exception` used to route it into the
  SQLite fallback. That fallback still exists for the one case it was written
  for — DuckDB genuinely not importable — so `backend` keeps meaning what it
  says: `"sqlite"` only when SQLite is genuinely what is underneath.

The gateway's own API reads the real log:

```bash
docker compose restart gateway && sleep 5
curl -fsS -H "X-AlphaEngine-Token: $WEB_API_TOKEN" \
  http://127.0.0.1:8000/api/audit/stats
# expect: backend "duckdb" and counts that survive the restart —
# each boot appends a gateway_start risk event
```

(The same applies to `tools/synthetic_probe.py` run via `exec` **without**
`--url`: its default mode boots the app in process, which now trips the same
claim and refuses rather than writing a divergent ledger beside the real one.
Use `--url http://127.0.0.1:8000` from inside the container, as the quick-start
block above does. The in-process mode remains the right one on a developer
machine and in CI, where nothing else holds the volume.)

## Deploying to the Oracle Cloud instance (or any Docker host)

Full walkthrough in the main README §11 ("Oracle Cloud — the public origin
Vercel can reach"). The short form: verify shape/region/public IP → open
ingress in **both** the VCN security list and the OS firewall → clone, write
`.env`, `docker compose up -d --build` → Caddy in front for HTTPS → set Vercel
`ALPHAENGINE_GATEWAY_URL=https://<host>` + the matching token and redeploy.

Design rationale (single process, core requirements, named volume, non-root,
stdlib health probe) is written as comments inside `gateway.Dockerfile` and
`docker-compose.yml` — the files are the documentation of record.
