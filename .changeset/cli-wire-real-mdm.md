---
'@openmdm/cli': minor
---

Wire CLI commands to the real MDM instance instead of mock data.

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
