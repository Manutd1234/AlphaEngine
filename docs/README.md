# docs/ — the index

*As of 24 August 2026.* One line per document, honest about what each one is
**for** — so a reader can pick one rather than opening five. Documents are filed
by their path, which is the only arrangement an index cannot drift away from.
Where a document and the tree disagree, the tree is right; every file here
stamps its own date.

Everything in this folder is a *distillation*. The operating authority on the
gateway, the workspace and the service is
[`../Part2_Infrastructure/README.md`](../Part2_Infrastructure/README.md);
[`../README.md`](../README.md) is the front door and
[`../SETUP.md`](../SETUP.md) is the running instructions. Nothing here restates
those at length.

**Where to start, by what you came for**

| If you want to… | Read |
|---|---|
| understand the system in one sitting | [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) |
| see the desk, tab by tab | [`product/FEATURE_TOUR.md`](product/FEATURE_TOUR.md) |
| know why a number on screen is allowed to say what it says | [`product/PRODUCT_GUIDE.md`](product/PRODUCT_GUIDE.md) |
| trace one number from vendor bytes to pixel | [`architecture/DATA_PROCESSING_FLOW.md`](architecture/DATA_PROCESSING_FLOW.md) |
| check a latency claim | [`architecture/LATENCY_BUDGET.md`](architecture/LATENCY_BUDGET.md) |
| know what is built, what was substituted and what is not built | [`planning/PRD.md`](planning/PRD.md) and [`planning/PLAN.md`](planning/PLAN.md) |
| change code without breaking a rule a test enforces | [`engineering/CODING_STANDARDS.md`](engineering/CODING_STANDARDS.md) |
| talk about test counts at all | [`testing/TESTING.md`](testing/TESTING.md) — the only document here allowed to |

## Architecture

| Document | What it is for |
|---|---|
| [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | The system in one sitting: the three deployment units and why they are three, the two-implementation parity argument, the three latency planes. Figures read off the tree, files named beside them. Start here if you are reviewing the repository. |
| [`architecture/DATA_PROCESSING_FLOW.md`](architecture/DATA_PROCESSING_FLOW.md) | Every hop data takes, end to end — vendor bytes to rendered number, and order to audit row. Names the hops and links the arguments rather than repeating them. Read it when you need to know *where* something happens, not *why*. |
| [`architecture/UML_DIAGRAMS.md`](architecture/UML_DIAGRAMS.md) | Class and sequence diagrams for the anti-twitch machinery and the research pipeline. Every member drawn exists in the named source file, which is what makes the diagrams checkable rather than decorative. |
| [`architecture/LATENCY_BUDGET.md`](architecture/LATENCY_BUDGET.md) | Every latency number the desk claims, measured with the method and machine stated; where something could not be measured, it says so. It deliberately carries **two** decision readings and refuses to average them — read its §2.1 before quoting a microsecond figure anywhere. |
| [`architecture/latency-bench.generated.json`](architecture/latency-bench.generated.json) | The generated bench data behind that §2.1 table (`tools/bench_decision.py`). Regenerated, never edited by hand. |
| [`architecture/DATA_OPS_BACKEND.md`](architecture/DATA_OPS_BACKEND.md) | The four tables the gateway must not forget across a restart, and the SQLite/Postgres choice that decides where they live. Read it before adding a fifth. |

## Engineering

| Document | What it is for |
|---|---|
| [`engineering/CODING_STANDARDS.md`](engineering/CODING_STANDARDS.md) | The house rules as a standards document — distinctive because almost every rule is enforced by a named test rather than by review. It also states the one thing those tests cannot check: they read stylesheet text, so geometry is derived, never observed. |
| [`engineering/TLS_FLIP.md`](engineering/TLS_FLIP.md) | Moving the web-to-gateway hop to HTTPS via a Caddy sidecar with a pinned internal CA — and why pinning beats public PKI when there is exactly one client and the host is a bare IP. |

## Planning

| Document | What it is for |
|---|---|
| [`planning/PRD.md`](planning/PRD.md) | The enterprise RAG requirement — five stages, the recommended stack per stage — and the delivery record against it: built, substituted with an argument, or NOT BUILT with the reason it waits. The document to read if the question is "did they do what was asked". |
| [`planning/PLAN.md`](planning/PLAN.md) | Where the research plane stands, the owed items collected from the modules that owe them, and the decision log with rejected alternatives. It also carries the information-diffusion study, whose headline is a **null** and is stated as one. |
| [`planning/TECH_STACK.md`](planning/TECH_STACK.md) | The stack layer by layer — frontend, backend, the five data stores, ML, retrieval, DevOps — with versions read from the tree: pins from `requirements*.txt`, locks from `package-lock.json`. Each optional component is documented with the shape of its absence. |
| [`planning/WORKFLOW.md`](planning/WORKFLOW.md) | How to work on AlphaEngine without losing an hour to a trap somebody already fell into: what to regenerate and in what order, which gates fail loudly, and which two look like code defects and are not. |

## Product

| Document | What it is for |
|---|---|
| [`product/PRODUCT_GUIDE.md`](product/PRODUCT_GUIDE.md) | The what-and-why of the workspace: what each tab is for, what a number on screen is allowed to be, what a click is allowed to change. The honesty doctrine in product terms. |
| [`product/FEATURE_TOUR.md`](product/FEATURE_TOUR.md) | The guided walkthrough, structured as the desk's decision loop across all **nine** tabs and 59 rail sections. Its rail lists are pinned to `web/lib/sections.ts` by a test, so it cannot silently drift from the app — which is why it is the reference when this index and the app disagree. |

## Testing

| Document | What it is for |
|---|---|
| [`testing/TESTING.md`](testing/TESTING.md) | The testing philosophy and practice — why the suites are shaped as they are; the per-suite catalogue stays in `Part2_Infrastructure/README.md` §10. **The one document in this folder allowed to discuss test counts**, and the place the suites' standing blind spots are named: no layout engine, and the opt-in skips that are a local credential and a local weights directory rather than missing coverage. |

## The whitepaper

| Document | What it is for |
|---|---|
| [`whitepaper/`](whitepaper/) | The institutional whitepaper — Typst source in `sections/`, one file per chapter, over a shared `template.typ`; compile with `typst compile docs/whitepaper/main.typ docs/whitepaper/AlphaEngine_Institutional_Whitepaper.pdf`. Six chapters: the topology and the three distinguishing arguments; the researcher and PM; the risk manager and trader; the data engineer, SRE and developer; the mathematical foundations; infrastructure and telemetry. **It replaces the legacy `AlphaEngine_Project_Explainer.pdf`** — cite the whitepaper wherever that file was cited. |

Three things worth knowing before editing it. Typst evaluates an `#include`d
file in its own scope, so `main.typ`'s `#import "template.typ": *` does **not**
reach the section files: every chapter carries its own
`#import "../template.typ": …` line or fails with "unknown variable: measured".
`.gitignore` excludes `*.pdf`, so **no built artefact is committed** and no CI
job compiles the source — a broken chapter is found by whoever next runs the
command. And the whitepaper is not this folder's to edit: the Typst source is
owned separately from the markdown here, which is why it gets an index entry and
no summary of its contents.

## Not in this folder, deliberately

- [`../Part2_Infrastructure/docs/`](../Part2_Infrastructure/docs/) holds the
  operational set that belongs beside the code it operates:
  [`RUNBOOK.md`](../Part2_Infrastructure/docs/RUNBOOK.md),
  [`GRAPH_RECALL.md`](../Part2_Infrastructure/docs/GRAPH_RECALL.md),
  [`REFACTOR_RULES.md`](../Part2_Infrastructure/docs/REFACTOR_RULES.md) and
  [`telegram-live-checklist.md`](../Part2_Infrastructure/docs/telegram-live-checklist.md).
- Each deployment unit's own README stays with the unit:
  [`../Part2_Infrastructure/README.md`](../Part2_Infrastructure/README.md) (the
  gateway), [`../Part2_Infrastructure/web/README.md`](../Part2_Infrastructure/web/README.md)
  (the desk workspace) and
  [`../Part2_Infrastructure/OpenBB_Service/README.md`](../Part2_Infrastructure/OpenBB_Service/README.md)
  (the stateless research service).
- [`../CLAUDE.md`](../CLAUDE.md) is the agent-facing file — the facts that cost
  an hour each — and [`../SETUP.md`](../SETUP.md) is the running instructions.
  Neither is duplicated here.
- **Test counts** live in `web/lib/test-counts.generated.ts` and, in prose, in
  exactly one document: [`testing/TESTING.md`](testing/TESTING.md). Everything
  else links to it. That rule was written after the counts drifted in five files
  at once, because the paragraph explaining them had been copied into each: the
  gateway has two correct pass counts depending on whether the cross-encoder
  weights are seeded, the web figure cannot be asserted from inside the suite
  that produces it, and the committed record is a dated measurement whose
  gateway line CI does not check. A count needs all three caveats or none of it;
  five copies guarantee that some of them will be wrong.
