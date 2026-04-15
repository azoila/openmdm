import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign, createPrivateKey } from 'crypto';
import {
  importPublicKeyFromSpki,
  verifyEcdsaSignature,
  canonicalEnrollmentMessage,
  canonicalDeviceRequestMessage,
  InvalidPublicKeyError,
} from '../src/device-identity';

/**
 * Unit tests for the device-pinned-key identity primitives.
 *
 * These tests generate real EC P-256 keypairs at test time via
 * Node's built-in `crypto.generateKeyPairSync`, so we exercise the
 * same code paths a real Android Keystore would produce — DER
 * signatures, SPKI public keys, sha256 hashing. No mocked crypto,
 * no hand-crafted byte arrays. Any regression in the verifier
 * fails these tests.
 */

// ============================================
// Fixtures: real EC P-256 keypair
// ============================================

function generateKeypair(): { publicKeySpki: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    publicKeySpki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
  };
}

function signWithPrivate(privateKeyPem: string, message: string): string {
  const key = createPrivateKey(privateKeyPem);
  const sig = cryptoSign('sha256', Buffer.from(message, 'utf8'), key);
  return sig.toString('base64');
}

// ============================================
// importPublicKeyFromSpki
// ============================================

describe('importPublicKeyFromSpki', () => {
  let validSpki: string;

  beforeAll(() => {
    validSpki = generateKeypair().publicKeySpki;
  });

  it('accepts a real EC P-256 SPKI public key', () => {
    const key = importPublicKeyFromSpki(validSpki);
    expect(key.asymmetricKeyType).toBe('ec');
  });

  it('throws InvalidPublicKeyError on empty input', () => {
    expect(() => importPublicKeyFromSpki('')).toThrow(InvalidPublicKeyError);
  });

  it('throws InvalidPublicKeyError on non-base64 garbage', () => {
    // A string that base64-decodes to bytes that are not a valid SPKI
    // should throw, not return null.
    expect(() => importPublicKeyFromSpki('not!valid!base64!!!')).toThrow(
      InvalidPublicKeyError,
    );
  });

  it('throws InvalidPublicKeyError on truncated SPKI', () => {
    const truncated = Buffer.from(validSpki, 'base64').slice(0, 10).toString('base64');
    expect(() => importPublicKeyFromSpki(truncated)).toThrow(InvalidPublicKeyError);
  });

  it('rejects non-EC keys with a clear error', () => {
    // Generate an RSA key and hand its SPKI to the importer — it
    // should refuse with a message that says "expected EC".
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaSpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(() => importPublicKeyFromSpki(rsaSpki)).toThrow(/EC/);
  });

  it('rejects EC keys on curves other than P-256', () => {
    // secp384r1 is a valid EC curve but not what we accept. Reject
    // loudly rather than silently verifying with weaker properties.
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(() => importPublicKeyFromSpki(spki)).toThrow(/curve/);
  });
});

// ============================================
// verifyEcdsaSignature
// ============================================

describe('verifyEcdsaSignature', () => {
  let keypair: ReturnType<typeof generateKeypair>;

  beforeAll(() => {
    keypair = generateKeypair();
  });

  it('verifies a valid signature produced by the matching private key', () => {
    const message = 'hello openmdm';
    const signature = signWithPrivate(keypair.privateKeyPem, message);
    expect(verifyEcdsaSignature(keypair.publicKeySpki, message, signature)).toBe(true);
  });

  it('rejects a signature over a different message', () => {
    const signature = signWithPrivate(keypair.privateKeyPem, 'message-a');
    expect(verifyEcdsaSignature(keypair.publicKeySpki, 'message-b', signature)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const other = generateKeypair();
    const message = 'shared message';
    const signature = signWithPrivate(other.privateKeyPem, message);
    expect(verifyEcdsaSignature(keypair.publicKeySpki, message, signature)).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(verifyEcdsaSignature(keypair.publicKeySpki, 'msg', '')).toBe(false);
  });

  it('rejects a malformed (non-DER) signature without throwing', () => {
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64');
    expect(() =>
      verifyEcdsaSignature(keypair.publicKeySpki, 'msg', garbage),
    ).not.toThrow();
    expect(verifyEcdsaSignature(keypair.publicKeySpki, 'msg', garbage)).toBe(false);
  });

  it('throws on an invalid public key (not a verify failure)', () => {
    // Distinction matters: a malformed public key is a caller bug,
    // a bad signature is an attack. They should feel different.
    expect(() => verifyEcdsaSignature('garbage', 'msg', 'sig')).toThrow(
      InvalidPublicKeyError,
    );
  });

  it('accepts a pre-imported KeyObject for hot paths', () => {
    const keyObj = importPublicKeyFromSpki(keypair.publicKeySpki);
    const message = 'reuse the parsed key';
    const signature = signWithPrivate(keypair.privateKeyPem, message);
    expect(verifyEcdsaSignature(keyObj, message, signature)).toBe(true);
  });
});

// ============================================
// canonicalEnrollmentMessage
// ============================================

describe('canonicalEnrollmentMessage', () => {
  it('produces a pipe-delimited message with publicKey first', () => {
    const msg = canonicalEnrollmentMessage({
      publicKey: 'PK',
      model: 'Pixel 7',
      manufacturer: 'Google',
      osVersion: '14',
      serialNumber: 'SN1',
      imei: 'IMEI1',
      macAddress: 'aa:bb',
      androidId: 'android-1',
      method: 'qr',
      timestamp: '2026-04-15T12:00:00Z',
      challenge: 'CHAL',
    });
    expect(msg).toBe(
      'PK|Pixel 7|Google|14|SN1|IMEI1|aa:bb|android-1|qr|2026-04-15T12:00:00Z|CHAL',
    );
  });

  it('coerces missing optional identifiers to empty strings', () => {
    const msg = canonicalEnrollmentMessage({
      publicKey: 'PK',
      model: 'M',
      manufacturer: 'F',
      osVersion: '14',
      method: 'manual',
      timestamp: 'T',
      challenge: 'C',
    });
    // 4 empty fields for missing serialNumber / imei / macAddress / androidId.
    expect(msg).toBe('PK|M|F|14|||||manual|T|C');
  });

  it('changing any field produces a different signed message', () => {
    // Pinning tests the "any drift is a wire break" property — if a
    // refactor accidentally changes the field order or separator,
    // these assertions fail and the author is forced to update the
    // agent at the same time.
    const base = {
      publicKey: 'PK',
      model: 'M',
      manufacturer: 'F',
      osVersion: '14',
      method: 'manual' as const,
      timestamp: 'T',
      challenge: 'C',
    };
    const canonicalBase = canonicalEnrollmentMessage(base);
    expect(canonicalEnrollmentMessage({ ...base, model: 'M2' })).not.toBe(canonicalBase);
    expect(canonicalEnrollmentMessage({ ...base, challenge: 'C2' })).not.toBe(canonicalBase);
    expect(canonicalEnrollmentMessage({ ...base, publicKey: 'PK2' })).not.toBe(canonicalBase);
    expect(canonicalEnrollmentMessage({ ...base, timestamp: 'T2' })).not.toBe(canonicalBase);
  });
});

// ============================================
// canonicalDeviceRequestMessage
// ============================================

describe('canonicalDeviceRequestMessage', () => {
  it('builds deviceId | timestamp | body | nonce', () => {
    const msg = canonicalDeviceRequestMessage({
      deviceId: 'dev-1',
      timestamp: '2026-04-15T12:00:00Z',
      body: '{"hello":"world"}',
      nonce: 'nonce-1',
    });
    expect(msg).toBe('dev-1|2026-04-15T12:00:00Z|{"hello":"world"}|nonce-1');
  });

  it('empty nonce is rendered as empty trailing field', () => {
    const msg = canonicalDeviceRequestMessage({
      deviceId: 'dev-1',
      timestamp: 'T',
      body: '',
    });
    expect(msg).toBe('dev-1|T||');
  });

  it('a signature over the canonical form verifies round-trip', () => {
    const keypair = generateKeypair();
    const msg = canonicalDeviceRequestMessage({
      deviceId: 'dev-1',
      timestamp: '2026-04-15T12:00:00Z',
      body: 'payload',
    });
    const sig = signWithPrivate(keypair.privateKeyPem, msg);
    expect(verifyEcdsaSignature(keypair.publicKeySpki, msg, sig)).toBe(true);
  });
});
