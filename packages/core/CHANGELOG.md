# @openmdm/core

## 0.10.0

### Minor Changes

- [#35](https://github.com/azoila/openmdm/pull/35) [`cdac7e1`](https://github.com/azoila/openmdm/commit/cdac7e14bd85721d642b9f75c1172ee8d14f0fec) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Make `openmdm generate` emit a schema that actually works.

  **The generated SQL never ran.** Tables were emitted in declaration order, and `mdm_devices` —
  declared first — carries a foreign key to `mdm_policies`, declared after it. Postgres rejected
  the very first statement with `relation "mdm_policies" does not exist`. The SQL this generator
  produced had never successfully built a database, and nothing caught it because nothing ever
  executed it. Tables are now topologically sorted by their foreign-key dependencies (all three
  dialects), and a new e2e test pipes the generated schema into a real Postgres on every CI run.

  **The declared schema was missing tables and columns the adapter requires.** `mdmSchema` in
  core is the single source the CLI generates from, and it had drifted from the runtime schema:
  no `mdm_enrollment_challenges` (required for device-pinned-key enrollment), no
  `mdm_policy_versions`, and missing `public_key`, `enrollment_method`, `tenant_id`,
  `applied_policy_version`, and every command-durability column. Consumers who ran
  `openmdm generate` got a schema the adapter could not run against, and hand-patched the
  generated file — carrying a "do not regenerate this" warning in their own repo.

  A **parity test** now asserts every runtime table and column is declared, so this drifts into a
  red build rather than a support ticket.

  **`openmdm migrate` no longer prints stale hand-written SQL.** It shipped a ~180-line blob
  maintained by hand inside the command, which declared `VARCHAR(255)` primary keys where the
  schema says `varchar(36)` and omitted four tables entirely. Both the schema and the rollback are
  now derived from `mdmSchema`, so they cannot drift again. (The command still only prints SQL and
  keeps no migration history — use `openmdm generate` with drizzle-kit for that.)

- [#30](https://github.com/azoila/openmdm/pull/30) [`c2c16ab`](https://github.com/azoila/openmdm/commit/c2c16ab77d7293a8d190f46ecd5f86bcf6b8704c) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Make command delivery durable: idempotency, expiry, retry, and dead-lettering.

  Previously `sendCommand` pushed once and, if the push failed, silently left the command
  `pending` with no record of the attempt and nothing to retry it. A command could sit stuck
  forever, and a `factoryReset` queued for a device that stayed offline for months would fire
  the moment it came back. The `MessageQueueManager` had retry and expiry logic, but
  `sendCommand` never used it — they were two disconnected systems.

  **Idempotency.** `SendCommandInput.idempotencyKey` deduplicates sends per device: a repeat
  returns the existing command instead of queueing the operation twice — what you want when a
  retrying HTTP client double-posts "wipe this device". The Drizzle adapter implements this as
  `INSERT ... ON CONFLICT DO NOTHING` against a partial unique index on
  `(device_id, idempotency_key)`, so concurrent senders race in the database rather than in
  application code. Adapters that don't implement `createCommandIdempotent` fall back to
  find-then-create, which narrows the duplicate window without closing it.

  **Expiry.** Commands carry `expiresAt`, defaulting to `config.commands.defaultTtlSeconds`
  (7 days; set `0` for no default). Expired commands are withheld from `getPending` even if the
  reaper hasn't run, and `commands.expireStale()` reaps them to a new `expired` status.

  **Retry and dead-lettering.** A failed push now records the attempt and leaves the command
  retryable. `commands.retryPending()` re-pushes commands whose exponential backoff has elapsed
  (`config.commands.retryBackoffSeconds`, default 60s) and dead-letters those that exhaust
  `maxAttempts` (default 5) to `failed` with a `DELIVERY_EXHAUSTED` error, emitting
  `command.failed`. Call both sweeps from a scheduled job.

  **Fixed: `transaction()` was not transactional.** The Drizzle adapter opened a transaction and
  then ran the callback against the _outer_ connection, so nothing inside it participated — a
  partial failure left half-written state committed. The transaction handle now flows through
  `AsyncLocalStorage`, so adapter calls made inside the callback join the transaction and roll
  back together. Nested calls join the enclosing transaction.

  New `DatabaseAdapter` optional methods: `createCommandIdempotent`, `findCommandByIdempotencyKey`,
  `expireCommands`, `listRetryableCommands`. New `CommandStatus` value: `expired`. New
  `mdm_commands` columns: `idempotency_key`, `expires_at`, `attempt_count`, `max_attempts`,
  `last_attempt_at` — existing rows take the defaults, so no backfill is required.

- [#33](https://github.com/azoila/openmdm/pull/33) [`8ecf8ca`](https://github.com/azoila/openmdm/commit/8ecf8ca5902ce20523635d65a019bcb8d5aaad6e) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Make push delivery honest, and recover commands a device acked then dropped.

  **MQTT no longer reports success for a message the device never acknowledged.** On ack
  timeout the adapter resolved `{ success: true }` — so a command pushed to a device that had
  been offline for a week was reported delivered, marked `sent`, and never retried. It now
  resolves `{ success: false, error: 'ACK_TIMEOUT: ...' }`, which lets the retry sweep do its
  job. Configurable via `ack.timeoutMs`; `ack.treatTimeoutAsSuccess` restores the old behaviour
  for fleets whose agents genuinely do not publish acks.

  **MQTT presence tracking actually works.** `mqttExtendedAdapter` spread the base adapter and
  then built its _own_ empty presence map — one the broker subscription never wrote to. So
  `getDeviceStatus()` always returned `undefined`, `getOnlineDevices()` always returned `[]`, and
  `isDeviceOnline()` always returned `false`, regardless of how many devices were connected. An
  operator asking "which devices are online?" was told "none", forever. Both adapters now read
  the same state by construction.

  **MQTT `disconnect()` is real.** It used to only log. The client, its reconnect timer, and every
  pending-ack timer leaked for the life of the process; callers awaiting an ack hung forever. It
  now closes the connection and settles in-flight waiters as failures. Added to the `PushAdapter`
  contract as an optional method.

  **MQTT `reconnect.maxRetries` is enforced.** It was declared in the options and wired to nothing,
  so an unreachable broker was retried forever with no way to stop.

  **FCM retries transient failures.** One attempt was all a message ever got, so an FCM hiccup
  (`server-unavailable`, a 503 under load) was reported as permanent. Now retried with exponential
  backoff (`retry.maxAttempts`, default 3). Permanent failures — unregistered token, invalid
  argument — are _not_ retried: they fail identically every time, so retrying only adds latency.

  **Both adapters use the structured logger** instead of `console.*` (29 call sites), so their
  output lands in the host's logging pipeline.

  **New: `commands.sweepStuck()`** closes the ack-then-crash hole. `getPendingCommands` only
  returns `pending`/`sent`, so a device that acknowledged a command and then died mid-execution
  would never be given it again — the command sat `acknowledged` forever. Stuck commands are now
  requeued for re-delivery (or dead-lettered once attempts are exhausted), emitting
  `command.requeued`. Delivery is therefore at-least-once: agents must be idempotent per
  `commandId`. Tune with `config.commands.ackTimeoutSeconds` (default 15 min; `0` disables).

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

- [#29](https://github.com/azoila/openmdm/pull/29) [`d141b72`](https://github.com/azoila/openmdm/commit/d141b72f54ae16b6064e5b12a38ac92ee7d02d18) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Add device-token renewal and revocation, and harden token/enrollment verification.

  - **`mdm.issueDeviceToken(deviceId)`** issues a fresh token for an enrolled device.
    It refuses devices that are `unenrolled` or `blocked`, which makes unenrolling a
    device an effective revocation: a leaked token stays valid only until its own
    expiry and can never be renewed. Consumers previously had to fork core's JWT
    crypto to rotate tokens.
  - **`mdm.verifyDeviceToken(token, { ignoreExpirationWithinSeconds })`** accepts a
    recently-expired token _only_ for renewal, so an agent that was offline past its
    expiry can recover instead of self-unenrolling. Regular request authentication is
    unaffected. Configure the window with `auth.deviceTokenRenewalGraceSeconds`
    (default: 30 days).
  - **Constant-time token signature comparison.** The previous `!==` comparison leaked,
    via response timing, how many leading bytes of a forged signature were correct.
  - **Enrollment timestamp freshness** is now enforced on the HMAC path. The timestamp
    is covered by the signature but was never checked, so a captured enrollment request
    could be replayed indefinitely. Configure with `enrollment.timestampToleranceSeconds`
    (default: 900; set to 0 to disable). The pinned-key path is unaffected — its
    single-use challenge already prevents replay.

- [#32](https://github.com/azoila/openmdm/pull/32) [`1fa4bee`](https://github.com/azoila/openmdm/commit/1fa4bee350c5934ebb57d6c578bb5106a9853740) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Policy versioning, history, rollback, and drift detection.

  Policies mutated in place with no version. Devices have always reported a `policyVersion` in
  every heartbeat, and core never read it — so "is this device running the current policy?" was
  a question the system could not answer. There was no rollout state, no drift detection, no
  history, and no way back to a previous policy after a bad change.

  - **`Policy.version`** — monotonic, starting at 1. Bumped only when `settings` change: renaming
    a policy must not mark the entire fleet as drifted.
  - **History** — every settings change writes an immutable snapshot. `policies.history(id)` and
    `policies.getVersion(id, n)`.
  - **`policies.rollback(id, toVersion)`** — restores earlier settings. It rolls **forward**: the
    restored settings become a _new_ version rather than rewinding the counter. Rewinding would
    make the rollback invisible to a device that had already applied the version being restored —
    it would compare its applied version against an identical number, conclude it was compliant,
    and never re-apply.
  - **Drift detection** — heartbeats now record the reported version. A device behind its policy
    raises `device.policyDrifted` on _every_ heartbeat, not once: a device that never converges
    should keep announcing itself rather than going quiet after a single alert.
  - **Compliance** — `devices.getPolicyCompliance(id)` returns `compliant | pending | unknown |
unassigned`; `policies.getCompliance(id)` returns fleet rollout state with the lagging device
    ids.
  - **New events**: `policy.updated`, `policy.rolledBack`, `device.policyDrifted`.

  **Also fixed: the plugin `validatePolicy` hook was never called.** It has been part of the
  plugin interface all along, so a plugin could declare a policy invalid and be silently ignored.
  It now runs on policy create and update, and a rejection fails the write.

  Schema: `mdm_policies.version`, `mdm_devices.applied_policy_version` / `policy_applied_at`, and
  a new `mdm_policy_versions` table (unique on `(policy_id, version)` — a snapshot is written once
  and never rewritten, so a duplicate is a bug, not a race to tolerate). Existing policies default
  to version 1; no backfill required. Adapters that don't supply a `policyVersions` table keep
  versioning and drift detection and lose only history/rollback.

- [#31](https://github.com/azoila/openmdm/pull/31) [`bd64cd7`](https://github.com/azoila/openmdm/commit/bd64cd711505e8724ead5a76af6a1e8c1449c558) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Enforce tenant isolation, RBAC, and audit logging — `mdm.withContext(...)`.

  `TenantManager`, `AuthorizationManager`, and `AuditManager` all existed, and core never
  called any of them. The default behaviour of every manager method was therefore: return
  **every tenant's** data, check **no** permissions, and record **nothing**. The test suite
  pinned this as known-broken (`tenant-isolation.pinning.test.ts`) rather than fixing it.

  **`mdm.withContext({ tenantId, userId })`** returns a scoped instance with the same manager
  APIs, on which all three concerns are enforced on every call:

  ```typescript
  const scoped = mdm.withContext({ tenantId: "acme", userId: user.id });
  await scoped.devices.list(); // only Acme's devices — filtered in SQL
  await scoped.devices.delete(id); // 'delete:devices' enforced, and audited
  ```

  The **root instance stays unscoped by design** — it is the system caller (enrollment,
  delivery sweeps, single-tenant embeds), where there is no user to authorize and no tenant to
  infer. Anything driven by a user request should go through a scoped instance.

  Three properties worth calling out:

  - **A cross-tenant read is indistinguishable from a miss.** Fetching another tenant's device
    id returns `null`, and mutating it raises `NotFound` — never a distinct authorization
    error, which would confirm the id exists elsewhere.
  - **Tenant scoping fails closed.** A scoped instance built on an adapter that does not
    declare `supportsTenantScoping` throws at construction rather than silently ignoring the
    filter and serving every tenant's rows.
  - **Failed attempts are audited, not just successful ones.** A denied permission and a
    cross-tenant reach are both recorded — an audit trail containing only successes is not much
    of a trail. Reads are not audited by default (they would drown the table).

  `Device`, `Policy`, `Application`, `Group`, and `Command` gain an optional `tenantId`; the
  Drizzle adapter adds a nullable `tenant_id` column (indexed) to each table, persists it on
  create, and filters on it. Existing single-tenant rows keep `NULL` and behave exactly as
  before — no backfill required.

## 0.9.0

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

## 0.8.0

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

## 0.7.0

### Minor Changes

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

## 0.6.0

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

- [`c713954`](https://github.com/azoila/openmdm/commit/c71395403cb24b136e54a7d98662a7f599f1297a) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - fix: Return 404 instead of 500 when command not found on ack/complete/fail

  When a device is freed via the admin API, FK CASCADE deletes associated commands.
  If the device agent then tries to ack or complete a deleted command, the server
  crashed with `TypeError: Cannot read properties of null (reading 'deviceId')`.

  - Add `CommandNotFoundError` class (404 status code)
  - Add null checks in `acknowledge()`, `complete()`, `fail()`, `cancel()`
  - Fix unsafe cast in drizzle adapter `updateCommand()` return type
  - Change `DatabaseAdapter.updateCommand` return type to `Command | null`

## 0.4.0

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

## 0.3.0

### Minor Changes

- Add enterprise SDK features:

  - **Multi-tenancy** - TenantManager for customer/organization isolation
  - **RBAC** - AuthorizationManager with granular permission system
  - **Audit logging** - AuditManager for compliance and security tracking
  - **Scheduling** - ScheduleManager for scheduled tasks with cron support
  - **Message queue** - MessageQueueManager for persistent push messaging
  - **Dashboard** - DashboardManager for analytics and statistics
  - **Plugin storage** - PluginStorageAdapter for persistent plugin state
  - **Group hierarchy** - Tree operations, ancestors, descendants, effective policies

  New database tables: mdm_tenants, mdm_roles, mdm_users, mdm_user_roles, mdm_audit_logs, mdm_scheduled_tasks, mdm_task_executions, mdm_message_queue, mdm_plugin_storage

  All features are optional and backwards compatible.

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
