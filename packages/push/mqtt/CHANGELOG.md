# @openmdm/push-mqtt

## 0.3.2

### Patch Changes

- Updated dependencies [[`72d3cd6`](https://github.com/azoila/openmdm/commit/72d3cd6e515fc2e8e3cafc6c2d4750a4a781622a)]:
  - @openmdm/core@0.11.1

## 0.3.1

### Patch Changes

- Updated dependencies [[`5378703`](https://github.com/azoila/openmdm/commit/537870352eb58606c6af581c073ab9245cb1d71b)]:
  - @openmdm/core@0.11.0

## 0.3.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`cdac7e1`](https://github.com/azoila/openmdm/commit/cdac7e14bd85721d642b9f75c1172ee8d14f0fec), [`c2c16ab`](https://github.com/azoila/openmdm/commit/c2c16ab77d7293a8d190f46ecd5f86bcf6b8704c), [`8ecf8ca`](https://github.com/azoila/openmdm/commit/8ecf8ca5902ce20523635d65a019bcb8d5aaad6e), [`5d53670`](https://github.com/azoila/openmdm/commit/5d53670c1ab09fbbf330a35ee8dcd0e43e041082), [`d141b72`](https://github.com/azoila/openmdm/commit/d141b72f54ae16b6064e5b12a38ac92ee7d02d18), [`1fa4bee`](https://github.com/azoila/openmdm/commit/1fa4bee350c5934ebb57d6c578bb5106a9853740), [`bd64cd7`](https://github.com/azoila/openmdm/commit/bd64cd711505e8724ead5a76af6a1e8c1449c558)]:
  - @openmdm/core@0.10.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`00ed63f`](https://github.com/azoila/openmdm/commit/00ed63fd0be0259786cbbc29285e34f7ea77f0c0), [`8de33da`](https://github.com/azoila/openmdm/commit/8de33da48b8dd3650dfb4cc5d1d0d0f33ffe2434)]:
  - @openmdm/core@0.9.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`0a58d6d`](https://github.com/azoila/openmdm/commit/0a58d6de0641c095af46cb55e871c5dafab7dff5)]:
  - @openmdm/core@0.8.0

## 0.2.4

### Patch Changes

- Updated dependencies [[`ff0ec7f`](https://github.com/azoila/openmdm/commit/ff0ec7f545f97b2ed3620ceb542ef318ba52533c)]:
  - @openmdm/core@0.7.0

## 0.2.3

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
