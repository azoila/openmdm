# OpenMDM Roadmap

This document tracks the **shortest defensible roadmap** from "promising pre-1.0 library" to "I'd run my fleet on this." It is deliberately short — five items, ranked by what actually prevents production incidents rather than what sounds good in a changelog.

For the full positioning and gap analysis that motivated this list, see the project discussion thread; a condensed version lives in the project's audit notes.

## Milestones

### 1. Kiosk plugin state persistence + horizontal scaling guide

**Why this first:** Smallest, most self-contained item on the list, and it fixes a real latent bug. The kiosk plugin previously kept lockout counters in an in-memory `Map`, so a restart or a second replica silently reset every counter. Either failure mode bypasses the security UX the plugin exists to provide.

**Scope:**
- [x] Add `mdm_plugin_storage` table to the Drizzle Postgres schema.
- [x] Implement `getPluginValue` / `setPluginValue` / `deletePluginValue` / `listPluginKeys` / `clearPluginData` in `@openmdm/drizzle-adapter`.
- [x] Rewrite the kiosk plugin's state helpers to use `mdm.pluginStorage` when available.
- [x] Keep an in-memory fallback for dev, with a clear startup warning explaining the consequences.
- [x] Date rehydration on read (JSON serializes `Date` as string).
- [x] Tests for the in-memory adapter contract.
- [x] Docs: update installation + kiosk recipe to show `pluginStorage: { adapter: 'database' }`.

**Status:** ✅ **Shipped** in the first PR of this roadmap effort.

### 2. Observability: logger interface + health endpoints

**Why this next:** Without structured logging and health probes, OpenMDM is opaque in production. Operators can't tell if it's broken until users complain.

**Scope:**
- [ ] `logger` option on `createMDM` config that replaces the `console.error` / `console.warn` call sites in webhooks, auth, push, and plugins.
- [ ] Pino-compatible interface (`info` / `warn` / `error` / `debug`) so existing hosts can plug in their loggers.
- [ ] `/healthz` endpoint in the Hono adapter that returns 200 unconditionally (liveness).
- [ ] `/readyz` endpoint that probes the database adapter (a cheap `listDevices({ limit: 1 })`) and the push adapter (if it exposes a health check) and returns 503 on failure.
- [ ] Tests in `@openmdm/hono` for both endpoints covering happy path and DB-down scenarios.
- [ ] Docs: new `concepts/operations.mdx` page explaining logger integration, health checks, and deployment expectations.

**Out of scope (follow-up):** Prometheus / OTEL metrics. The metrics surface deserves its own pass — designing the event names and labels up front is more valuable than slapping `prom-client` on top.

### 3. Tenant + RBAC audit

**Why this next:** `tenant.ts` and `authorization.ts` exist in `@openmdm/core` but I have not verified this session that every manager correctly scopes by `tenantId` or that every admin operation is gated by `authorization`. A single unscoped query in a multi-tenant SaaS built on OpenMDM is a data-leak incident. This item is a thorough read-through with concrete fixes where needed.

**Scope:**
- [ ] Read `packages/core/src/tenant.ts` top to bottom and map the tenant-scoping surface.
- [ ] Read `packages/core/src/authorization.ts` top to bottom and map the permission model.
- [ ] Cross-check every manager method in `createMDM` against the tenant/auth contract: does each one take a tenant context, does it scope the underlying database call, and is permission enforcement applied?
- [ ] Produce a concrete audit report with `file:line` refs for every gap found.
- [ ] Fix obvious small gaps in the same PR (e.g. a method that accepts `tenantId` in its args but doesn't forward it to the database call).
- [ ] File follow-up issues for larger architectural gaps.
- [ ] Contract tests covering tenant isolation for at least `devices.list`, `policies.list`, `commands.list`, `events.list`.

**Status:** not started.

### 4. Phase 2b design spec: hardware-rooted identity

**Why this matters but isn't implemented yet:** Today's enrollment HMAC is symmetric. Anyone who extracts the Android agent APK and captures a few device metadata fields can forge enrollments. Keystore-attested identity is the replacement the README has promised, but the implementation spans the separate `openmdm-android` repo and requires several weeks of focused work plus real device testing. It can't be done in a single code session.

What *can* be done now is writing the spec, which is the blocker for starting the implementation work.

**Scope:**
- [ ] `docs/proposals/phase-2b-hardware-identity.md` covering:
  - The threat model the current HMAC does not address.
  - The Android Keystore attestation flow: Keymaster-generated keypair, attestation extension, chain-of-trust back to Google's root certificates.
  - How the server verifies the attestation chain and what properties it decides on (Verified Boot state, device integrity, root of trust, TEE security level).
  - The wire protocol change: new enrollment payload field carrying the attestation extension.
  - Backwards compatibility with the HMAC path during rollout.
  - Rotation story: the server-side trust anchors must be updatable without a redeploy.
  - Open questions flagged explicitly (Android version floor, MIUI / Samsung Knox quirks, attestation revocation handling).
- [ ] Design review on the spec before implementation starts.
- [ ] Implementation tracked as a separate multi-PR effort after the spec is accepted.

**Status:** not started.

### 5. Integration tests against real Postgres and mocked FCM

**Why this is last:** It's the highest-value class of test to add, but it requires infra (testcontainers, a FCM mock HTTP server) that doesn't exist in this repo yet. The scaffolding cost is real, so it makes sense to land this after the other items so we know *what* to test at the integration layer.

**Scope:**
- [ ] Testcontainers-based Postgres setup in a shared test util package.
- [ ] One concrete contract test per critical path, running against a real Postgres:
  - Drizzle transforms round-trip correctly (`Device.location`, `installedApps`, `metadata`, `Policy.settings` including nested fields).
  - Plugin storage round-trips JSONB cleanly and `onConflictDoUpdate` is idempotent.
  - Tenant isolation holds at the database layer (tests from milestone 3 promoted to integration).
- [ ] Mocked FCM HTTP server (using `msw` or similar) that captures push requests for assertion, backed by a real `@openmdm/push-fcm` adapter.
- [ ] One end-to-end test: enroll device → queue command → verify push request shape → simulate heartbeat → verify command delivery envelope.
- [ ] Docs: `concepts/testing.mdx` explaining the difference between unit, integration, and contract tests in OpenMDM and when to write which.

**Out of scope (follow-up):** Real Android emulator tests. That belongs in `openmdm-android`, not here, and is a significantly larger piece of infra.

## What is deliberately not on this list

- **iOS support.** Android-only is a positioning choice, not an oversight.
- **Framework adapters for Express / Fastify / Next.js.** Hono runs on every runtime these need, and the 30 lines of adapter code users would write to wire their own router is not worth a full native adapter per framework. See the README for the honest framing.
- **Metrics surface.** Yes it matters, no it is not on the shortest defensible roadmap. It slots in after item 2 when the logger interface gives us a place to put it.
- **Bulk operations UI.** Real operators want canary rollouts, maintenance windows, scheduled reverts. These are real asks — but they belong to Stage 3 "enterprise-ready," not Stage 2 "1.0-trustable."
- **Android DPM surface expansion.** `PolicySettings` is a subset of what Android's Device Policy Manager supports. Filling gaps is vertical-specific work that should happen when real users file real asks, not speculatively.

These are deferred, not rejected. They are strong candidates for the post-1.0 roadmap.

## Contributing

If you want to help with an item on this list, open an issue tagged `roadmap/stage-2` with a proposal before starting. The order matters because the items build on each other — item 2's logger interface is what item 3's audit uses to emit findings, and item 5's integration tests depend on the test infra that lands with the earlier items.
