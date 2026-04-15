# @openmdm/drizzle-adapter

## 0.5.0

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

## 0.4.0

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

- Updated dependencies [[`0a58d6d`](https://github.com/azoila/openmdm/commit/0a58d6de0641c095af46cb55e871c5dafab7dff5)]:
  - @openmdm/core@0.8.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`ff0ec7f`](https://github.com/azoila/openmdm/commit/ff0ec7f545f97b2ed3620ceb542ef318ba52533c)]:
  - @openmdm/core@0.7.0

## 0.3.1

### Patch Changes

- [`c713954`](https://github.com/azoila/openmdm/commit/c71395403cb24b136e54a7d98662a7f599f1297a) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - fix: Return 404 instead of 500 when command not found on ack/complete/fail

  When a device is freed via the admin API, FK CASCADE deletes associated commands.
  If the device agent then tries to ack or complete a deleted command, the server
  crashed with `TypeError: Cannot read properties of null (reading 'deviceId')`.

  - Add `CommandNotFoundError` class (404 status code)
  - Add null checks in `acknowledge()`, `complete()`, `fail()`, `cancel()`
  - Fix unsafe cast in drizzle adapter `updateCommand()` return type
  - Change `DatabaseAdapter.updateCommand` return type to `Command | null`

- Updated dependencies [[`41b87bd`](https://github.com/azoila/openmdm/commit/41b87bd6f71b54fba4a9a67e6d8443006a685c98), [`c713954`](https://github.com/azoila/openmdm/commit/c71395403cb24b136e54a7d98662a7f599f1297a)]:
  - @openmdm/core@0.6.0

## 0.3.0

### Minor Changes

- [#6](https://github.com/azoila/openmdm/pull/6) [`997236f`](https://github.com/azoila/openmdm/commit/997236fca5bb2311b4e736b552500aacab6c82d8) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - feat: Add agent versioning and app version tracking

  **New Features:**

  - Added `agentVersion` field to Device interface and schema for tracking MDM agent versions on devices
  - Added `updateAgent` command type to the CommandType union for agent self-update operations
  - Added `mdm_app_versions` table for tracking app version history and supporting rollback operations
  - Added `mdm_rollbacks` table for tracking rollback operation history and status

  **Drizzle Adapter:**

  - Implemented optional `listAppVersions`, `createAppVersion`, `setMinimumVersion`, `getMinimumVersion` methods
  - Implemented optional `createRollback`, `updateRollback`, `listRollbacks` methods
  - Added `rollbackStatusEnum` enum for rollback status tracking
  - Added relations for new tables to existing schema

  **Schema Updates:**

  - Extended `UpdateDeviceInput` to include optional `agentVersion` field
  - Added proper column definitions with indexes for the new tables

### Patch Changes

- Updated dependencies [[`997236f`](https://github.com/azoila/openmdm/commit/997236fca5bb2311b4e736b552500aacab6c82d8)]:
  - @openmdm/core@0.4.0

## 0.2.2

### Patch Changes

- [#4](https://github.com/azoila/openmdm/pull/4) [`bf9793b`](https://github.com/azoila/openmdm/commit/bf9793b056d83093068dea26d0dd9be813844077) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - feat(cli): add schema generator command (better-auth style)

  - Add `openmdm generate` command for generating database schemas
  - Support Drizzle ORM schema generation (PostgreSQL, MySQL, SQLite)
  - Support raw SQL schema generation (PostgreSQL, MySQL, SQLite)
  - Interactive prompts for adapter and provider selection
  - Resolves drizzle-kit ESM compatibility by generating schema files users run with their own tooling

  Migration workflow now follows better-auth pattern:

  1. `npx openmdm generate --adapter drizzle --provider pg`
  2. `npx drizzle-kit generate`
  3. `npx drizzle-kit migrate`

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
