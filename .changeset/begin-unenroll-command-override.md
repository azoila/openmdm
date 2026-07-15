---
"@openmdm/core": minor
---

`devices.beginUnenroll()` can now override or suppress the command it queues (#42).

Two new options, both additive — default behavior is unchanged:

- `command`: full override of the queued command (`Omit<SendCommandInput, 'deviceId'>`). For fleets whose agents consume a different wire shape — e.g. mid-migration from a legacy agent protocol whose teardown funnel triggers on a `custom` command — the two-phase status machinery is now usable without reimplementing the arming flow. Takes precedence over `wipe` for command selection; the default `unenroll:${id}` idempotency key still applies unless the override carries its own.
- `queueCommand: false`: arm the device into `unenrolling` without queueing any command, for callers that deliver the teardown message out-of-band. Nothing will ever ACK in this mode, so the caller is responsible for eventually calling `completeUnenroll()` (or `cancelUnenroll()`).
