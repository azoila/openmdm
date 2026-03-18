---
"@openmdm/core": patch
"@openmdm/drizzle-adapter": patch
---

fix: Return 404 instead of 500 when command not found on ack/complete/fail

When a device is freed via the admin API, FK CASCADE deletes associated commands.
If the device agent then tries to ack or complete a deleted command, the server
crashed with `TypeError: Cannot read properties of null (reading 'deviceId')`.

- Add `CommandNotFoundError` class (404 status code)
- Add null checks in `acknowledge()`, `complete()`, `fail()`, `cancel()`
- Fix unsafe cast in drizzle adapter `updateCommand()` return type
- Change `DatabaseAdapter.updateCommand` return type to `Command | null`