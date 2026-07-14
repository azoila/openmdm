import { describe, expect, it } from 'vitest';
import { isRetryableFcmError } from '../src/index';

/**
 * Which FCM failures are worth another attempt.
 *
 * The adapter used to make exactly one attempt per message, so a transient FCM
 * hiccup — `server-unavailable`, a 503 under load — was reported as a permanent
 * delivery failure. Retrying now closes that, but only for errors that can
 * actually succeed on a second try: re-sending to an unregistered token just
 * burns the backoff window and delays the real answer.
 */

describe('isRetryableFcmError', () => {
  it('retries transient FCM error codes', () => {
    expect(isRetryableFcmError({ code: 'messaging/server-unavailable' })).toBe(true);
    expect(isRetryableFcmError({ code: 'messaging/internal-error' })).toBe(true);
    expect(isRetryableFcmError({ code: 'messaging/unknown-error' })).toBe(true);
    expect(isRetryableFcmError({ code: 'messaging/quota-exceeded' })).toBe(true);
  });

  it('does NOT retry permanent failures', () => {
    // These fail identically every time — the token is gone, or the payload is
    // malformed. Retrying is pure latency.
    expect(isRetryableFcmError({ code: 'messaging/registration-token-not-registered' })).toBe(
      false,
    );
    expect(isRetryableFcmError({ code: 'messaging/invalid-registration-token' })).toBe(false);
    expect(isRetryableFcmError({ code: 'messaging/invalid-argument' })).toBe(false);
    expect(isRetryableFcmError({ code: 'messaging/mismatched-credential' })).toBe(false);
  });

  it('retries transport failures that arrive without a code', () => {
    // firebase-admin does not always attach a `code`.
    expect(isRetryableFcmError({ message: 'Request failed with status code 503' })).toBe(true);
    expect(isRetryableFcmError({ message: 'Request failed with status code 429' })).toBe(true);
    expect(isRetryableFcmError({ message: 'UNAVAILABLE: connection reset' })).toBe(true);
    expect(isRetryableFcmError({ message: 'DEADLINE_EXCEEDED' })).toBe(true);
  });

  it('does not retry a 4xx that is not a rate limit', () => {
    expect(isRetryableFcmError({ message: 'Request failed with status code 400' })).toBe(false);
    expect(isRetryableFcmError({ message: 'Request failed with status code 404' })).toBe(false);
  });

  it('does not retry an unrecognised error', () => {
    expect(isRetryableFcmError({})).toBe(false);
    expect(isRetryableFcmError({ message: 'something went wrong' })).toBe(false);
  });
});
