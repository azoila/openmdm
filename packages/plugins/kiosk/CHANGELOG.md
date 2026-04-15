# @openmdm/plugin-kiosk

## 0.3.0

### Minor Changes

- [#12](https://github.com/azoila/openmdm/pull/12) [`2f86a77`](https://github.com/azoila/openmdm/commit/2f86a7713caae011ea5563ec5c33b410d7ba204a) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Persist kiosk plugin state through `pluginStorage` instead of an in-memory `Map`.

  **The bug this fixes:** the kiosk plugin previously kept per-device lockout
  counters, the current kiosk app, and exit-attempt timestamps in a
  `Map<string, KioskState>` that lived in process memory. A server restart
  reset every counter to zero, and running a second replica behind a load
  balancer meant each replica had its own view of the state. Both failure
  modes silently bypass the security UX the plugin exists to provide: a user
  who hit the max exit attempts got a fresh budget on every redeploy, and
  replicas could disagree about whether a device was locked out.

  **The fix:** the plugin now reads and writes through `mdm.pluginStorage`
  whenever it is configured, which routes the state through the normal
  `DatabaseAdapter` path and into the `mdm_plugin_storage` table.

  **Drizzle adapter changes** (`@openmdm/drizzle-adapter`):

  - New `mdmPluginStorage` table in the Postgres schema
    (`mdm_plugin_storage`) with a composite `(plugin_name, key)` primary key
    and a JSONB `value` column.
  - New `getPluginValue` / `setPluginValue` / `deletePluginValue` /
    `listPluginKeys` / `clearPluginData` methods on the adapter. These are
    only wired when the caller passes the new optional `pluginStorage`
    table reference through `DrizzleAdapterOptions.tables`.
  - `setPluginValue` uses `onConflictDoUpdate` so writes are idempotent and
    last-write-wins.

  **Kiosk plugin changes** (`@openmdm/plugin-kiosk`):

  - `getKioskState` / `updateKioskState` are now async and go through
    `mdm.pluginStorage` when available.
  - New `listKioskStates` helper replaces the direct `Map.entries()` call
    in the admin listing route.
  - Startup warning when `pluginStorage` is not configured, pointing to
    docs for the correct setup.
  - Date fields (`lockedSince`, `lastExitAttempt`, `lockoutUntil`) are
    rehydrated from JSON strings to `Date` objects on read.

  **Breaking for direct users of `DrizzleAdapterOptions.tables`:** nothing
  — the new `pluginStorage` table is optional. If omitted, the kiosk
  plugin falls back to the in-memory path with a clear warning, matching
  the pre-fix behavior for anyone who hasn't run the new migration.

  **Docs updates:**

  - `docs/content/docs/installation.mdx` now shows the full `tables` list
    including `pluginStorage` and the `pluginStorage: { adapter: 'database' }`
    config flag.
  - `docs/content/docs/recipes/kiosk.mdx` documents the production
    requirement and explains the in-memory fallback.

  **New migration required:** run `drizzle-kit generate && drizzle-kit
migrate` after upgrading to pick up the new `mdm_plugin_storage` table.

### Patch Changes

- [#14](https://github.com/azoila/openmdm/pull/14) [`0a58d6d`](https://github.com/azoila/openmdm/commit/0a58d6de0641c095af46cb55e871c5dafab7dff5) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Add structured logger interface and health probes.

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
  example. Explicitly documents what is _not_ included (Prometheus/OTEL
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

- Updated dependencies [[`0a58d6d`](https://github.com/azoila/openmdm/commit/0a58d6de0641c095af46cb55e871c5dafab7dff5)]:
  - @openmdm/core@0.8.0

## 0.2.4

### Patch Changes

- Updated dependencies [[`ff0ec7f`](https://github.com/azoila/openmdm/commit/ff0ec7f545f97b2ed3620ceb542ef318ba52533c)]:
  - @openmdm/core@0.7.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`41b87bd`](https://github.com/azoila/openmdm/commit/41b87bd6f71b54fba4a9a67e6d8443006a685c98), [`c713954`](https://github.com/azoila/openmdm/commit/c71395403cb24b136e54a7d98662a7f599f1297a)]:
  - @openmdm/core@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`997236f`](https://github.com/azoila/openmdm/commit/997236fca5bb2311b4e736b552500aacab6c82d8)]:
  - @openmdm/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @openmdm/core@0.3.0

## 0.2.0

### Minor Changes

- [`7e46ef2`](https://github.com/azoila/openmdm/commit/7e46ef205d03dbc488c0ecf924d20aac88f60bc8) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Initial release of OpenMDM - a modern, embeddable Mobile Device Management SDK for TypeScript.

  **Core Features:**

  - Device enrollment and management
  - Policy configuration and deployment
  - Command execution (sync, lock, wipe, reboot)
  - Application management
  - Event system with webhooks

  **Adapters:**

  - Hono framework adapter for HTTP endpoints
  - Drizzle ORM adapter for database operations
  - S3 storage adapter for APK uploads

  **Push Notifications:**

  - Firebase Cloud Messaging (FCM) adapter
  - MQTT adapter for private networks

  **Plugins:**

  - Kiosk mode plugin
  - Geofencing plugin

  **Tools:**

  - CLI for device and policy management
  - Client SDK for device-side integration

### Patch Changes

- Updated dependencies [[`7e46ef2`](https://github.com/azoila/openmdm/commit/7e46ef205d03dbc488c0ecf924d20aac88f60bc8)]:
  - @openmdm/core@0.2.0
