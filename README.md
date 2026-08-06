# AlphaEngine Developer

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
- Stale, missing, or unreachable operational evidence never renders healthy.
- The browser contains no provider, cloud, or broker credentials.
- Deployment, rollback, halt, and reset controls are disabled until a gated,
  audited command plane is commissioned.
- The Developer views use deep-linkable hash routes and keyboard-accessible
  tab navigation.

The site is built with React, vinext, Vite, and the Sites deployment runtime.
