# @openmdm/plugin-geofence

## 0.3.1

### Patch Changes

- Updated dependencies [[`5378703`](https://github.com/azoila/openmdm/commit/537870352eb58606c6af581c073ab9245cb1d71b)]:
  - @openmdm/core@0.11.0

## 0.3.0

### Minor Changes

- [#34](https://github.com/azoila/openmdm/pull/34) [`9505b97`](https://github.com/azoila/openmdm/commit/9505b97d958386b2e8ecdb410a6b465021cb98a3) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Persist geofence state, and actually revert policy overrides.

  **Zones and device-zone membership now survive a restart.** They lived in plain in-process
  `Map`s, with a source comment conceding they "should be moved to DB adapter in production".
  Two things followed from that:

  - Every zone an operator had drawn vanished when the process restarted.
  - Every device forgot which zones it was inside — so the next heartbeat re-fired `enter` for a
    zone the device had been parked in for a week, re-applying policy overrides and re-firing
    webhooks.

  State now persists through `mdm.pluginStorage`, the same mechanism the kiosk plugin already
  used. Configure `pluginStorage: { adapter: 'database' }` on `createMDM`. Without it, the plugin
  falls back to in-memory Maps and warns loudly at startup — acceptable for local development
  only.

  **The policy-override revert was a `console.log`.** On exit, the plugin logged "Policy override
  ended" and did nothing. A device that drove into a geofenced zone kept that zone's policy
  **forever after leaving it** — the exact opposite of what a geofenced override is for. The
  plugin now records the device's pre-override policy on entry (`DeviceZoneState.previousPolicyId`)
  and restores it on exit, unless the device is still standing in another zone that applies the
  same override. When the device had no policy before entering, the override is cleared rather
  than left stuck.

  **Zone webhooks are bounded.** They had no timeout, so a zone webhook pointing at an endpoint
  that simply hung would stall heartbeat processing indefinitely. Now aborted after 10 seconds;
  failures are logged rather than swallowed silently, and still do not fail the heartbeat.

  `console.*` replaced with the structured logger throughout. The package had no tests; it now
  has coverage for persistence-across-restart and every branch of the override revert.

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
