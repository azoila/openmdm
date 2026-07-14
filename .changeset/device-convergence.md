---
'@openmdm/core': minor
'@openmdm/drizzle-adapter': minor
'@openmdm/hono': minor
---

Desired state, device lifecycle, canonical app inventory, and update enforcement.

Four features, one system. Desired state is the primitive; the rest are built on it.

**Desired state (`devices.setDesiredState`).** A command is an *event*: miss it and the intent
is gone. Desired state is a *fact* — it rides on every heartbeat until the device reports it has
applied that version. "Put this device in maintenance mode" belongs here, not in a command: a
maintenance flag that lives only client-side, or only in a command the device never received,
describes a device nobody can account for. `null` in a patch **deletes** the key rather than
storing null (unset is not the same fact as "set to off"), and re-submitting an unchanged state
does not bump the version — an operator clicking a toggle that is already in position must not
make the whole fleet re-report convergence for a change that never happened.
`devices.getConvergence()` answers whether the device has caught up; `device.converged` fires
when it does.

**Device lifecycle.** `devices.update` accepted any status from anywhere, so a device could go
from `unenrolled` straight back to `enrolled` without ever re-enrolling. Status writes now go
through a transition table. `devices.delete` **hard-DELETE'd the row**, cascading away the
device's entire command and audit history — so the one question you ask after a bad unenroll
("what happened to this device?") was the one question the data could no longer answer. It now
tombstones (`deletedAt`); the device reads as gone to callers and is filtered out of listings,
but the history survives. Pass `{ hard: true }` for a genuine erase.

**Two-phase unenroll.** `beginUnenroll()` arms the device (`unenrolling`) and tells it to go;
`completeUnenroll()` finishes when it confirms. Flipping straight to `unenrolled` is what
strands fleets: the row says the device left while the device — which never received the
message — keeps heartbeating at a server that no longer recognises it. `cancelUnenroll()` calls
it off.

**Canonical app inventory.** App versions lived only inside the `installed_apps` JSON blob, so
"which devices run the broken build?" meant walking JSON for every device in the fleet, and a
reconcile loop could not express its central question in SQL at all. A new `mdm_device_apps`
table holds one row per (device, package) with observed *and* desired versions. The JSON blob
remains the full inventory; this is the queryable form of the facts we act on.
`device.appVersionChanged` fires on a diff — versions used to be overwritten silently, so "when
did this fleet start running the broken build?" had no answer.

**Update enforcement (`mdm.updates`).** Issuing an `installApp` command is not the same as an
app being installed: the command can be delivered, acknowledged, and still leave the device on
the old version. Command durability covers *delivery*; nothing covered *outcome*.
`updates.reconcile()` compares observed against desired, re-issues with exponential backoff, and
escalates — once — when a device keeps taking the command without moving.
`updates.setDesiredAppVersion()` supports staged rollouts, bucketed by `hash(deviceId + version)`:
salting with the version is deliberate, because hashing the device id alone would make the same
unlucky 10% of the fleet the canary for every release forever. A device that has never installed
the app is treated as version `0.0.0`, not skipped — otherwise the engine is upgrade-only and a
freshly provisioned device silently never gets the app it exists to run.

Schema: `mdm_devices` gains `desired_state` (jsonb), `desired_state_version`,
`reported_state_version`, `state_reported_at`, `deleted_at`; the device status enum gains
`unenrolling`; the `unenroll` command type is new; and `mdm_device_apps` is added. Existing rows
take the defaults — no backfill.
