# @openmdm/hono

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
