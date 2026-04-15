import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MDMInstance } from '@openmdm/core';
import { honoAdapter } from '../src/index';

/**
 * Integration tests for the deviceAuth middleware. The middleware is the
 * exact component that caused the original production auto-unenroll bug:
 * before the v2 envelope, a transient 401 was indistinguishable from a
 * real unenroll. These tests lock in the invariant that v1 and v2 paths
 * diverge *only* in response shape, never in meaning.
 *
 * We mount a real honoAdapter against a minimally-mocked MDMInstance and
 * hit /agent/heartbeat, which is protected by deviceAuth. The rest of
 * the handler is stubbed to succeed so we can observe auth behavior in
 * isolation.
 */

const V2 = { 'X-Openmdm-Protocol': '2' };

function buildMockMDM(overrides: Partial<MDMInstance> = {}): MDMInstance {
  const verifyDeviceToken = vi.fn(async (token: string) => {
    if (token === 'valid-token') return { deviceId: 'device-42' };
    return null;
  });

  const processHeartbeat = vi.fn(async () => undefined);

  // Minimal surface: honoAdapter starts up and /agent/heartbeat needs to
  // go through deviceAuth → processHeartbeat → commands.getPending →
  // devices.get. Everything else can be a no-op stub; the type cast is
  // deliberate.
  const devices = {
    get: vi.fn(async (_id: string) => ({
      id: 'device-42',
      enrollmentId: 'enroll-1',
      status: 'enrolled' as const,
      policyId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  };

  const commands = {
    getPending: vi.fn(async () => []),
  };

  const policies = {
    get: vi.fn(async () => null),
    getDefault: vi.fn(async () => null),
  };

  // Silent logger stand-in so the hono adapter's error handler can
  // call `mdm.logger.child(...).error(...)` without crashing the
  // test. We don't assert on log output here — the logger's own
  // contract is covered by its unit tests in @openmdm/core.
  const silentLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: function child() {
      return silentLogger;
    },
  };

  return {
    devices,
    policies,
    apps: {},
    commands,
    groups: {},
    push: {},
    db: {},
    logger: silentLogger,
    config: {},
    on: vi.fn(() => () => undefined),
    emit: vi.fn(async () => undefined),
    enroll: vi.fn(),
    processHeartbeat,
    verifyDeviceToken,
    getPlugins: () => [],
    getPlugin: () => undefined,
    ...overrides,
  } as unknown as MDMInstance;
}

describe('deviceAuth middleware: v1 vs v2 failure modes', () => {
  let mdm: MDMInstance;
  let app: ReturnType<typeof honoAdapter>;

  beforeEach(() => {
    mdm = buildMockMDM();
    app = honoAdapter(mdm);
  });

  describe('missing credentials (no Authorization, no X-Device-Id)', () => {
    it('v1: returns HTTP 401', async () => {
      const res = await app.request('/agent/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it('v2: returns 200 envelope with action="reauth"', async () => {
      const res = await app.request('/agent/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...V2 },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        action: string;
        message?: string;
      };
      expect(body.ok).toBe(false);
      expect(body.action).toBe('reauth');
    });
  });

  describe('invalid/expired token', () => {
    it('v1: returns HTTP 401 and never calls the handler', async () => {
      const res = await app.request('/agent/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer nope',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      expect(mdm.verifyDeviceToken).toHaveBeenCalledWith('nope');
      expect(mdm.processHeartbeat).not.toHaveBeenCalled();
    });

    it('v2: returns 200 envelope with action="reauth" — NOT unenroll', async () => {
      // This is the invariant that matters: a bad token must NOT be
      // indistinguishable from "the device is gone". That was the bug.
      const res = await app.request('/agent/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer nope',
          ...V2,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; action: string };
      expect(body.ok).toBe(false);
      expect(body.action).toBe('reauth');
      expect(body.action).not.toBe('unenroll');
      expect(mdm.processHeartbeat).not.toHaveBeenCalled();
    });
  });

  describe('valid token', () => {
    it('v1: passes through and runs the handler', async () => {
      const res = await app.request('/agent/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      expect(mdm.verifyDeviceToken).toHaveBeenCalledWith('valid-token');
      expect(mdm.processHeartbeat).toHaveBeenCalled();
    });

    it('v2: passes through and returns an envelope-shaped success', async () => {
      const res = await app.request('/agent/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
          ...V2,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; action: string };
      expect(body.ok).toBe(true);
      expect(body.action).toBe('none');
      expect(mdm.processHeartbeat).toHaveBeenCalled();
    });
  });

  describe('X-Device-Id fallback (no Authorization header)', () => {
    it('v1: accepts X-Device-Id and runs the handler', async () => {
      const res = await app.request('/agent/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': 'device-42',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      expect(mdm.verifyDeviceToken).not.toHaveBeenCalled();
      expect(mdm.processHeartbeat).toHaveBeenCalled();
    });

    it('v2: accepts X-Device-Id and returns envelope success', async () => {
      const res = await app.request('/agent/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': 'device-42',
          ...V2,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });
});
