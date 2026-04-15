import { describe, it, expect, vi } from 'vitest';
import type { MDMInstance, EnrollmentChallenge } from '@openmdm/core';
import { honoAdapter } from '../src/index';

/**
 * Tests for the `GET /agent/enroll/challenge` endpoint.
 *
 * This is the Phase 2b handshake entry point: the agent fetches a
 * single-use challenge before generating its enrollment signature.
 * The challenge is meaningless without a corresponding ECDSA
 * signature over the canonical enrollment message, so it's safe to
 * expose unauthenticated — but it still needs to behave correctly
 * when the backing adapter doesn't implement challenge storage, and
 * it needs to actually persist the challenge so the later
 * /enroll call can consume it.
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

type MDMConfig = { enrollment?: { pinnedKey?: { challengeTtlSeconds?: number } } };

function buildMockMDM(opts: {
  createChallenge?: (c: EnrollmentChallenge) => Promise<void>;
  withStorage?: boolean;
  config?: MDMConfig;
} = {}): MDMInstance {
  const withStorage = opts.withStorage ?? true;
  const db: Record<string, unknown> = {
    listDevices: vi.fn(async () => ({
      devices: [],
      total: 0,
      limit: 1,
      offset: 0,
    })),
  };
  if (withStorage) {
    db.createEnrollmentChallenge =
      opts.createChallenge ?? vi.fn(async () => undefined);
    db.consumeEnrollmentChallenge = vi.fn();
  }

  return {
    devices: {},
    policies: {},
    apps: {},
    commands: {},
    groups: {},
    push: {},
    db,
    logger: silentLogger,
    config: opts.config ?? {},
    on: vi.fn(() => () => undefined),
    emit: vi.fn(async () => undefined),
    enroll: vi.fn(),
    processHeartbeat: vi.fn(async () => undefined),
    verifyDeviceToken: vi.fn(async () => null),
    getPlugins: () => [],
    getPlugin: () => undefined,
  } as unknown as MDMInstance;
}

describe('GET /agent/enroll/challenge', () => {
  it('returns a challenge + expiresAt when storage is supported', async () => {
    const created: EnrollmentChallenge[] = [];
    const mdm = buildMockMDM({
      createChallenge: async (c) => {
        created.push(c);
      },
    });
    const app = honoAdapter(mdm);

    const res = await app.request('/agent/enroll/challenge');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      challenge: string;
      expiresAt: string;
      ttlSeconds: number;
    };

    expect(body.challenge).toBeDefined();
    expect(typeof body.challenge).toBe('string');
    // Base64 of 32 random bytes is ~44 chars including padding.
    expect(body.challenge.length).toBeGreaterThanOrEqual(40);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.ttlSeconds).toBe(300);

    // The challenge the endpoint returned is the same one it
    // persisted through the adapter — otherwise the device's
    // later /enroll call has nothing to redeem.
    expect(created).toHaveLength(1);
    expect(created[0].challenge).toBe(body.challenge);
    expect(created[0].consumedAt).toBeNull();
  });

  it('respects a custom challengeTtlSeconds from config', async () => {
    const mdm = buildMockMDM({
      config: { enrollment: { pinnedKey: { challengeTtlSeconds: 60 } } },
    });
    const app = honoAdapter(mdm);

    const res = await app.request('/agent/enroll/challenge');
    const body = (await res.json()) as { ttlSeconds: number; expiresAt: string };

    expect(body.ttlSeconds).toBe(60);
    const delta = new Date(body.expiresAt).getTime() - Date.now();
    // Allow 5s slack for test clock drift.
    expect(delta).toBeGreaterThan(55 * 1000);
    expect(delta).toBeLessThan(65 * 1000);
  });

  it('returns 503 when the adapter does not implement challenge storage', async () => {
    // Adapters without challenge storage should not silently hand
    // out unverifiable challenges.
    const mdm = buildMockMDM({ withStorage: false });
    const app = honoAdapter(mdm);

    const res = await app.request('/agent/enroll/challenge');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Enrollment challenges');
  });

  it('returns a unique challenge per call', async () => {
    const mdm = buildMockMDM();
    const app = honoAdapter(mdm);

    const res1 = await app.request('/agent/enroll/challenge');
    const res2 = await app.request('/agent/enroll/challenge');
    const body1 = (await res1.json()) as { challenge: string };
    const body2 = (await res2.json()) as { challenge: string };

    expect(body1.challenge).not.toBe(body2.challenge);
  });

  it('is unauthenticated — no Authorization header required', async () => {
    const mdm = buildMockMDM();
    const app = honoAdapter(mdm);

    // No headers at all.
    const res = await app.request('/agent/enroll/challenge');
    expect(res.status).toBe(200);
  });
});
