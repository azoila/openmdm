# @openmdm/hono

## 1.1.2

### Patch Changes

- Updated dependencies [[`72d3cd6`](https://github.com/azoila/openmdm/commit/72d3cd6e515fc2e8e3cafc6c2d4750a4a781622a)]:
  - @openmdm/core@0.11.1

## 1.1.1

### Patch Changes

- Updated dependencies [[`5378703`](https://github.com/azoila/openmdm/commit/537870352eb58606c6af581c073ab9245cb1d71b)]:
  - @openmdm/core@0.11.0

## 1.1.0

### Minor Changes

- [#29](https://github.com/azoila/openmdm/pull/29) [`d141b72`](https://github.com/azoila/openmdm/commit/d141b72f54ae16b6064e5b12a38ac92ee7d02d18) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Fix the client↔server protocol break, close a device-auth bypass, and rate-limit enrollment.

  **Breaking (security fix): a bare `X-Device-Id` header no longer authenticates.**
  `deviceAuth` previously accepted the header as sufficient identity when no bearer
  token was present. Device ids are enumerable, so anyone could read any device's
  commands and config by sending the header. A verified device token is now the only
  accepted identity. Agents that relied on the header must send their token.

  **New agent routes.** `@openmdm/client` called four endpoints the adapter never
  served, so token refresh, command polling, event reporting, and push-token removal
  all 404'd against the shipped server:

  - `POST /agent/refresh-token` — exchanges the current token for a fresh one. Not
    behind `deviceAuth` by design: it accepts a recently-expired token (within the
    server's renewal grace window) so an agent that slept past expiry can recover.
    The signature is still fully verified, and unenrolled/blocked devices are refused.
  - `GET /agent/commands/pending` — poll commands without a full heartbeat.
  - `POST /agent/events` — agent-reported events (crashes, kiosk exit attempts).
  - `DELETE /agent/push-token` — remove one provider's token, or all of them.

  **Rate limiting** on the unauthenticated enrollment routes (`POST /agent/enroll`,
  `GET /agent/enroll/challenge`), enabled by default at 60 requests/60s per client IP.
  It is in-memory and per-process, so with N replicas the effective limit is N × max;
  pass `rateLimit: false` if your reverse proxy already handles this.

  **Client**: `refreshToken()` is now exposed on `MDMClient` for proactive rotation, and
  the automatic 401 → refresh → retry path now uses the device token rather than a
  `refreshToken` field the server never issued.

  A new contract test suite drives the real client against the real adapter over HTTP,
  so this class of divergence fails CI instead of shipping.

- [#36](https://github.com/azoila/openmdm/pull/36) [`5d53670`](https://github.com/azoila/openmdm/commit/5d53670c1ab09fbbf330a35ee8dcd0e43e041082) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Desired state, device lifecycle, canonical app inventory, and update enforcement.

  Four features, one system. Desired state is the primitive; the rest are built on it.

  **Desired state (`devices.setDesiredState`).** A command is an _event_: miss it and the intent
  is gone. Desired state is a _fact_ — it rides on every heartbeat until the device reports it has
  applied that version. "Put this device in maintenance mode" belongs here, not in a command: a
  maintenance flag that lives only client-side, or only in a command the device never received,
  describes a device nobody can account for. `null` in a patch **deletes** the key rather than
  storing null (unset is not the same fact as "set to off"), and re-submitting an unchanged state
  does not bump the version — an operator clicking a toggle that is already in position must not
  make the whole fleet re-report convergence for a change that never happened.
  `devices.getConvergence()` answers whether the device has caught up; `device.converged` fires
  when it does.

  **Device lifecycle.** `devices.update` accepted any status from anywhere, so a device could go
  from `unenrolled` straight back to `enrolled` without ever re-enrolling. Status writes now go
  through a transition table. `devices.delete` **hard-DELETE'd the row**, cascading away the
  device's entire command and audit history — so the one question you ask after a bad unenroll
  ("what happened to this device?") was the one question the data could no longer answer. It now
  tombstones (`deletedAt`); the device reads as gone to callers and is filtered out of listings,
  but the history survives. Pass `{ hard: true }` for a genuine erase.

  **Two-phase unenroll.** `beginUnenroll()` arms the device (`unenrolling`) and tells it to go;
  `completeUnenroll()` finishes when it confirms. Flipping straight to `unenrolled` is what
  strands fleets: the row says the device left while the device — which never received the
  message — keeps heartbeating at a server that no longer recognises it. `cancelUnenroll()` calls
  it off.

  **Canonical app inventory.** App versions lived only inside the `installed_apps` JSON blob, so
  "which devices run the broken build?" meant walking JSON for every device in the fleet, and a
  reconcile loop could not express its central question in SQL at all. A new `mdm_device_apps`
  table holds one row per (device, package) with observed _and_ desired versions. The JSON blob
  remains the full inventory; this is the queryable form of the facts we act on.
  `device.appVersionChanged` fires on a diff — versions used to be overwritten silently, so "when
  did this fleet start running the broken build?" had no answer.

  **Update enforcement (`mdm.updates`).** Issuing an `installApp` command is not the same as an
  app being installed: the command can be delivered, acknowledged, and still leave the device on
  the old version. Command durability covers _delivery_; nothing covered _outcome_.
  `updates.reconcile()` compares observed against desired, re-issues with exponential backoff, and
  escalates — once — when a device keeps taking the command without moving.
  `updates.setDesiredAppVersion()` supports staged rollouts, bucketed by `hash(deviceId + version)`:
  salting with the version is deliberate, because hashing the device id alone would make the same
  unlucky 10% of the fleet the canary for every release forever. A device that has never installed
  the app is treated as version `0.0.0`, not skipped — otherwise the engine is upgrade-only and a
  freshly provisioned device silently never gets the app it exists to run.

  Schema: `mdm_devices` gains `desired_state` (jsonb), `desired_state_version`,
  `reported_state_version`, `state_reported_at`, `deleted_at`; the device status enum gains
  `unenrolling`; the `unenroll` command type is new; and `mdm_device_apps` is added. Existing rows
  take the defaults — no backfill.

### Patch Changes

- Updated dependencies [[`cdac7e1`](https://github.com/azoila/openmdm/commit/cdac7e14bd85721d642b9f75c1172ee8d14f0fec), [`c2c16ab`](https://github.com/azoila/openmdm/commit/c2c16ab77d7293a8d190f46ecd5f86bcf6b8704c), [`8ecf8ca`](https://github.com/azoila/openmdm/commit/8ecf8ca5902ce20523635d65a019bcb8d5aaad6e), [`5d53670`](https://github.com/azoila/openmdm/commit/5d53670c1ab09fbbf330a35ee8dcd0e43e041082), [`d141b72`](https://github.com/azoila/openmdm/commit/d141b72f54ae16b6064e5b12a38ac92ee7d02d18), [`1fa4bee`](https://github.com/azoila/openmdm/commit/1fa4bee350c5934ebb57d6c578bb5106a9853740), [`bd64cd7`](https://github.com/azoila/openmdm/commit/bd64cd711505e8724ead5a76af6a1e8c1449c558)]:
  - @openmdm/core@0.10.0

## 1.0.0

### Major Changes

- [#15](https://github.com/azoila/openmdm/pull/15) [`8de33da`](https://github.com/azoila/openmdm/commit/8de33da48b8dd3650dfb4cc5d1d0d0f33ffe2434) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Tenant + RBAC audit findings, fixes for the two most dangerous holes.

  See `docs/proposals/tenant-rbac-audit.mdx` for the full file-and-line
  audit. Short version: the `TenantManager`, `AuthorizationManager`, and
  `AuditManager` exist as façades but are never consulted by the
  resource managers or the HTTP adapter. Core resources (`Device`,
  `Policy`, `Command`, `Application`, `Group`, `MDMEvent`) have no
  `tenantId` column in the type system or the database schema, so
  `mdm.devices.list()` is fleet-wide regardless of tenant context.

  This changeset cannot fix the architectural gap in one pass — it spans
  type system, schema, every manager, and every integration point. What
  it ships instead: **loud-failure backstops** for the two most dangerous
  silent-data-leak paths, plus a comprehensive audit document users can
  read before planning a multi-tenant deployment.

  ### `@openmdm/hono` — BREAKING

  `honoAdapter({ enableAuth })` now defaults to `true` instead of
  `false`. Admin routes on `/mdm/devices`, `/mdm/policies`,
  `/mdm/commands`, etc. previously accepted every request when the
  caller did not explicitly set `enableAuth: true` — a footgun that the
  Quick Start and Installation docs never warned about.

  Two startup warnings fire from the adapter's structured logger:

  1. **`enableAuth: true` but `mdm.config.auth` is missing.** The
     middleware runs but has no `getUser(c)` resolver, so every request
     still passes through. The warning payload names exactly what to
     configure.
  2. **`enableAuth: false` explicitly.** The host opted out, probably
     because a parent router already authenticates every request. The
     warning is a one-line acknowledgement — grep-able in startup logs
     so operators can verify it is intentional.

  Hosts that had been running without admin auth by accident will now
  see a `warn`-level log at boot naming the missing piece. Hosts that
  already pass `enableAuth: true` plus `config.auth` see no change.
  Hosts that wrap OpenMDM in a parent router and authenticate upstream
  should add `enableAuth: false` to opt out cleanly.

  This is a major bump because the default behavior changes in a way
  that affects the security posture of every deployment that did not
  previously configure auth.

  ### `@openmdm/core` — minor

  **Dashboard fallback assertions.** `mdm.dashboard.getStats(tenantId)`
  previously forwarded the tenantId to a matching DB adapter method if
  one existed, and silently discarded it otherwise. The Drizzle adapter
  does not implement any of the tenant-scoped dashboard methods, so
  `mdm.dashboard.getStats('acme')` silently returned fleet-wide stats
  — a clean path to leaking another tenant's device counts onto the
  page rendering for tenant A.

  New helper `assertNoTenantScopeRequested(tenantId, methodName)` in
  `packages/core/src/dashboard.ts` throws a descriptive error when a
  caller passes a `tenantId` to a fallback path that cannot honor it.
  Callers that want global stats pass `undefined` and everything keeps
  working. Callers that want tenant stats get a loud error pointing at
  the `DatabaseAdapter` method they need to implement. This is a
  backstop, not a fix for the root cause — once core resources gain a
  `tenantId` column the fallback paths can filter themselves and the
  assertion becomes dead code.

  Applied to all five dashboard methods: `getStats`,
  `getDeviceStatusBreakdown`, `getEnrollmentTrend`,
  `getCommandSuccessRates`, `getAppInstallationSummary`.

  ### New tests (126 → 154 total)

  - **`packages/core/tests/tenant-isolation.pinning.test.ts`** (9 tests)
    — pinning tests that document the current (broken) state of tenant
    isolation and authorization enforcement at the manager layer. These
    tests intentionally assert _wrong_ behavior as the baseline so a
    future refactor cannot silently make it worse. When the
    architectural fix lands, these tests break and are rewritten.
  - **`packages/adapters/hono/tests/admin-auth-default.test.ts`**
    (5 tests) — locks in the `enableAuth: true` default and the two
    startup warning codes (`auth-enabled-but-not-configured` and
    `auth-explicitly-disabled`) so the footgun cannot silently return.
  - **`packages/core/tests/tenant-isolation.pinning.test.ts`** also
    covers the dashboard backstop (6 tests): global stats still work
    with `undefined` tenantId; all five methods throw with a descriptive
    error when passed a tenantId on an adapter that cannot scope.

  ### New docs page

  `docs/content/docs/proposals/tenant-rbac-audit.mdx` — the full audit:
  file:line refs for every finding, what is fixed in this PR, what is
  _not_ fixed, the follow-up issues that would close the architectural
  gap, and three realistic options for running OpenMDM in a multi-tenant
  deployment _today_ (one instance per tenant, shared instance with
  host-side filtering via `metadata`, or wait for the architectural fix).

  ### Migration

  Hosts that currently rely on `enableAuth` being false by default:

  - **Recommended:** configure `mdm.config.auth` with a `getUser(c)`
    resolver and (optionally) `isAdmin(user)`. This is the path the
    docs always recommended.
  - **Escape hatch:** pass `enableAuth: false` explicitly to
    `honoAdapter()`. You will get a startup warning, which is the
    point.

  Nothing at the API surface changes — only the default for one option.

### Minor Changes

- [#17](https://github.com/azoila/openmdm/pull/17) [`00ed63f`](https://github.com/azoila/openmdm/commit/00ed63fd0be0259786cbbc29285e34f7ea77f0c0) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Phase 2b device-pinned-key enrollment (server side).

  Adds a new enrollment path in which the device generates an ECDSA
  P-256 keypair in its own Android Keystore, submits the public key
  alongside an ECDSA signature over a challenge-bound canonical
  message, and the server pins that public key on the device row on
  first successful enrollment. Subsequent re-enrollments for the same
  device MUST present a signature that verifies against the pinned
  key — which is cryptographic proof of identity continuity and is
  the industry-standard replacement for shared HMAC secrets.

  **Why this matters for non-GMS fleets.** Full Google hardware
  attestation requires CTS-certified Android + a manufacturer whose
  intermediate CA is signed by Google's hardware root. Most
  low-cost vehicle-kiosk Android boards (ZK-R32D et al) do not meet
  either requirement. This implementation deliberately does NOT
  depend on Google's attestation infrastructure — it relies only on
  the device's local Keystore to generate and hold a private key,
  which every Android with a software Keystore supports. Hardware
  Keystore is still used when available (and should be preferred
  via `setIsStrongBoxBacked` on the agent side), but it is not a
  hard requirement.

  ### `@openmdm/core` [minor]

  **New module** `packages/core/src/device-identity.ts`:

  - `importPublicKeyFromSpki(spkiBase64)` — parse and validate an
    EC P-256 SPKI public key via Node's built-in `crypto`. Throws
    `InvalidPublicKeyError` on non-EC keys, wrong curves, malformed
    bytes.
  - `verifyEcdsaSignature(key, message, sigBase64)` — verify a
    DER-encoded ECDSA-SHA256 signature. Never throws on bad
    signatures, throws only on invalid public keys.
  - `canonicalEnrollmentMessage(parts)` — build the canonical
    signed form for enrollment. Eleven pipe-delimited fields,
    starting with the public key and ending with the challenge.
  - `canonicalDeviceRequestMessage(parts)` — build the canonical
    signed form for post-enrollment requests. Four pipe-delimited
    fields (deviceId, timestamp, body, nonce).
  - `verifyDeviceRequest(opts)` — high-level primitive any consumer
    can import and use to verify a signed request against the
    pinned public key. Returns a tagged union so callers can
    distinguish `not-found`, `no-pinned-key`, and `signature-invalid`.
  - New error types: `InvalidPublicKeyError`, `PublicKeyMismatchError`,
    `ChallengeInvalidError`.

  **Type extensions**:

  - `Device` gains `publicKey?: string | null` and
    `enrollmentMethod?: 'hmac' | 'pinned-key' | null`.
  - `EnrollmentRequest` gains `publicKey?` and `attestationChallenge?`
    fields. When `publicKey` is present the server runs the
    pinned-key path; otherwise it falls back to HMAC.
  - `UpdateDeviceInput` gains `publicKey` and `enrollmentMethod` so
    the enroll flow can pin them.
  - `EnrollmentConfig` gains a `pinnedKey?: PinnedKeyConfig` block
    with `required` (opt-in enforcement) and `challengeTtlSeconds`
    (default 300).
  - `EnrollmentChallenge` — persisted single-use nonce record.
  - `DeviceIdentityVerification` — tagged union returned by
    `verifyDeviceRequest`.

  **`DatabaseAdapter` optional methods** for challenge storage:
  `createEnrollmentChallenge`, `findEnrollmentChallenge`,
  `consumeEnrollmentChallenge`, `pruneExpiredEnrollmentChallenges`.
  Adapters that don't implement these are still valid; the
  pinned-key path detects the missing methods and returns 503 at the
  challenge endpoint rather than silently handing out challenges it
  can't later verify.

  **`mdm.enroll()` rewrite**:

  - Branches on `publicKey` presence per-request — backwards
    compatible for fleets still on the HMAC path.
  - On the pinned-key path: imports the submitted SPKI (reject
    malformed), atomically consumes the challenge BEFORE signature
    verification (prevents races), verifies the ECDSA signature
    over `canonicalEnrollmentMessage(...)`.
  - On re-enrollment for an already-pinned device, requires the
    submitted public key to match the pinned one exactly or
    throws `PublicKeyMismatchError`. No automatic rebind.
  - On first pinned-key enrollment the public key is stored on the
    device row via `updateDevice` with `enrollmentMethod: 'pinned-key'`.
  - When `enrollment.pinnedKey.required === true`, requests without
    `publicKey` are rejected — the escape hatch is explicitly
    flipping it back to `false`.

  **Zero new dependencies.** Uses `node:crypto`'s built-in
  `createPublicKey({ format: 'der', type: 'spki' })` and
  `verify('sha256', ...)`, which handle DER-encoded ECDSA
  signatures produced by the Android Keystore natively.

  ### `@openmdm/drizzle-adapter` [minor]

  - New `mdm_enrollment_challenges` table in the Postgres schema
    (`packages/adapters/drizzle/src/postgres.ts`). Composite
    PRIMARY KEY on `challenge`; indexed on `expires_at` for the
    prune path.
  - New `public_key TEXT NULL` and `enrollment_method VARCHAR(20) NULL`
    columns on `mdm_devices`.
  - New `DrizzleAdapterOptions.tables.enrollmentChallenges` field,
    optional, required for the pinned-key path to work.
  - Four new adapter methods (`createEnrollmentChallenge`, `find*`,
    `consume*`, `pruneExpired*`) implemented against Drizzle's
    insert/select/update/delete. The critical one is `consume*`,
    which uses `UPDATE ... WHERE consumed_at IS NULL RETURNING *`
    to guarantee single-use atomicity even under concurrent
    requests — the e2e test fires three concurrent consumes on the
    same challenge and asserts exactly one wins.
  - `toDevice` transform updated to hydrate `publicKey` and
    `enrollmentMethod` fields.
  - `updateDevice` accepts the new fields.
  - Migration required: run `drizzle-kit generate && drizzle-kit migrate`
    after upgrading.

  ### `@openmdm/hono` [minor]

  - New route `GET /agent/enroll/challenge` — unauthenticated by
    design, returns a single-use 32-byte challenge + `expiresAt` +
    `ttlSeconds`. Returns 503 when the underlying adapter does not
    implement challenge storage, rather than silently returning a
    challenge the device will later fail to redeem.
  - Honors `enrollment.pinnedKey.challengeTtlSeconds` from the MDM
    config; defaults to 300 seconds.

  ### Tests: 154 → 185

  - **`packages/core/tests/device-identity.test.ts`** (19 tests):
    generates real EC P-256 keypairs via Node crypto and exercises
    `importPublicKeyFromSpki`, `verifyEcdsaSignature`,
    `canonicalEnrollmentMessage`, `canonicalDeviceRequestMessage`.
    Covers the security-critical paths: wrong curve rejected,
    RSA rejected, malformed SPKI throws `InvalidPublicKeyError`,
    wrong message rejected, wrong key rejected, malformed DER
    signature returns false without throwing, pre-imported
    `KeyObject` works on hot paths, canonical-form pinning.
  - **`packages/adapters/hono/tests/enroll-challenge.test.ts`**
    (5 tests): challenge endpoint returns a fresh challenge,
    persists it through the adapter, respects custom
    `challengeTtlSeconds`, returns 503 when storage is missing,
    produces a unique challenge per call, is unauthenticated.
  - **`tests/e2e/tests/enrollment-challenge.e2e.test.ts`** (7 tests,
    run against real Postgres): `create`/`find` round-trip, atomic
    single-use consume, **concurrent-consume race** (three parallel
    consumes → exactly one winner), `consumeEnrollmentChallenge`
    returns null for unknown challenges, `pruneExpiredEnrollmentChallenges`
    deletes only expired unconsumed rows while preserving consumed
    rows for audit.

  ### Docs

  - Rewrote `docs/content/docs/concepts/enrollment.mdx` to cover
    both paths side-by-side, with the full pinned-key sequence
    diagram and the continuity property explained.
  - New `docs/content/docs/proposals/phase-2b-rollout.mdx` tracks
    the Android-side work required to actually turn this on
    in production, including specific gaps in the upstream
    openmdm-android agent that block rollout:
    - Fix the broken HMAC canonical form in
      `SignatureGenerator.kt:25` (existing bug, not new).
    - Add `X-Openmdm-Protocol: 2` header and envelope handling.
    - Add OkHttp `CertificatePinner` — **must land in the same
      release** as pinned-key enrollment, or the feature is a net
      security regression because a MITM on first enroll could
      substitute the attacker's public key.
    - Keystore keypair generation with StrongBox fallback.
    - Hardware feature detection for pre-flight.

  ### Cross-service reuse

  The same `verifyDeviceRequest` primitive is exported so other
  services built on OpenMDM (midiamob's own `deviceValidation.ts`,
  any custom backend) can verify signed requests against the same
  pinned key without re-implementing ECDSA or SPKI parsing. One
  device identity, many consumers. This is documented in the
  "Reusing the same identity outside OpenMDM" section of the
  enrollment concept page.

  ### Migration

  No breaking changes at the API surface. The HMAC path continues
  to work unchanged — fleets that don't configure
  `enrollment.pinnedKey` see the same behavior as before. To adopt
  the new path:

  1. Upgrade `@openmdm/core`, `@openmdm/drizzle-adapter`, `@openmdm/hono`.
  2. Run `drizzle-kit generate && drizzle-kit migrate` to pick up
     the schema changes.
  3. Add `pluginStorage: mdmSchema.mdmPluginStorage` and
     `enrollmentChallenges: mdmSchema.mdmEnrollmentChallenges` to
     your `drizzleAdapter({ tables })` options.
  4. Add `enrollment: { pinnedKey: { required: false } }` to your
     `createMDM()` config — both paths accepted simultaneously.
  5. Ship an Android agent update that generates a Keystore keypair
     and signs enrollments with it. See the rollout proposal for
     the step-by-step.
  6. Once every device has re-enrolled on the new path, flip
     `required: true`.

  Verified: `pnpm -r typecheck` clean (12 packages + tests/e2e),
  `pnpm test` 167 passing (126 core + 41 hono), `pnpm test:e2e`
  18 passing against Postgres compose, `pnpm --filter @openmdm/docs
build` compiles all 12 MDX pages.

### Patch Changes

- Updated dependencies [[`00ed63f`](https://github.com/azoila/openmdm/commit/00ed63fd0be0259786cbbc29285e34f7ea77f0c0), [`8de33da`](https://github.com/azoila/openmdm/commit/8de33da48b8dd3650dfb4cc5d1d0d0f33ffe2434)]:
  - @openmdm/core@0.9.0

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
