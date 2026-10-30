---
'@openmdm/core': minor
'@openmdm/drizzle-adapter': minor
'@openmdm/hono': minor
---

Make command handling safe against repeated and out-of-order device reports.

- Lifecycle changes are now atomic compare-and-set updates through the new optional `transitionCommand` adapter method. A late ack can no longer reopen a finished command, and an ack that beats the push result is no longer overwritten by `sent`.
- A repeated report returns the current row and does not re-emit its event. A late `complete` still closes a `failed`, `cancelled` or `expired` command, because the device's report is the truth about what ran.
- `retryPending` claims each attempt before pushing, so concurrent sweeps can't push the same command twice.
- `sweepStuck` counts each requeue as an attempt, so poll-only devices reach `ACK_TIMEOUT_EXHAUSTED` instead of requeuing forever.
- Agent command routes now return 404 unless the command belongs to the calling device.
- Device tokens can no longer be issued or verified with an empty signing key.
