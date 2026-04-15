---
'@openmdm/core': minor
'@openmdm/hono': minor
'@openmdm/plugin-kiosk': patch
---

Add structured logger interface and health probes.

**New `Logger` type in `@openmdm/core`** — pino/winston/bunyan-compatible
interface (`debug` / `info` / `warn` / `error` / `child`) that replaces every
internal `console.*` call in core, webhooks, plugin-storage, the kiosk plugin,
and the hono adapter. Hosts pass their own logger via `createMDM({ logger })`;
the default is a console-backed fallback with an `[openmdm]` prefix that
renders structured context as JSON. A `createSilentLogger()` helper is exported
for tests.

The logger is now exposed on `MDMInstance.logger`, so plugins should call
`instance.logger.child({ component: 'my-plugin' })` in `onInit` rather than
reaching for `console.*`. The kiosk plugin is already updated to do this, and
its pre-existing "pluginStorage not configured" warning now fires through the
structured logger with a stable context payload (`reason: 'pluginStorage-not-configured'`)
so downstream alerts can match on it.

**`/healthz` and `/readyz` in `@openmdm/hono`** — unauthenticated health
probes designed for Kubernetes / ECS / load balancers:

- `/healthz` (liveness): always returns 200 OK if the process is alive.
  Deliberately does NOT touch the database, because a database fault is not a
  reason for the orchestrator to kill the pod.
- `/readyz` (readiness): returns 200 + `{ status: 'ok' }` when the database
  round-trip (`listDevices({ limit: 1 })`) succeeds and the push adapter is
  present. Returns 503 + `{ status: 'degraded', checks: {...} }` otherwise,
  with a per-check breakdown so operators can see which subsystem is down.

The push check is deliberately shallow (presence, not a live round-trip) to
avoid rate-limiting against FCM on every readiness tick. A richer push probe
is tracked as a follow-up.

**New docs page** `docs/content/docs/concepts/operations.mdx` covering the
logger interface, the silent logger, what OpenMDM logs internally, the
liveness vs readiness distinction, and a working Kubernetes deployment
example. Explicitly documents what is *not* included (Prometheus/OTEL
metrics, distributed tracing, per-request request IDs) and why, so operators
don't waste time looking for them.

**Tests** — 129 -> 140 total.
- `packages/core/tests/logger.test.ts`: 15 tests covering the `Logger`
  interface contract — level routing, call conventions, JSON context
  rendering, circular-context safety, child scoping.
- `packages/adapters/hono/tests/health.test.ts`: 8 tests covering both
  endpoints, including the critical invariant that `/healthz` never
  touches the database and the full 503 degradation path with a mock
  listDevices that throws.

**Migration:** none. The logger config is additive (falls back to
console if omitted), and the health endpoints are new routes that don't
conflict with anything existing. Hosts that want structured logs in
production should pass `logger: pino(...)` on upgrade.
