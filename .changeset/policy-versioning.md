---
'@openmdm/core': minor
'@openmdm/drizzle-adapter': minor
---

Policy versioning, history, rollback, and drift detection.

Policies mutated in place with no version. Devices have always reported a `policyVersion` in
every heartbeat, and core never read it — so "is this device running the current policy?" was
a question the system could not answer. There was no rollout state, no drift detection, no
history, and no way back to a previous policy after a bad change.

- **`Policy.version`** — monotonic, starting at 1. Bumped only when `settings` change: renaming
  a policy must not mark the entire fleet as drifted.
- **History** — every settings change writes an immutable snapshot. `policies.history(id)` and
  `policies.getVersion(id, n)`.
- **`policies.rollback(id, toVersion)`** — restores earlier settings. It rolls **forward**: the
  restored settings become a *new* version rather than rewinding the counter. Rewinding would
  make the rollback invisible to a device that had already applied the version being restored —
  it would compare its applied version against an identical number, conclude it was compliant,
  and never re-apply.
- **Drift detection** — heartbeats now record the reported version. A device behind its policy
  raises `device.policyDrifted` on *every* heartbeat, not once: a device that never converges
  should keep announcing itself rather than going quiet after a single alert.
- **Compliance** — `devices.getPolicyCompliance(id)` returns `compliant | pending | unknown |
  unassigned`; `policies.getCompliance(id)` returns fleet rollout state with the lagging device
  ids.
- **New events**: `policy.updated`, `policy.rolledBack`, `device.policyDrifted`.

**Also fixed: the plugin `validatePolicy` hook was never called.** It has been part of the
plugin interface all along, so a plugin could declare a policy invalid and be silently ignored.
It now runs on policy create and update, and a rejection fails the write.

Schema: `mdm_policies.version`, `mdm_devices.applied_policy_version` / `policy_applied_at`, and
a new `mdm_policy_versions` table (unique on `(policy_id, version)` — a snapshot is written once
and never rewritten, so a duplicate is a bug, not a race to tolerate). Existing policies default
to version 1; no backfill required. Adapters that don't supply a `policyVersions` table keep
versioning and drift detection and lose only history/rollback.
