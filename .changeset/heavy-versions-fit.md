---
'@openmdm/drizzle-adapter': patch
---

Widen app-version columns from varchar(50) to varchar(255).

Android `versionName` is a free-form string with no platform length limit,
and real-world apps exceed 50 characters — Google's TTS app ships
`googletts.google-speech-apk_20250804.02_p3.800153222` (53 chars). With the
old width, one such app in a device's inventory made Postgres reject the
insert and the server answered the **entire heartbeat** with HTTP 500, on
every heartbeat, forever (found live enrolling a stock emulator image).

Widened: `mdm_devices.agent_version`, `mdm_applications.version`,
`mdm_device_apps.observed_version` / `desired_version`,
`mdm_app_versions.version`, `mdm_rollbacks.from_version` / `to_version`.
255 matches what the CLI generator (`openmdm generate`) already emits for
string columns, so generated and hand-written schemas now agree.

Existing databases need a widening migration, which is metadata-only in
Postgres (no table rewrite, no data loss):

```sql
ALTER TABLE mdm_devices ALTER COLUMN agent_version TYPE varchar(255);
ALTER TABLE mdm_applications ALTER COLUMN version TYPE varchar(255);
ALTER TABLE mdm_device_apps ALTER COLUMN observed_version TYPE varchar(255);
ALTER TABLE mdm_device_apps ALTER COLUMN desired_version TYPE varchar(255);
ALTER TABLE mdm_app_versions ALTER COLUMN version TYPE varchar(255);
ALTER TABLE mdm_rollbacks ALTER COLUMN from_version TYPE varchar(255);
ALTER TABLE mdm_rollbacks ALTER COLUMN to_version TYPE varchar(255);
```