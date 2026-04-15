import { describe, it, expect } from 'vitest';
import { generateEnrollmentSignature } from '../../client/src/index';
import { verifyEnrollmentSignature } from '../src/index';
import type { EnrollmentRequest } from '../src/types';

/**
 * Contract test: the HMAC enrollment signature format must stay in lockstep
 * between @openmdm/client (device side) and @openmdm/core (server side).
 *
 * A regression here — either side changing the canonical form without the
 * other — silently breaks every new device enrollment when deviceSecret is
 * configured. See core/src/index.ts:1341 for the canonical form comment.
 */

const SECRET = 'test-enrollment-secret-do-not-use-in-prod';

function baseRequest(): Omit<EnrollmentRequest, 'signature'> {
  return {
    model: 'Pixel 7 Pro',
    manufacturer: 'Google',
    osVersion: '14',
    serialNumber: 'SN-123456',
    imei: '353912108123456',
    macAddress: 'aa:bb:cc:dd:ee:ff',
    androidId: 'android-id-abc',
    method: 'qr',
    timestamp: '2026-04-15T00:00:00.000Z',
  };
}

describe('Enrollment signature contract (client ↔ server)', () => {
  it('client-signed request verifies on the server', async () => {
    const data = baseRequest();
    const signature = await generateEnrollmentSignature(
      data as unknown as Parameters<typeof generateEnrollmentSignature>[0],
      data.timestamp,
      SECRET
    );

    const request: EnrollmentRequest = { ...data, signature };
    expect(verifyEnrollmentSignature(request, SECRET)).toBe(true);
  });

  it('tampered model field fails verification', async () => {
    const data = baseRequest();
    const signature = await generateEnrollmentSignature(
      data as unknown as Parameters<typeof generateEnrollmentSignature>[0],
      data.timestamp,
      SECRET
    );

    const tampered: EnrollmentRequest = {
      ...data,
      model: 'Pixel 7', // different model, signature stays the same
      signature,
    };
    expect(verifyEnrollmentSignature(tampered, SECRET)).toBe(false);
  });

  it('tampered timestamp fails verification', async () => {
    const data = baseRequest();
    const signature = await generateEnrollmentSignature(
      data as unknown as Parameters<typeof generateEnrollmentSignature>[0],
      data.timestamp,
      SECRET
    );

    const tampered: EnrollmentRequest = {
      ...data,
      timestamp: '2026-04-15T00:00:01.000Z',
      signature,
    };
    expect(verifyEnrollmentSignature(tampered, SECRET)).toBe(false);
  });

  it('wrong secret fails verification', async () => {
    const data = baseRequest();
    const signature = await generateEnrollmentSignature(
      data as unknown as Parameters<typeof generateEnrollmentSignature>[0],
      data.timestamp,
      SECRET
    );

    const request: EnrollmentRequest = { ...data, signature };
    expect(verifyEnrollmentSignature(request, 'different-secret')).toBe(false);
  });

  it('missing signature fails verification', () => {
    const data = baseRequest();
    const request = { ...data, signature: '' } as EnrollmentRequest;
    expect(verifyEnrollmentSignature(request, SECRET)).toBe(false);
  });

  it('optional fields can be empty or missing on both sides', async () => {
    const data: Omit<EnrollmentRequest, 'signature'> = {
      model: 'Generic',
      manufacturer: 'Unknown',
      osVersion: '13',
      androidId: 'android-only',
      method: 'manual',
      timestamp: '2026-04-15T00:00:00.000Z',
    };

    const signature = await generateEnrollmentSignature(
      data as unknown as Parameters<typeof generateEnrollmentSignature>[0],
      data.timestamp,
      SECRET
    );

    const request: EnrollmentRequest = { ...data, signature };
    expect(verifyEnrollmentSignature(request, SECRET)).toBe(true);
  });

  it('different method produces different signature', async () => {
    const base = baseRequest();
    const sigQr = await generateEnrollmentSignature(
      base as unknown as Parameters<typeof generateEnrollmentSignature>[0],
      base.timestamp,
      SECRET
    );
    const sigNfc = await generateEnrollmentSignature(
      { ...base, method: 'nfc' } as unknown as Parameters<
        typeof generateEnrollmentSignature
      >[0],
      base.timestamp,
      SECRET
    );
    expect(sigQr).not.toBe(sigNfc);
  });
});
