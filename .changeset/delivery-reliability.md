---
'@openmdm/core': minor
'@openmdm/drizzle-adapter': minor
'@openmdm/push-mqtt': minor
'@openmdm/push-fcm': minor
---

Make push delivery honest, and recover commands a device acked then dropped.

**MQTT no longer reports success for a message the device never acknowledged.** On ack
timeout the adapter resolved `{ success: true }` — so a command pushed to a device that had
been offline for a week was reported delivered, marked `sent`, and never retried. It now
resolves `{ success: false, error: 'ACK_TIMEOUT: ...' }`, which lets the retry sweep do its
job. Configurable via `ack.timeoutMs`; `ack.treatTimeoutAsSuccess` restores the old behaviour
for fleets whose agents genuinely do not publish acks.

**MQTT presence tracking actually works.** `mqttExtendedAdapter` spread the base adapter and
then built its *own* empty presence map — one the broker subscription never wrote to. So
`getDeviceStatus()` always returned `undefined`, `getOnlineDevices()` always returned `[]`, and
`isDeviceOnline()` always returned `false`, regardless of how many devices were connected. An
operator asking "which devices are online?" was told "none", forever. Both adapters now read
the same state by construction.

**MQTT `disconnect()` is real.** It used to only log. The client, its reconnect timer, and every
pending-ack timer leaked for the life of the process; callers awaiting an ack hung forever. It
now closes the connection and settles in-flight waiters as failures. Added to the `PushAdapter`
contract as an optional method.

**MQTT `reconnect.maxRetries` is enforced.** It was declared in the options and wired to nothing,
so an unreachable broker was retried forever with no way to stop.

**FCM retries transient failures.** One attempt was all a message ever got, so an FCM hiccup
(`server-unavailable`, a 503 under load) was reported as permanent. Now retried with exponential
backoff (`retry.maxAttempts`, default 3). Permanent failures — unregistered token, invalid
argument — are *not* retried: they fail identically every time, so retrying only adds latency.

**Both adapters use the structured logger** instead of `console.*` (29 call sites), so their
output lands in the host's logging pipeline.

**New: `commands.sweepStuck()`** closes the ack-then-crash hole. `getPendingCommands` only
returns `pending`/`sent`, so a device that acknowledged a command and then died mid-execution
would never be given it again — the command sat `acknowledged` forever. Stuck commands are now
requeued for re-delivery (or dead-lettered once attempts are exhausted), emitting
`command.requeued`. Delivery is therefore at-least-once: agents must be idempotent per
`commandId`. Tune with `config.commands.ackTimeoutSeconds` (default 15 min; `0` disables).
