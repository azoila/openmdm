# @openmdm/cli

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
