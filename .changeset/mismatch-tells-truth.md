---
'@openmdm/core': patch
---

Map device-identity enrollment errors to real HTTP statuses instead of 500.

`PublicKeyMismatchError`, `ChallengeInvalidError`, and
`InvalidPublicKeyError` extended plain `Error`, so HTTP adapters'
generic error handling (which maps anything carrying `code` +
`statusCode`) fell through to "Internal server error". The practical
victim: a device re-enrolling after an app-data wipe regenerates its
Keystore pair, hits the pinned-key continuity check, and saw an opaque
HTTP 500 on every retry — indistinguishable from a broken server.

All three are now `MDMError` subclasses:

- `PublicKeyMismatchError` → **409** `PUBLIC_KEY_MISMATCH` (with the
  device id in `details`) — a state conflict retrying cannot fix; an
  admin must remove or reset the existing device record.
- `ChallengeInvalidError` → **400** `CHALLENGE_INVALID` — the agent
  recovers by fetching a fresh challenge.
- `InvalidPublicKeyError` → **400** `INVALID_PUBLIC_KEY`.

`instanceof` checks and the public fields (`deviceId`, `challenge`,
`cause`) are unchanged.
