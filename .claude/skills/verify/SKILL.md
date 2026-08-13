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
name — see the `start` skill). The `ruff` step additionally needs
`requirements-dev.txt` installed; if `ruff` is missing, report the lint step as
not run rather than skipping it silently.

Nothing here needs the network, a running server, a browser or any API key. The
suites are network-free by design, so a failure means the code broke.

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
count too; a skip is not a pass.

**`npm test`** ends with a `node:test` summary block. Report `tests`, `pass`,
`fail` and `suites`. `fail 0` is the thing that matters.

**`npm run typecheck`** prints nothing on success and exits 0. Say "clean", not
a number.

**`ruff check .`** prints `All checks passed!` on success.

**`npm run build`** runs `scripts/check-gateway-openapi-digest.mjs` *before*
Next.js starts. On success it prints `Gateway OpenAPI digest verified: <sha256>`.
On drift it prints `Gateway OpenAPI digest is stale. Expected <hash>; update
<path>` and exits 1.

**That stale-digest failure is not a broken build.** It is the committed
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
| Gateway pytest | ... passed, ... skipped |
| Web suite | ... passed / ... suites, ... failed |
| OpenBB service | ... passed |
| Typecheck | clean / N errors |
| ruff | All checks passed / N findings |
| Production build | succeeded, digest verified / stale |
| Money-path probe | N/6 steps |

Then one line: everything green, or exactly what is red and where.

## Not part of this

Do not run the desk sweep here. `web/scripts/desk-sweep.mjs` needs a dev server
on **port 3100** (not 3000) plus a Chrome with `--remote-debugging-port=9222`,
and its flags are `--name=value` form only. It is a separate, advanced check —
mention it exists if the user wants browser-level coverage of the 43 rail
sections under fault injection, but do not fold it into the standard verify run.

Do not run CI's live-connectivity jobs. They are `workflow_dispatch` only, need
Oracle and Supabase secrets, and skip cleanly without them by design.
