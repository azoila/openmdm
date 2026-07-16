import { ChallengeInvalidError, type MDMInstance, PublicKeyMismatchError } from '@openmdm/core';
import { describe, expect, it, vi } from 'vitest';
import { honoAdapter } from '../src/index';

/**
 * Enrollment failures must reach the device as what they are.
 *
 * `mdm.enroll()` throws typed errors — a pinned-key mismatch, an
 * expired challenge — and the route deliberately does not catch them:
 * the adapter's `onError` maps any MDMError (`code` + `statusCode`)
 * to a JSON response with that status. Before the identity errors
 * became MDMErrors, they fell through to the 500 branch, and a real
 * device re-enrolling after an app-data wipe (fresh Keystore pair,
 * old key still pinned server-side) saw "Internal server error" on
 * every retry, forever — indistinguishable from a broken server.
 *
 * These tests pin the full HTTP surface: route → onError → status +
 * machine-readable `code` the agent can branch on.
 */

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: function child() {
    return silentLogger;
  },
};

function buildMockMDM(enroll: () => Promise<never>): MDMInstance {
  return {
    devices: {},
    policies: {},
    apps: {},
    commands: {},
    groups: {},
    push: {},
    db: {
      listDevices: vi.fn(async () => ({ devices: [], total: 0, limit: 1, offset: 0 })),
    },
    logger: silentLogger,
    config: {},
    on: vi.fn(() => () => undefined),
    emit: vi.fn(async () => undefined),
    enroll: vi.fn(enroll),
    processHeartbeat: vi.fn(async () => undefined),
    verifyDeviceToken: vi.fn(async () => null),
    getPlugins: () => [],
    getPlugin: () => undefined,
  } as unknown as MDMInstance;
}

const ENROLL_BODY = JSON.stringify({
  model: 'Pixel 7',
  manufacturer: 'Google',
  osVersion: '14',
  androidId: 'android-id-1',
  method: 'manual',
  timestamp: new Date().toISOString(),
  signature: 'sig',
});

function postEnroll(mdm: MDMInstance) {
  const app = honoAdapter(mdm);
  return app.request('/agent/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ENROLL_BODY,
  });
}

describe('POST /agent/enroll error mapping', () => {
  it('pinned-key mismatch surfaces as 409 with PUBLIC_KEY_MISMATCH, not 500', async () => {
    const mdm = buildMockMDM(async () => {
      throw new PublicKeyMismatchError('dev-1');
    });

    const res = await postEnroll(mdm);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code: string; details?: unknown };
    expect(body.code).toBe('PUBLIC_KEY_MISMATCH');
    expect(body.error).toContain('different pinned public key');
    expect(body.details).toEqual({ deviceId: 'dev-1' });
  });

  it('invalid challenge surfaces as 400 with CHALLENGE_INVALID', async () => {
    const mdm = buildMockMDM(async () => {
      throw new ChallengeInvalidError('Challenge expired or already consumed');
    });

    const res = await postEnroll(mdm);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('CHALLENGE_INVALID');
  });
});
