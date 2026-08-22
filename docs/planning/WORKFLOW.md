# Development workflow

How to work on AlphaEngine without losing an hour to a trap somebody else has
already fallen into. The traps are real — each one below cost time before it
was written down. Facts here were read from the tree on 2026-08-22; where a
figure can drift, the document says where the current one lives rather than
asking you to trust this page.

Running instructions live in [`SETUP.md`](../../SETUP.md); the authoritative
deep-dives are [`Part2_Infrastructure/README.md`](../../Part2_Infrastructure/README.md)
and [`CLAUDE.md`](../../CLAUDE.md). This page is the workflow distilled: the
venv rules, the commands, the generated gates, the ratchet, and CI.

---

## 1. The virtualenv: one path, one Python

**The venv must be named `venv`, at `Part2_Infrastructure/venv`, built on
Python 3.12.** Not `.venv`, not conda, not uv, not 3.13 or 3.14. Both halves of
that sentence are load-bearing.

**The path.** `web/package.json`'s `dev:gateway` script runs
`cd .. && ./venv/bin/python`, and `web/scripts/start-dev-all.mjs` spawns
`resolve(rootDir, "venv/bin/python")` with no existence check and no `error`
handler on the child process. Any other layout produces an unhandled `ENOENT`
that looks nothing like "wrong Python path" — it looks like Node itself broke.
Never rename the venv; never add a second one.

**The version.** CI pins 3.12 because it is the only version both Python units
accept: the gateway supports 3.11–3.14, the OpenBB service declares
`>=3.12,<3.15` in `OpenBB_Service/pyproject.toml`. A 3.14 venv is worse than a
refusing one, because it *works* — one test lighter. numba has no 3.14 wheel,
so vectorbt cannot install, so `tests/test_backtester.py` skips with "vectorbt
not installed" and the summary line still reads green while the vectorbt engine
goes untested. The default `python3` on current macOS/Homebrew is 3.14, so
build explicitly:

```bash
cd Part2_Infrastructure
python3.12 -m venv venv
venv/bin/pip install -r requirements-dev.txt   # core + native toolchain + ruff + networkx
venv/bin/python native/decision_core/setup.py build_ext --inplace --build-temp build/native
```

The native build is not optional for a full run: `tests/test_decision_core_native.py`
and `tests/test_core_self_measure.py` **fail**, not skip, when
`modules/_decision_core*.so` is missing — a broken core must be a red build,
never a quiet absence. The deliberate escape hatch is `DECISION_CORE=python`,
set on purpose, not arrived at by forgetting the build step.

## 2. Count the skips, not the passes

The suite's health is read off the *skip* count, because the pass count stays
plausible under several failure modes. On a correct 3.12 venv the gateway suite
is **1,717 passed and exactly one skipped** (the figure the tree carries, in
[`web/lib/test-counts.generated.ts`](../../Part2_Infrastructure/web/lib/test-counts.generated.ts),
generated 2026-08-21 — re-run the suite rather than trusting either file; the
counts in prose have drifted before, which is why that file is generated).

- **The one expected skip** is `tests/test_data_ops_postgrest.py`, and it is a
  feature: it reports honestly that no `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  was in the environment, so the Postgres backend never ran. Absence reported,
  not papered over.
- **A second skip is the alarm.** It means the venv is the wrong Python and the
  vectorbt engine is silently untested (see above).
- **Zero skips** would mean Supabase credentials leaked into the test
  environment — also worth investigating, not celebrating.

## 3. Running everything

All from `Part2_Infrastructure` unless stated; web commands from
`Part2_Infrastructure/web`.

| What | Command | Notes |
|---|---|---|
| Gateway tests | `venv/bin/python -m pytest` | 102 `test_*.py` suites (`ls`, 2026-08-22), deterministic, no network |
| Web tests | `npm test` | `node --test` via tsx; 3,883 tests across 838 suites as generated on 2026-08-22 |
| Service tests | `cd OpenBB_Service && python -m pytest` | own `pyproject.toml`, 14 tests |
| Typecheck | `npm run typecheck` | `tsc --noEmit`, strict |
| Lint | `venv/bin/python -m ruff check .` | configured in `pyproject.toml`; installed only by `requirements-dev.txt` |
| Money-path probe | `venv/bin/python tools/synthetic_probe.py` | book → cost → gate → audit, exits non-zero on any break |
| Both dev servers | `npm run dev:all` | gateway `:8000`, portal `:3000` |

**`npm run lint` does not exist.** `web/package.json` has exactly `dev`,
`dev:gateway`, `dev:all`, `prebuild`, `build`, `catalog:refresh`, `start`,
`typecheck`, `test` and `counts:refresh`. Running `npm run lint` fails as a
*missing script*, not a broken linter — there is no ESLint in the project at
all (no dependency, no config), a deliberate consequence of the no-new-npm-deps
rule. Linting is Python-side only, and the two conventions ESLint would have
held (file length, dead CSS) are held instead by tests
(`web/tests/file-size.test.ts`, `dead-css.test.ts`).

The repo's `/verify` skill runs all of the above and reports the measured
numbers; use it before claiming anything works. Never quote a test count from
memory or from a README — run the suite and read the runner's own final line.

## 4. The four generated gates

Four files in `web/lib/` are generated, committed, and then *checked* against
their source of truth by a build step or a test. The pattern is deliberate:
regeneration is a reviewable act in a diff, where generate-at-build would let
drift ship silently. Two of the four guard the contract between separately
deployed units — a mismatch there is the contract asserting itself, not a
build failure.

```mermaid
flowchart LR
    subgraph gateway ["Part2_Infrastructure (gateway)"]
        routes["main.py routes"] -->|"python tools/export_openapi.py"| snap["tools/openapi.json"]
    end
    subgraph web ["web/ (workspace)"]
        snap -->|"SHA-256, canonicalised"| digest["lib/gateway-openapi-digest.generated.ts"]
        snap -->|"scripts/generate-gateway-client.ts"| client["lib/gateway-contract.generated.ts"]
        tree["the tracked tree"] -->|"npm run catalog:refresh"| manifest["lib/repository-manifest.generated.json"]
        suites["the three test suites"] -->|"npm run counts:refresh"| counts["lib/test-counts.generated.ts"]
    end
    digest -->|"prebuild: check-gateway-openapi-digest.mjs"| build["npm run build"]
    manifest -->|"prebuild: generate-codebase-manifest.mjs --check"| build
    client -->|"tests/gateway-contract.test.ts"| tests["npm test"]
    counts -->|"CI: scripts/check-test-counts.mjs vs the run it just made"| ci["ci.yml"]
```

**1. OpenAPI digest.** `prebuild` canonicalises `tools/openapi.json`, SHA-256s
it and compares against the digest committed in
`lib/gateway-openapi-digest.generated.ts`. A mismatch exits 1 with `Gateway
OpenAPI digest is stale`. If you changed a gateway route: regenerate the
snapshot (`python tools/export_openapi.py` from `Part2_Infrastructure`), then
update the digest module with the hex the check script prints. CI additionally
runs `python tools/export_openapi.py --check` on the gateway side.

**2. Repository manifest.** The second `prebuild` step refuses to build if
`lib/repository-manifest.generated.json` no longer matches the tree. Refresh:
`npm run catalog:refresh`.

**3. Test counts.** `lib/test-counts.generated.ts` is what the Developer
console displays; it was three hand-copied integers before, and they drifted
three separate times (the script's header names the incidents). The web total
cannot be asserted from *inside* the suite — a test checking the count changes
the count — so CI checks it one step outside: the Tests step tees its log and
`scripts/check-test-counts.mjs` compares the runner's summary line against the
committed figure. Refresh after adding tests: `npm run counts:refresh` (or
`--suite=web` to re-run only the web suite).

**4. Gateway client.** `lib/gateway-contract.generated.ts` is typed bindings
for the committed OpenAPI contract, produced by a bespoke ~150-line converter
(`node --import tsx scripts/generate-gateway-client.ts`) rather than a codegen
dependency — the contract uses a small closed set of pydantic v2 constructs,
and anything outside that set must fail the generation loudly rather than
degrade to `any`. `tests/gateway-contract.test.ts` fails the suite when the
committed output goes stale.

## 5. The file-size ratchet

There is a 400-line ceiling on source files, held by twin tests —
[`tests/test_file_size.py`](../../Part2_Infrastructure/tests/test_file_size.py)
(gateway) and
[`web/tests/file-size.test.ts`](../../Part2_Infrastructure/web/tests/file-size.test.ts)
(workspace) — because neither ruff nor anything else on this tree has a
file-length rule, and an unenforced 300–400 line convention is how
`modules/telegram.py` once reached nearly 7,000 lines.

Each test carries an `OVER_CEILING` ledger: the files over the ceiling today,
at the length they are at. **Every entry is a debt, not an exemption**, and the
ratchet turns one way:

- a file **on** the list may not get *longer* — that is what stops "I will
  split it later" becoming "it grew while I waited";
- a file **not** on the list may not cross the ceiling at all;
- an entry is deleted once the file drops under 400 — the ratchet closing.

The rejected alternative — a flat "every file under 400" — would have been red
on the day it was written and therefore ignored. A ratchet is red only when
someone makes things worse. The rare deliberate raise is written down in the
ledger with its argument (see `tests/test_session_rollover.py`'s entry), which
is the honest version of what other codebases do silently.

The Python side has a twin for complexity: the `C901`/`PLR0915` per-file-ignores
ledger in `pyproject.toml`, seeded from the offenders that existed when the
rules were switched on, with `tests/test_complexity_debt.py` failing when an
entry is no longer needed — so the list cannot quietly outlive the debt.

## 6. CI

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs four
network-free jobs on every push and PR — a red build means the code broke,
never that an exchange was slow:

- **Gateway**: `pip install -r requirements-dev.txt`, build the native core
  (so a broken core is a red build), `ruff check .`, `pytest`,
  `export_openapi.py --check`, then the synthetic money-path probe.
- **OpenBB service**: its own `requirements-dev.txt`, `pytest`.
- **Web**: `npm ci`, `npm test` (with `set -o pipefail` — GitHub's default
  bash does not set it, and `| tee` alone would mask a red suite behind tee's
  exit 0), the test-count check against the log it just teed, `npm run
  typecheck`, `npm run build` (which exercises the two prebuild gates and the
  same artefact Vercel deploys).
- **Repo audit**: `tools/check_repo_complete.sh --fast` — catches the failure
  mode where a file builds locally but was never committed because a
  `.gitignore` pattern silently matched it.

Runtimes are pinned where the code declares them: Python 3.12 in the workflow
`env`, Node from the repo-root `.nvmrc` (it was declared in three places once;
a bump that missed one had CI testing a version nobody develops on). npm, not
yarn or pnpm — `package-lock.json` and `npm ci` are what CI uses.

A fifth job, `live-smoke`, is `workflow_dispatch` only and skips cleanly when
secrets are absent — putting a live-database probe on `pull_request` would
trade away the network-free guarantee, since an idle Always Free ADB
auto-stops. The other workflows split by tempo on purpose:
`deploy.yml` (gateway to the OCI instance — web and OpenBB deploy themselves
from git as Vercel projects, and putting them there would deploy them twice),
`e2e.yml` (smoke against what is actually deployed — the opposite job to CI),
`schema.yml` (DDL against live databases, manual on purpose: DDL that rides a
code deploy is how a table gets altered by someone shipping a CSS change), and
two keepalives.

## 7. Deploying

The short version: the gateway ships as a one-process Docker container
(`docker compose up -d --build` from the repo root) because long-lived venue
WebSockets, an embedded DuckDB file and an in-memory kill switch need one
process that never spins down — a second uvicorn worker would fork the book
and localise the kill switch. The portal and the OpenBB service are separate
Vercel projects; TLS on the VM is a Caddy sidecar with a pinned internal CA
([`docs/engineering/TLS_FLIP.md`](../engineering/TLS_FLIP.md)).

The full argument — Dockerfile design decisions, OCI steps, Vercel env vars
and region (US egress gets 451/403 from the venues), continuous deployment —
is [README §11](../../Part2_Infrastructure/README.md#11-deployment). Live URLs
and what runs keyless are in the [feature tour](../product/FEATURE_TOUR.md).
