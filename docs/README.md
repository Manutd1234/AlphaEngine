# docs/ — the index

*As of 22 August 2026.* One line per document, honest about what each one is
and is not. The four originals now live on the shelves beside their kin —
moved in the same pass that re-pointed every deep link in the tree
(`web/tests/tour-truth.test.ts` reads `docs/product/FEATURE_TOUR.md`, and
`Part2_Infrastructure/README.md` links the new paths),
because a moved document with stale links is a broken link wearing a tidier
path. Where a document and the tree disagree, the tree is right; every file
here stamps its own date.

The 2,000-line authority on the gateway, the workspace and the service is
[`Part2_Infrastructure/README.md`](../Part2_Infrastructure/README.md). Nothing
in this folder restates it at length; everything here distils and links.

## Architecture

| Document | What it is |
|---|---|
| [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | The system in one sitting: the three deployment units, the two-implementation parity argument, the three latency planes — figures read off the tree, files named beside them. |
| [`architecture/DATA_PROCESSING_FLOW.md`](architecture/DATA_PROCESSING_FLOW.md) | Every hop data takes, end to end; names the hops and links the arguments rather than repeating them. |
| [`architecture/UML_DIAGRAMS.md`](architecture/UML_DIAGRAMS.md) | Class and sequence diagrams for the anti-twitch machinery and the research pipeline; every member drawn exists in the named source file. |

## Engineering

| Document | What it is |
|---|---|
| [`engineering/CODING_STANDARDS.md`](engineering/CODING_STANDARDS.md) | The house rules as a standards document — distinctive because almost every rule is enforced by a named test, not by review. |
| [`LATENCY_BUDGET.md`](architecture/LATENCY_BUDGET.md) | Every latency number the desk claims, measured with the method and machine stated; where something could not be measured, it says so. |
| [`latency-bench.generated.json`](architecture/latency-bench.generated.json) | Generated bench data behind the budget's §2.1 table (`tools/bench_decision.py`). Regenerated, never edited. |
| [`DATA_OPS_BACKEND.md`](architecture/DATA_OPS_BACKEND.md) | The four tables the gateway must not forget across a restart, and the sqlite/postgres choice that decides where they live. |
| [`TLS_FLIP.md`](engineering/TLS_FLIP.md) | Moving the web-to-gateway hop to HTTPS via a Caddy sidecar with a pinned internal CA — and why pinning beats public PKI for a single-client hop. |

## Planning

| Document | What it is |
|---|---|
| [`planning/PRD.md`](planning/PRD.md) | The enterprise RAG requirement — five stages, the recommended stack per stage — and the delivery record: built, substituted with an argument, or NOT BUILT with the reason it waits. |
| [`planning/PLAN.md`](planning/PLAN.md) | Where the research plane stands, the owed items collected from the modules that owe them, and the decision log with rejected alternatives. |
| [`planning/TECH_STACK.md`](planning/TECH_STACK.md) | The stack layer by layer, versions read from the tree — pins from `requirements*.txt`, locks from `package-lock.json`. |
| [`planning/WORKFLOW.md`](planning/WORKFLOW.md) | How to work on AlphaEngine without losing an hour to a trap somebody already fell into. |

## Product

| Document | What it is |
|---|---|
| [`product/PRODUCT_GUIDE.md`](product/PRODUCT_GUIDE.md) | The what-and-why of the workspace: what each tab is for, what a number on screen is allowed to be, what a click is allowed to change. |
| [`FEATURE_TOUR.md`](product/FEATURE_TOUR.md) | The guided walkthrough, structured as the desk's decision loop across the eight tabs; its rail lists are pinned to `lib/sections.ts` by a test, so it cannot silently drift from the app. |

## Testing

| Document | What it is |
|---|---|
| [`testing/TESTING.md`](testing/TESTING.md) | The testing philosophy and practice — why the suites are shaped as they are; the per-suite catalogue stays in `Part2_Infrastructure/README.md` §10. |

## Not in this folder, deliberately

- [`Part2_Infrastructure/docs/`](../Part2_Infrastructure/docs/) holds the
  operational set that belongs beside the code it operates: `RUNBOOK.md`,
  `GRAPH_RECALL.md`, `REFACTOR_RULES.md` and the Telegram live checklist.
- [`CLAUDE.md`](../CLAUDE.md) is the agent-facing file — the four facts that
  cost an hour each — and [`SETUP.md`](../SETUP.md) is the running
  instructions. Neither is duplicated here.
- Test counts live in `web/lib/test-counts.generated.ts` and nowhere in prose:
  never quote one from memory or from a README — run the suite and read the
  number off the output.
