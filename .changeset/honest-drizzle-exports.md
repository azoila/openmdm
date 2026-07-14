---
'@openmdm/drizzle-adapter': minor
---

Remove the `./mysql` and `./sqlite` export subpaths. These were placeholder modules that
threw `not yet implemented` at import time, so no working code depended on them — but the
package advertised dialect support it could not deliver. The adapter is PostgreSQL-only for
now (the runtime implementation uses pg-specific `onConflictDoUpdate`/`.returning()`);
MySQL/SQLite support is planned. Use `@openmdm/drizzle-adapter/postgres` for
table definitions.
