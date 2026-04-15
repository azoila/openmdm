/**
 * OpenMDM Device Identity
 *
 * Device-pinned asymmetric identity, using an ECDSA P-256 keypair the
 * device generates in its own Keystore and registers with the server on
 * first enrollment. After pinning, every consumer can verify a signed
 * request against the same pinned public key — no shared HMAC secret,
 * no APK extraction footgun, no dependence on Google hardware
 * attestation (which most non-GMS fleet hardware cannot produce).
 *
 * This module is the reusable primitive. `@openmdm/core` uses it to
 * gate `/agent/enroll` and will use it for `/agent/*` in Phase 2c.
 * External consumers (midiamob's `deviceValidation.ts`, other custom
 * servers) import the same functions to verify requests against the
 * same pinned key — one device identity, many consumers.
 *
 * Why zero dependencies: Node's built-in `node:crypto` supports EC
 * P-256 SPKI import and `crypto.verify('sha256', ...)` over DER-encoded
 * signatures, which is the default format the Android Keystore
 * produces. We deliberately do not pull in `@peculiar/*` or `node-forge`
 * for this primitive — the surface area we need is small enough that
 * the built-in is the right call.
 *
 * @see docs/concepts/enrollment for the full flow
 * @see docs/proposals/phase-2b-rollout for the Android + rollout story
 */

import { createPublicKey, verify as cryptoVerify, KeyObject } from 'crypto';
import type { Device, DeviceIdentityVerification, MDMInstance } from './types';

// ============================================
// Low-level: imports and signature verification
// ============================================

/**
 * Import an EC P-256 public key from base64-encoded SubjectPublicKeyInfo
 * (SPKI) bytes — the standard on-wire format the Android Keystore
 * produces when you call `certificate.publicKey.encoded` on a
 * `KeyStore.getCertificate(alias)` result.
 *
 * Throws `InvalidPublicKeyError` on any parse failure. This is a
 * security boundary — we do NOT return `null` on malformed input,
 * because a caller that forgot to handle the null case would silently
 * treat bad keys as "no key configured" and fall through to an
 * insecure path.
 */
export function importPublicKeyFromSpki(spkiBase64: string): KeyObject {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(spkiBase64, 'base64');
  } catch (err) {
    throw new InvalidPublicKeyError(
      'Public key is not valid base64',
      err instanceof Error ? err : undefined,
    );
  }
  if (buffer.length === 0) {
    throw new InvalidPublicKeyError('Public key is empty');
  }
  try {
    const key = createPublicKey({
      key: buffer,
      format: 'der',
      type: 'spki',
    });
    const asymmetricKeyType = key.asymmetricKeyType;
    if (asymmetricKeyType !== 'ec') {
      throw new InvalidPublicKeyError(
        `Expected EC key, got ${asymmetricKeyType ?? 'unknown'}`,
      );
    }
    const curve = (key.asymmetricKeyDetails as { namedCurve?: string } | undefined)
      ?.namedCurve;
    if (curve && curve !== 'prime256v1' && curve !== 'P-256') {
      // Node exposes the curve name as `prime256v1` (the OpenSSL spelling)
      // for EC P-256. Accept both for forward-compat but reject anything
      // else loudly — weaker curves should not silently verify.
      throw new InvalidPublicKeyError(
        `Unsupported EC curve: ${curve}. Only P-256 is accepted.`,
      );
    }
    return key;
  } catch (err) {
    if (err instanceof InvalidPublicKeyError) throw err;
    throw new InvalidPublicKeyError(
      'Failed to parse SPKI public key',
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * Verify an ECDSA-P256 signature over a message using a previously-
 * imported or raw SPKI public key.
 *
 * Signature must be DER-encoded — the default Android Keystore
 * produces DER, and `Signature.sign()` on JVM/Kotlin returns DER, so
 * this matches what every reasonable agent sends on the wire.
 *
 * Returns `true` iff the signature is valid. Never throws on a bad
 * signature (that is the whole point of a verify call). Throws only
 * on an invalid public-key encoding, because that indicates a caller
 * bug rather than a forged request.
 */
export function verifyEcdsaSignature(
  publicKey: KeyObject | string,
  message: string,
  signatureBase64: string,
): boolean {
  const key =
    typeof publicKey === 'string' ? importPublicKeyFromSpki(publicKey) : publicKey;
  let signatureBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(signatureBase64, 'base64');
  } catch {
    return false;
  }
  if (signatureBuffer.length === 0) return false;

  try {
    return cryptoVerify('sha256', Buffer.from(message, 'utf8'), key, signatureBuffer);
  } catch {
    // `crypto.verify` throws only on malformed DER, not on wrong
    // signatures. Treat both as "not verified" — the caller can tell
    // them apart by checking the public key import path separately.
    return false;
  }
}

// ============================================
// Canonical message
// ============================================

/**
 * Build the canonical message that an enrollment signature covers.
 *
 * Staying in lockstep with `@openmdm/client` and with the Android
 * agent is load-bearing — any change here is a wire break across
 * every enrolled device. The contract test in
 * `packages/core/tests/device-identity.test.ts` guards against drift.
 *
 * Shape (order matters):
 *
 *   publicKey |
 *   model | manufacturer | osVersion |
 *   serialNumber | imei | macAddress | androidId |
 *   method | timestamp | challenge
 *
 * The public key is prepended (rather than appended) because it's the
 * field most likely to be the whole point of the message — putting it
 * first makes the signature's intent visible at a glance in logs.
 */
export function canonicalEnrollmentMessage(parts: {
  publicKey: string;
  model: string;
  manufacturer: string;
  osVersion: string;
  serialNumber?: string;
  imei?: string;
  macAddress?: string;
  androidId?: string;
  method: string;
  timestamp: string;
  challenge: string;
}): string {
  return [
    parts.publicKey,
    parts.model,
    parts.manufacturer,
    parts.osVersion,
    parts.serialNumber ?? '',
    parts.imei ?? '',
    parts.macAddress ?? '',
    parts.androidId ?? '',
    parts.method,
    parts.timestamp,
    parts.challenge,
  ].join('|');
}

/**
 * Build the canonical message that a *post-enrollment* request
 * signature covers. Consumers (openmdm's `/agent/*` routes,
 * midiamob's `deviceValidation.ts`, any custom server) call this
 * with the fields they want committed to the signature.
 *
 * The shape is deliberately narrower than the enrollment form — only
 * the parts every request has in common.
 *
 *   deviceId | timestamp | body | nonce
 *
 * `nonce` is optional; pass an empty string when the request does not
 * carry a challenge. Replay protection on non-enrollment traffic is
 * the caller's job — if your server already has a timestamp window
 * check, you don't need a nonce per request.
 */
export function canonicalDeviceRequestMessage(parts: {
  deviceId: string;
  timestamp: string;
  body: string;
  nonce?: string;
}): string {
  return [parts.deviceId, parts.timestamp, parts.body, parts.nonce ?? ''].join('|');
}

// ============================================
// High-level: verifyDeviceRequest primitive
// ============================================

/**
 * Verify a signed request from an enrolled device against the
 * public key pinned on that device's row.
 *
 * This is the primitive every consumer of device-pinned-key identity
 * calls. It performs exactly the checks required to know the request
 * came from the device that originally enrolled, in constant-ish
 * time:
 *
 *  1. Look up the device by id.
 *  2. Confirm the device has a pinned public key (refusing silently
 *     if not — a device without a pinned key is still on the legacy
 *     HMAC path and cannot be verified here).
 *  3. Verify the ECDSA signature over the provided canonical message.
 *
 * Returns a tagged union so callers can react to the specific failure
 * mode:
 *
 *  - `not-found`   — the device id doesn't exist. Almost always a bug
 *                    in the caller, or a stolen/revoked device id.
 *                    Return 401 to the client.
 *  - `no-pinned-key` — the device is still on the HMAC path. Callers
 *                    should fall through to their legacy verifier
 *                    (or fail, if the caller has already migrated).
 *  - `signature-invalid` — the signature did not verify against the
 *                    pinned key. Return 401. **Do NOT** re-pin the
 *                    submitted public key in response to a failure
 *                    here — that's how re-pinning becomes a hijack.
 */
export async function verifyDeviceRequest(opts: {
  mdm: MDMInstance;
  deviceId: string;
  canonicalMessage: string;
  signatureBase64: string;
}): Promise<DeviceIdentityVerification> {
  const device = await opts.mdm.devices.get(opts.deviceId);
  if (!device) {
    return { ok: false, reason: 'not-found' };
  }

  if (!device.publicKey) {
    return { ok: false, reason: 'no-pinned-key', device };
  }

  let verified: boolean;
  try {
    verified = verifyEcdsaSignature(
      device.publicKey,
      opts.canonicalMessage,
      opts.signatureBase64,
    );
  } catch (err) {
    // A pinned key that fails to parse is a data-integrity problem,
    // not a forged request. We log it through the mdm logger so
    // operators can see it, then treat the request as unverified.
    opts.mdm.logger
      .child({ component: 'device-identity' })
      .error(
        {
          deviceId: opts.deviceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'Pinned public key failed to parse',
      );
    return { ok: false, reason: 'signature-invalid', device };
  }

  if (!verified) {
    return { ok: false, reason: 'signature-invalid', device };
  }

  return { ok: true, device };
}

// ============================================
// Errors
// ============================================

/**
 * Thrown when a submitted public key cannot be parsed. This is a
 * caller-facing error — the device sent something that is not a
 * well-formed SPKI EC P-256 public key.
 */
export class InvalidPublicKeyError extends Error {
  readonly code = 'INVALID_PUBLIC_KEY';

  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'InvalidPublicKeyError';
  }
}

/**
 * Thrown when a device attempts to re-enroll with a public key that
 * does not match the one originally pinned for its enrollment id.
 *
 * This is the core "device identity continuity" check. The server
 * will NEVER automatically re-pin on mismatch — rebinding a device
 * identity requires an explicit admin action (future work).
 */
export class PublicKeyMismatchError extends Error {
  readonly code = 'PUBLIC_KEY_MISMATCH';

  constructor(public readonly deviceId: string) {
    super(
      `Device ${deviceId} is already enrolled with a different pinned public key`,
    );
    this.name = 'PublicKeyMismatchError';
  }
}

/**
 * Thrown when an enrollment attempts to use a challenge that is
 * missing, expired, or already consumed.
 */
export class ChallengeInvalidError extends Error {
  readonly code = 'CHALLENGE_INVALID';

  constructor(
    message: string,
    public readonly challenge?: string,
  ) {
    super(message);
    this.name = 'ChallengeInvalidError';
  }
}
