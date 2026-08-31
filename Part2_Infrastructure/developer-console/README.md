# AlphaEngine Developer

**Last verified: 2026-08-29.** This is an experimental, separately built
Sites/vinext surface, not one of AlphaEngine's three deployment units. The
canonical workspace developer tab lives in `../web/`; current repository
topology is recorded in [`../../docs/CURRENT_STATE.md`](../../docs/CURRENT_STATE.md).

An operational dashboard for quant engineering delivery: launch readiness,
CI/CD execution, immutable artifact lineage, schema drift, repository changes,
telemetry readiness, and engineering-impact work queues.

The current UI deliberately separates repository-backed local snapshots from
live-provider data. GitHub runs, deployment state, production schemas, latency
telemetry, issue tracking, and privileged controls remain visibly unavailable
until their server-side connectors and authorization policies exist.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
npm test
npm run lint
```

The default scripts target the Sites/vinext runtime. Vercel uses the native
Next.js build through `npm run build:vercel`, configured in `vercel.json`.

## Product boundaries

- Passing CI never implies production readiness.
- Pipeline runs, code diffs and gateway contracts on screen are illustrative
  fixtures, labelled as such in the rendered UI. They carry no author, no commit
  hash, no wall-clock timestamp, no job or run duration and no discovered-test
  count, because no CI, repository or schema provider is connected to this app
  and every one of those is a measurement. Where a figure cannot be derived the
  surface reads *not available* and names what is missing; it is never filled
  with a plausible one. `duration` is absent from the `PipelineRun` type rather
  than blanked, so the shape cannot carry an invented number in the first place.
- Stale, missing, or unreachable operational evidence never renders healthy.
- The browser contains no provider, cloud, or broker credentials.
- Deployment, rollback, halt, and reset controls are disabled until a gated,
  audited command plane is commissioned.
- The Developer views use deep-linkable hash routes and keyboard-accessible
  tab navigation.

The site is built with React, vinext, Vite, and the Sites deployment runtime.
