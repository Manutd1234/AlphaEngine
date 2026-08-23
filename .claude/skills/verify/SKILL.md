---
name: verify
description: Run every AlphaEngine check and report the real measured numbers — gateway pytest, web test suite, OpenBB service tests, TypeScript typecheck, ruff lint, the production build with its OpenAPI contract gate, and the end-to-end money-path probe. Use whenever the user says verify, check, test, "run the tests", "run the suite", "does it pass", "is it green", "how many tests", "check everything", "full check", "pre-push", "does it build", "typecheck", "lint", or asks for a test count. Always re-measures rather than quoting a remembered or documented number.
---

# Verify AlphaEngine

## The one rule

**Never report a number you did not just read off a command's output.** Not from
this file, not from a README, not from memory. The counts in this repository's
prose have been stale before. If you cannot run something, say so and say why —
an unverified number is worse than an admitted gap.

## Prerequisites

The Python checks need the virtualenv at `Part2_Infrastructure/venv` (that exact
name — see the `start-alpha-engine` skill). The `ruff` step additionally needs
`requirements-dev.txt` installed; if `ruff` is missing, report the lint step as
not run rather than skipping it silently.

Nothing here needs the network, a running server, a browser or any API key. The
suites are network-free by design, so a failure means the code broke.

**Do not source `.env` into the shell first.** `set -a && . ./.env` is the
reflex and it poisons the whole run: that file carries `REQUIRE_AUTH=1`,
`tests/conftest.py` defends itself with
`os.environ.setdefault("REQUIRE_AUTH", "0")`, and `setdefault` beats a `.env`
file but loses to an EXPORTED variable. Around 80 route tests then fail with 401
and not one of them says why — you will spend the run debugging a gateway that
is fine. Run in a clean shell. If a check genuinely needs a credential, pass one
variable on that one command line.

## Run these

Run them in parallel where you can; they are independent. Capture full output —
you need the summary lines, and if anything fails you need the failure text.

```bash
# 1. Gateway suite
cd Part2_Infrastructure && venv/bin/python -m pytest

# 2. Web suite (Node's test runner, no browser)
cd Part2_Infrastructure/web && npm test

# 3. Research service
cd Part2_Infrastructure && venv/bin/python -m pytest OpenBB_Service/tests

# 4. TypeScript
cd Part2_Infrastructure/web && npm run typecheck

# 5. Python lint
cd Part2_Infrastructure && venv/bin/python -m ruff check .

# 6. Production build, including the prebuild contract gate
cd Part2_Infrastructure/web && npm run build

# 7. End-to-end money path: book -> cost -> risk gate -> audit
cd Part2_Infrastructure && venv/bin/python tools/synthetic_probe.py
```

Do not pipe through `tail` on the first pass — you will lose the `prebuild`
line from step 6 and the per-step table from step 7.

## Reading the output

**pytest** ends with a line like `N passed, M skipped in Xs`. Report the skip
count too; a skip is not a pass, and run `-rs` if you need the reasons.

Expect **two skips** on the gateway suite in a normal clean-shell run, both
named and both correct:

1. `tests/test_data_ops_postgrest.py` — no `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY`, so the Postgres backend was not exercised. One
   collected test, skipped.
2. `tests/test_research_rerank_real.py` — no `RERANK_TEST_MODEL_PATH`, so no
   cross-encoder weights were offered. This one skips at MODULE level, so its
   eight tests are not collected at all.

That is why there are two green gateway totals and neither is wrong. Measured
2026-08-23: without the opt-ins **2,141 passed, 2 skipped**; with re-ranker
weights seeded **2,149 passed, 1 skipped** — 8 passes gained, 1 skip lost.

**Check which shape you are in before reporting, because the machine may have
chosen for you.** `tests/conftest.py` does not blank `RERANK_TEST_MODEL_PATH`,
and `config.py` loads `Part2_Infrastructure/.env` through python-dotenv, so a
`.env` naming a weights directory silently produces the seeded run with nothing
exported. `grep RERANK_TEST_MODEL_PATH Part2_Infrastructure/.env` answers it;
`RERANK_TEST_MODEL_PATH= venv/bin/python -m pytest` forces the CI shape. Say
which one you ran. Do not "reconcile" the number against
`web/lib/test-counts.generated.ts`: that file's gateway line is a dated record
and is NOT checked by CI. Only its web line is
(`node scripts/check-test-counts.mjs web <log>`) — and as of 2026-08-22 that
line is behind the suite, so expect a mismatch there until someone runs
`npm run counts:refresh`.

**`npm test`** ends with a `node:test` summary block. Report `tests`, `pass`,
`fail` and `suites`. `fail 0` is the thing that matters.

**`npm run typecheck`** prints nothing on success and exits 0. Say "clean", not
a number.

**`ruff check .`** prints `All checks passed!` on success.

**`npm run build`** runs TWO checks in `prebuild`, before Next.js starts, and
either can stop it. First `scripts/check-gateway-openapi-digest.mjs`: on success
`Gateway OpenAPI digest verified: <sha256>`, on drift `Gateway OpenAPI digest is
stale. Expected <hash>; update <path>` and exit 1. Then
`scripts/generate-codebase-manifest.mjs --check`, which prints
`Repository manifest is stale (N added, M removed) — run npm run catalog:refresh`
and exits 1.

**On 2026-08-22 the second one fails on this tree** — 32 files added, none
removed — so a verify run today reports the build as RED with that named cause,
and the fix is `npm run catalog:refresh`, not a code change. Report it as an
index that is behind the tree rather than as a broken build, and check whether
it is still true before repeating this paragraph.

**Neither stale-artefact failure is a broken build.** The digest one is the committed
OpenAPI contract asserting itself between two separately deployed units — the
gateway and the browser client. If it fires, say so in those terms, and say the
fix is a deliberate one: regenerate with `venv/bin/python tools/export_openapi.py`
from `Part2_Infrastructure`, then update the digest in
`web/lib/gateway-openapi-digest.generated.ts`. Never "fix" it by editing the
digest to match without understanding what changed in the API.

**`synthetic_probe.py`** prints six named steps — gateway health, metrics
exposition, order book, execution cost (TCA), risk gate rejects, audit trail —
then `N/6 steps passed`. It boots the app in-process, so a wall of INFO logging
before the table is normal. A `WARNING` about a missing session rollover record
is also normal on a laptop whose gateway has been down across a UTC boundary.

## Report like this

A compact table, real numbers only:

| Check | Result |
|---|---|
| Gateway pytest | ... passed, ... skipped (CI shape / weights seeded) |
| Web suite | ... passed / ... suites, ... failed |
| OpenBB service | ... passed |
| Typecheck | clean / N errors |
| ruff | All checks passed / N findings |
| Production build | succeeded, digest verified / stale; manifest fresh / stale |
| Money-path probe | N/6 steps |

Then one line: everything green, or exactly what is red and where.

## Not part of this

Do not run the desk sweep here. `web/scripts/desk-sweep.mjs` needs a dev server
on **port 3100** (not 3000) plus a Chrome with `--remote-debugging-port=9222`,
and its flags are `--name=value` form only. It is a separate, advanced check —
mention it exists if the user wants browser-level coverage of the 47 rail
sections under fault injection, but do not fold it into the standard verify run.

Do not run CI's live-connectivity jobs. `live-smoke` is `workflow_dispatch`
only and needs Oracle and Supabase secrets; `rerank-real` needs a
`workflow_dispatch` or a `rerank` label and downloads 1.05 GiB of weights. Both
skip cleanly without them by design.

Do not compile the whitepaper as part of a verify run either. `docs/whitepaper/`
is Typst source with no PDF committed, `typst` is in no requirements file, and
no CI job builds it — so it is a real check nobody gates, but it is not one of
the seven above. If the user asks, the command is
`typst compile docs/whitepaper/main.typ out.pdf`; report that it completed and
count the pages in the PDF it produced, never a remembered figure.
