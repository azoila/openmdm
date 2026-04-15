# @openmdm/client

## 0.2.1

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
