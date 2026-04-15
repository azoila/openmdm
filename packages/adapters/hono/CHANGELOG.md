# @openmdm/hono

## 0.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`0a58d6d`](https://github.com/azoila/openmdm/commit/0a58d6de0641c095af46cb55e871c5dafab7dff5)]:
  - @openmdm/core@0.8.0

## 0.4.1

### Patch Changes

- [#9](https://github.com/azoila/openmdm/pull/9) [`ff0ec7f`](https://github.com/azoila/openmdm/commit/ff0ec7f545f97b2ed3620ceb542ef318ba52533c) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Fix device enrollment signature divergence + add critical-path test coverage.

  **Bug fix (wire break):** `@openmdm/core`'s `verifyEnrollmentSignature()` used
  the canonical form `${identifier}:${timestamp}`, while `@openmdm/client`'s
  `generateEnrollmentSignature()` used a 9-field pipe-delimited form
  `[model, manufacturer, osVersion, serialNumber, imei, macAddress, androidId, method, timestamp].join('|')`.
  The two formats produce completely different HMACs, so any device using
  `@openmdm/client` to enroll against a server with `enrollment.deviceSecret`
  configured would **always fail** with `EnrollmentError: Invalid enrollment
signature`.

  The server now uses the same 9-field form as the client. This is the
  stronger signature (commits to the entire device-identity payload, not just
  the identifier) and matches the client without a client code change. For
  any device that enrolled against a pre-fix server with a configured
  `deviceSecret`, re-enrollment is required — but `@openmdm/client` users
  could not successfully enroll at all in practice, so there is no breaking
  upgrade path for real deployments.

  `verifyEnrollmentSignature()` is now exported from `@openmdm/core` for
  integrators who handle enrollment outside the default `mdm.enroll()` flow.
  `generateEnrollmentSignature()` is now exported from `@openmdm/client` so
  test suites and custom agents can reuse it.

  **New test coverage** — 59 new tests across critical-path code:

  - `packages/core/tests/enrollment-signature.test.ts` — contract test that
    imports both sides (core `verifyEnrollmentSignature` + client
    `generateEnrollmentSignature`) and asserts they agree on a shared
    fixture. This is the test that would have caught the bug.
  - `packages/core/tests/webhooks.test.ts` — HMAC signing, `sha256=` header
    format, timing-safe verify, 4xx-no-retry, 429/5xx retry, network-error
    retry, wildcard event matching, custom header pass-through, disabled
    endpoint skip.
  - `packages/core/tests/agent-protocol.test.ts` — `wantsAgentProtocolV2()`
    strict `'2'` equality (including whitespace + future version rejection),
    envelope builders, wire constant stability.
  - `packages/adapters/hono/tests/agent-envelope.test.ts` — v1↔v2 branching
    in `agentOkResponse`, `agentFailResponse`, `isAgentV2`, including the
    `reauth→401`, `unenroll→404`, `retry→503` legacy status mapping.
  - `packages/adapters/hono/tests/device-auth.test.ts` — integration test
    that mounts `honoAdapter()` against a mocked MDMInstance and fires
    requests at `/agent/heartbeat`, asserting the exact invariant that
    caused the original production auto-unenroll bug: a bad token becomes
    `reauth` under v2, NEVER `unenroll`.

  Vitest is now wired up in `@openmdm/hono` (config + test script). CI via
  turbo automatically picks up any workspace with a `test` script, so no
  workflow changes needed.

  Test totals: 35 → 94 passing across 7 files.

- Updated dependencies [[`ff0ec7f`](https://github.com/azoila/openmdm/commit/ff0ec7f545f97b2ed3620ceb542ef318ba52533c)]:
  - @openmdm/core@0.7.0

## 0.4.0

### Minor Changes

- [`41b87bd`](https://github.com/azoila/openmdm/commit/41b87bd6f71b54fba4a9a67e6d8443006a685c98) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - feat(agent-protocol): introduce wire-protocol v2 with unified response envelope

  Every `/agent/*` endpoint now supports a single response shape that
  lets the agent make exactly one decision per request. The envelope
  carries an `action` field — `none`, `retry`, `reauth`, or `unenroll` —
  and the client side has one handler per action. This replaces the
  implicit "interpret HTTP status" contract that made transient 401/404
  responses indistinguishable from "you are really unenrolled", which
  was the root cause of the auto-unenroll behavior seen in production
  fleets.

  Agents opt into v2 by sending the header `X-Openmdm-Protocol: 2` on
  every request. When the header is absent the server falls back to
  the legacy v1 behavior (bare JSON on success, `HTTPException`-based
  error codes) so existing fleets keep working during a rollout.

  ### `@openmdm/core`

  - New module `agent-protocol` exporting:
    - Types `AgentAction` and `AgentResponse<T>`.
    - Helpers `agentOk(data)`, `agentFail(action, message?)`.
    - `wantsAgentProtocolV2(headerValue)` and the header/version
      constants.

  ### `@openmdm/hono`

  - New module `agent-envelope` exporting Hono helpers
    `agentOkResponse`, `agentReauth`, `agentUnenroll`, `agentRetry`,
    `agentFailResponse`, `isAgentV2`.
  - `deviceAuth` middleware now emits an HTTP 200 envelope with
    `action: "reauth"` under v2 instead of throwing `HTTPException(401)`.
    Under v1 the legacy 401 is preserved unchanged.
  - All `/agent/*` endpoints route their response through
    `agentOkResponse`, which serves the envelope under v2 and the
    existing flat shape under v1.
  - `/agent/config` now emits `action: "unenroll"` when the device row
    is genuinely absent (after the token was already validated) —
    the narrow case where terminal local action is correct.

  ### Not in this release

  - Hardware-rooted identity (Phase 2b) — the enrollment flow still
    derives `enrollmentId` from the first available hardware identifier.
  - Short-lived access + refresh token flow (Phase 2c) — tokens are
    still single-stage JWTs.

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
