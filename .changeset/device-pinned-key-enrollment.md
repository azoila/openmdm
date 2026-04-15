---
'@openmdm/core': minor
'@openmdm/drizzle-adapter': minor
'@openmdm/hono': minor
---

Phase 2b device-pinned-key enrollment (server side).

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
