---
'@openmdm/core': minor
'@openmdm/drizzle-adapter': minor
---

Make command delivery durable: idempotency, expiry, retry, and dead-lettering.

Previously `sendCommand` pushed once and, if the push failed, silently left the command
`pending` with no record of the attempt and nothing to retry it. A command could sit stuck
forever, and a `factoryReset` queued for a device that stayed offline for months would fire
the moment it came back. The `MessageQueueManager` had retry and expiry logic, but
`sendCommand` never used it — they were two disconnected systems.

**Idempotency.** `SendCommandInput.idempotencyKey` deduplicates sends per device: a repeat
returns the existing command instead of queueing the operation twice — what you want when a
retrying HTTP client double-posts "wipe this device". The Drizzle adapter implements this as
`INSERT ... ON CONFLICT DO NOTHING` against a partial unique index on
`(device_id, idempotency_key)`, so concurrent senders race in the database rather than in
application code. Adapters that don't implement `createCommandIdempotent` fall back to
find-then-create, which narrows the duplicate window without closing it.

**Expiry.** Commands carry `expiresAt`, defaulting to `config.commands.defaultTtlSeconds`
(7 days; set `0` for no default). Expired commands are withheld from `getPending` even if the
reaper hasn't run, and `commands.expireStale()` reaps them to a new `expired` status.

**Retry and dead-lettering.** A failed push now records the attempt and leaves the command
retryable. `commands.retryPending()` re-pushes commands whose exponential backoff has elapsed
(`config.commands.retryBackoffSeconds`, default 60s) and dead-letters those that exhaust
`maxAttempts` (default 5) to `failed` with a `DELIVERY_EXHAUSTED` error, emitting
`command.failed`. Call both sweeps from a scheduled job.

**Fixed: `transaction()` was not transactional.** The Drizzle adapter opened a transaction and
then ran the callback against the *outer* connection, so nothing inside it participated — a
partial failure left half-written state committed. The transaction handle now flows through
`AsyncLocalStorage`, so adapter calls made inside the callback join the transaction and roll
back together. Nested calls join the enclosing transaction.

New `DatabaseAdapter` optional methods: `createCommandIdempotent`, `findCommandByIdempotencyKey`,
`expireCommands`, `listRetryableCommands`. New `CommandStatus` value: `expired`. New
`mdm_commands` columns: `idempotency_key`, `expires_at`, `attempt_count`, `max_attempts`,
`last_attempt_at` — existing rows take the defaults, so no backfill is required.
