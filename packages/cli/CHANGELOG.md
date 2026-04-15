# @openmdm/cli

## 0.4.0

### Minor Changes

- [#7](https://github.com/azoila/openmdm/pull/7) [`e2b2414`](https://github.com/azoila/openmdm/commit/e2b241481f2361a8b8daa257dfb2a7519f83363d) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Wire CLI commands to the real MDM instance instead of mock data.

  The `device`, `policy`, `stats`, and `push-test` commands now load the user's
  `createMDM()` instance from a config file and execute against the real
  database and push adapter. Previously these commands printed hardcoded mock
  data or used `setTimeout` placeholders.

  **Config discovery.** On invocation the CLI searches for the MDM instance at:

  - `openmdm.config.{ts,js,mjs}`
  - `src/mdm.{ts,js,mjs}` (matches what `openmdm init` generates)
  - `mdm.{ts,js,mjs}`

  The file must export an `MDMInstance` as either a named `mdm` export or the
  default export. TypeScript sources are loaded at runtime via `jiti` so users
  do not need a separate build step.

  **What changed per command:**

  - `device list / show / sync / lock / wipe / remove` now hit
    `mdm.devices.*` methods with real database reads and real push delivery.
  - `policy list / show / create / apply` now use `mdm.policies.*` with live
    device counts via `mdm.devices.list({ policyId })`.
  - `stats` now calls `mdm.dashboard.getStats()` and
    `mdm.dashboard.getCommandSuccessRates()`.
  - `push-test` now resolves the device and invokes `mdm.push.send()`.
  - `enroll qr / token` still generate unsigned development tokens but now
    print a clear warning that HMAC-signed, server-persisted tokens are
    scoped to Phase 2b (hardware-rooted identity).
  - `migrate` remains a deprecation stub pointing to the `generate` +
    `drizzle-kit` workflow, with clearer wording about what it does not do.

  **Breaking:** commands that previously worked against hardcoded mock data
  now fail fast if no MDM config file is found. Projects generated with
  `openmdm init` already produce a compatible `src/mdm.ts`.

### Patch Changes

- Updated dependencies [[`ff0ec7f`](https://github.com/azoila/openmdm/commit/ff0ec7f545f97b2ed3620ceb542ef318ba52533c)]:
  - @openmdm/core@0.7.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`41b87bd`](https://github.com/azoila/openmdm/commit/41b87bd6f71b54fba4a9a67e6d8443006a685c98), [`c713954`](https://github.com/azoila/openmdm/commit/c71395403cb24b136e54a7d98662a7f599f1297a)]:
  - @openmdm/core@0.6.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`997236f`](https://github.com/azoila/openmdm/commit/997236fca5bb2311b4e736b552500aacab6c82d8)]:
  - @openmdm/core@0.4.0

## 0.3.0

### Minor Changes

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
