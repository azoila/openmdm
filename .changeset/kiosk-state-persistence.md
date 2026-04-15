---
'@openmdm/plugin-kiosk': minor
'@openmdm/drizzle-adapter': minor
---

Persist kiosk plugin state through `pluginStorage` instead of an in-memory `Map`.

**The bug this fixes:** the kiosk plugin previously kept per-device lockout
counters, the current kiosk app, and exit-attempt timestamps in a
`Map<string, KioskState>` that lived in process memory. A server restart
reset every counter to zero, and running a second replica behind a load
balancer meant each replica had its own view of the state. Both failure
modes silently bypass the security UX the plugin exists to provide: a user
who hit the max exit attempts got a fresh budget on every redeploy, and
replicas could disagree about whether a device was locked out.

**The fix:** the plugin now reads and writes through `mdm.pluginStorage`
whenever it is configured, which routes the state through the normal
`DatabaseAdapter` path and into the `mdm_plugin_storage` table.

**Drizzle adapter changes** (`@openmdm/drizzle-adapter`):
- New `mdmPluginStorage` table in the Postgres schema
  (`mdm_plugin_storage`) with a composite `(plugin_name, key)` primary key
  and a JSONB `value` column.
- New `getPluginValue` / `setPluginValue` / `deletePluginValue` /
  `listPluginKeys` / `clearPluginData` methods on the adapter. These are
  only wired when the caller passes the new optional `pluginStorage`
  table reference through `DrizzleAdapterOptions.tables`.
- `setPluginValue` uses `onConflictDoUpdate` so writes are idempotent and
  last-write-wins.

**Kiosk plugin changes** (`@openmdm/plugin-kiosk`):
- `getKioskState` / `updateKioskState` are now async and go through
  `mdm.pluginStorage` when available.
- New `listKioskStates` helper replaces the direct `Map.entries()` call
  in the admin listing route.
- Startup warning when `pluginStorage` is not configured, pointing to
  docs for the correct setup.
- Date fields (`lockedSince`, `lastExitAttempt`, `lockoutUntil`) are
  rehydrated from JSON strings to `Date` objects on read.

**Breaking for direct users of `DrizzleAdapterOptions.tables`:** nothing
— the new `pluginStorage` table is optional. If omitted, the kiosk
plugin falls back to the in-memory path with a clear warning, matching
the pre-fix behavior for anyone who hasn't run the new migration.

**Docs updates:**
- `docs/content/docs/installation.mdx` now shows the full `tables` list
  including `pluginStorage` and the `pluginStorage: { adapter: 'database' }`
  config flag.
- `docs/content/docs/recipes/kiosk.mdx` documents the production
  requirement and explains the in-memory fallback.

**New migration required:** run `drizzle-kit generate && drizzle-kit
migrate` after upgrading to pick up the new `mdm_plugin_storage` table.
