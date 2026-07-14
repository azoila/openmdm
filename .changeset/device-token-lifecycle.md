---
'@openmdm/core': minor
---

Add device-token renewal and revocation, and harden token/enrollment verification.

- **`mdm.issueDeviceToken(deviceId)`** issues a fresh token for an enrolled device.
  It refuses devices that are `unenrolled` or `blocked`, which makes unenrolling a
  device an effective revocation: a leaked token stays valid only until its own
  expiry and can never be renewed. Consumers previously had to fork core's JWT
  crypto to rotate tokens.
- **`mdm.verifyDeviceToken(token, { ignoreExpirationWithinSeconds })`** accepts a
  recently-expired token *only* for renewal, so an agent that was offline past its
  expiry can recover instead of self-unenrolling. Regular request authentication is
  unaffected. Configure the window with `auth.deviceTokenRenewalGraceSeconds`
  (default: 30 days).
- **Constant-time token signature comparison.** The previous `!==` comparison leaked,
  via response timing, how many leading bytes of a forged signature were correct.
- **Enrollment timestamp freshness** is now enforced on the HMAC path. The timestamp
  is covered by the signature but was never checked, so a captured enrollment request
  could be replayed indefinitely. Configure with `enrollment.timestampToleranceSeconds`
  (default: 900; set to 0 to disable). The pinned-key path is unaffected — its
  single-use challenge already prevents replay.
