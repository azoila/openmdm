---
'@openmdm/plugin-geofence': minor
---

Persist geofence state, and actually revert policy overrides.

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
