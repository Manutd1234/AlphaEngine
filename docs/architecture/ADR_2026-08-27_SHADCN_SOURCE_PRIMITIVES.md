# ADR: source-owned shadcn/ui primitives

- Status: accepted; implementation landed
- Date: 2026-08-27
- Last verified: 2026-08-29
- Decision owners: AlphaEngine frontend and release qualification
- Supersedes: the blanket “no new npm dependencies” rule for the exact packages below only

## Context

At the time of the decision, AlphaEngine implemented every control and chart
directly in-tree. That kept the runtime dependency graph small, but it had also produced several parallel
button, panel, form, disclosure, loading, and status patterns. The upgrade
requires a consistent institutional operator interface, accessible interaction
primitives, and real browser qualification without changing the information in
Overview, Research, Execution, Portfolio, Risk, Data, Reliability, or Developer.

The official shadcn initializer cannot be run directly against this workspace.
It may rewrite the global stylesheet, font bindings, Tailwind bridge, aliases,
and package manifest. AlphaEngine deliberately has:

- a source-ordered global CSS manifest;
- Tailwind 4 with no preflight and an unlayered utility bridge;
- existing semantic desk tokens;
- public route and mounted-panel lifecycle contracts;
- a 400-line source-file ceiling;
- copy guards for the eight protected workspaces.

## Decision

Adopt the Radix-backed, `new-york` shadcn/ui component sources under
`Part2_Infrastructure/web/components/ui`. The copied source belongs to this
repository and is reviewed like any other application code. Domain compositions
live beside their owning domains (principally `components/workspace`,
`components/coherence`, `components/research` and `components/auth`); top-level
routing remains custom.

The CLI is used only for inspection and disposable dry runs. `components.json`
is written deliberately for this repository. No command may overwrite an
existing source file without an inspected diff.

### Disposable CLI evidence

The official `shadcn 4.19.0` initializer was run on 2026-08-27 against a
disposable copy of the web configuration, never the working tree. Its default
Radix run would have:

- added `shadcn` and `tw-animate-css` to production dependencies;
- imported both packages into `app/tailwind.css`;
- replaced the existing font bridge with a circular `--font-sans` binding;
- appended a second light/dark palette and a global base layer;
- edited `app/layout.tsx` and introduced a third font; and
- selected the current `radix-nova` default rather than the reviewed house
  composition.

Those changes conflict with the source-order, palette, font, dependency, and
preflight contracts above. The dry run therefore validates the controlled
manual integration decision; none of its modified project files is copied.

### Exact runtime allowlist

| Package | Version | Boundary |
|---|---:|---|
| `radix-ui` | `1.6.7` | Accessible headless primitives used by reviewed shadcn source |
| `class-variance-authority` | `0.7.1` | Typed visual variants in source-owned primitives |
| `clsx` | `2.1.1` | Conditional class composition inside the shared `cn` helper |
| `tailwind-merge` | `3.6.0` | Deterministic utility conflict resolution inside the shared `cn` helper |

Existing runtime packages remain allowed. No other runtime package is implied by
this decision. In particular, no charting, grid, animation, form-state, date,
or icon package is approved.

### Exact release-test allowlist

| Package | Version | Boundary |
|---|---:|---|
| `@playwright/test` | `1.62.1` | Deterministic Chromium browser, responsive, interaction, and screenshot gates |
| `@axe-core/playwright` | `4.13.0` | Automated accessibility checks within the Playwright journeys |

The browser packages are development-only. Browser binaries are installed in
CI or a qualification environment, never downloaded at application runtime.

### Explicit exclusions

- `tw-animate-css` is excluded until a component demonstrates a necessary
  motion contract and passes reduced-motion tests.
- `recharts`, generic data grids, and animation libraries are excluded. Existing
  quantitative SVG and exact-value tables remain domain-owned.
- `geist` is excluded as a package. The font decision uses the framework font
  path and must preserve metric-matched, self-hosted loading.
- `cmdk`, form-state libraries, and schema libraries are excluded from this
  tranche. Existing command and validation logic remains the authority.

## Integration rules

1. Map shadcn surface, text, border, focus, and status variables to AlphaEngine’s
   semantic tokens. Do not introduce an independent palette.
2. Keep Tailwind preflight disabled and keep `app/tailwind.css` after
   `app/globals.css`.
3. Never let the initializer replace `app/globals.css`, `app/layout.tsx`,
   `tsconfig.json`, or the package scripts.
4. Source-owned primitives must stay under 400 lines and expose semantic HTML,
   keyboard behaviour, focus visibility, forced-colour support, and reduced
   motion.
5. Generic `Tabs` must not replace the workspace router or alter which expensive
   panels stay mounted.
6. Existing charts, proof objects, and diffusion figures remain domain
   components; shadcn owns their frame, controls, disclosures, and states.
7. Overview, Research, Execution, Portfolio, Risk, Data, Reliability, and
   Developer receive presentation changes only. Their rendered and static text
   must remain byte-for-byte unchanged.
8. Every dependency is pinned in `package-lock.json`. A manifest test fails on
   an unreviewed dependency or an allowed dependency at another version.
9. Licence, provenance, audit, production build, bundle delta, typecheck,
   browser, accessibility, and rollback evidence are release gates.

## Initial primitive set

The first source-owned set is intentionally small:

- Button, Badge, Card, Separator, Skeleton, Alert;
- Input, Label, Checkbox;
- Tooltip, Collapsible, Dialog, Sheet;
- Table and ScrollArea;
- Select, DropdownMenu, Popover, and ToggleGroup only when a migrated surface
  needs their interaction contract.

The implementation begins with loading/error states and login, then moves to
shell controls and quantitative domain compositions. A primitive is added on
demand, not because it exists in the registry.

## Implementation record — verified 2026-08-29

The decision has landed without changing its boundary:

- `components/ui/` contains 21 source-owned primitive modules: alert, badge,
  button, card, checkbox, collapsible, dialog, dropdown-menu, input, label,
  popover, scroll-area, select, separator, sheet, skeleton, table, tabs, toggle,
  toggle-group and tooltip.
- The compositions that use them live with their domains under `components/auth`,
  `components/workspace`, `components/research` and `components/coherence`.
  There is no parallel `components/quant` package and no second workspace router.
- The quantitative claim remains domain code: probability lattices, fee
  decompositions, baskets, Fréchet bounds, calibration, corpus composition and
  diffusion figures are not delegated to a chart library.
- `web/tests/dependency-policy.test.ts` pins the complete production and
  development manifests, the exact package versions above, excluded packages
  and the `nanoid` override. The current build/test evidence is recorded once in
  [`../CURRENT_STATE.md`](../CURRENT_STATE.md), not duplicated here.

This verification records source and build state. It does not turn the ADR's
browser qualification gate into a claim that a browser journey ran in every
environment; browser evidence must come from the Playwright qualification run
that actually produced it.

## Consequences

Positive consequences:

- controls share one accessible interaction substrate;
- state, form, focus, and disclosure behaviour becomes consistent;
- component source stays inspectable and customisable;
- browser tests can verify geometry that the Node source tests cannot observe.

Costs and risks:

- the runtime graph grows by four pinned packages;
- Radix portal and focus behaviour requires real browser tests;
- legacy and new CSS can conflict during migration;
- the lockfile, bundle, licences, and security posture need review on updates.

These risks are contained by exact allowlisting, one-family-at-a-time migration,
selector ownership tests, visual qualification, and phase-level rollback.

## Rollback

Each migrated composition keeps its public props and route contract. Rollback is
therefore a source revert of the affected primitive/composition family. Remove a
package only after repository search and the production build prove it has no
remaining import. Do not retain a compatibility shim solely to make a rollback
look smaller.
