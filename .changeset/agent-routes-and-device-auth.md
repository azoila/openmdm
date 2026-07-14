---
'@openmdm/hono': minor
'@openmdm/client': minor
---

Fix the client↔server protocol break, close a device-auth bypass, and rate-limit enrollment.

**Breaking (security fix): a bare `X-Device-Id` header no longer authenticates.**
`deviceAuth` previously accepted the header as sufficient identity when no bearer
token was present. Device ids are enumerable, so anyone could read any device's
commands and config by sending the header. A verified device token is now the only
accepted identity. Agents that relied on the header must send their token.

**New agent routes.** `@openmdm/client` called four endpoints the adapter never
served, so token refresh, command polling, event reporting, and push-token removal
all 404'd against the shipped server:

- `POST /agent/refresh-token` — exchanges the current token for a fresh one. Not
  behind `deviceAuth` by design: it accepts a recently-expired token (within the
  server's renewal grace window) so an agent that slept past expiry can recover.
  The signature is still fully verified, and unenrolled/blocked devices are refused.
- `GET /agent/commands/pending` — poll commands without a full heartbeat.
- `POST /agent/events` — agent-reported events (crashes, kiosk exit attempts).
- `DELETE /agent/push-token` — remove one provider's token, or all of them.

**Rate limiting** on the unauthenticated enrollment routes (`POST /agent/enroll`,
`GET /agent/enroll/challenge`), enabled by default at 60 requests/60s per client IP.
It is in-memory and per-process, so with N replicas the effective limit is N × max;
pass `rateLimit: false` if your reverse proxy already handles this.

**Client**: `refreshToken()` is now exposed on `MDMClient` for proactive rotation, and
the automatic 401 → refresh → retry path now uses the device token rather than a
`refreshToken` field the server never issued.

A new contract test suite drives the real client against the real adapter over HTTP,
so this class of divergence fails CI instead of shipping.
