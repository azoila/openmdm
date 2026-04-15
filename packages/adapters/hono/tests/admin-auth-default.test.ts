import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MDMInstance } from '@openmdm/core';
import { honoAdapter } from '../src/index';

/**
 * Admin auth default-safety tests.
 *
 * Historical bug: `honoAdapter({ enableAuth })` defaulted to `false`,
 * and the Quick Start / Installation docs did not mention turning it
 * on. Users following the happy path shipped wide-open admin routes
 * — every /mdm/devices, /mdm/policies, /mdm/commands request was
 * accepted from any source.
 *
 * Fix: default flipped to `true`. Two startup warnings fire:
 *   1. When enableAuth is true but config.auth is missing — the
 *      middleware runs but has no user resolver, so every request
 *      still passes. The warning names the thing you forgot.
 *   2. When enableAuth is explicitly false — the host deliberately
 *      opted out, probably because a parent router authenticates
 *      first, and the warning is a one-line acknowledgement.
 *
 * These tests pin the contract so the footgun can't come back.
 */

function buildMockMDM(
  overrides: Partial<MDMInstance> = {},
): { mdm: MDMInstance; warnings: Array<[object, string]> } {
  const warnings: Array<[object, string]> = [];
  const capture = (context: object, message: string) => {
    warnings.push([context, message]);
  };

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(capture),
    error: vi.fn(),
    child: function child() {
      return logger;
    },
  };

  const mdm = {
    devices: {},
    policies: {},
    apps: {},
    commands: {},
    groups: {},
    push: {},
    db: {},
    logger,
    config: {},
    on: vi.fn(() => () => undefined),
    emit: vi.fn(async () => undefined),
    enroll: vi.fn(),
    processHeartbeat: vi.fn(async () => undefined),
    verifyDeviceToken: vi.fn(async () => null),
    getPlugins: () => [],
    getPlugin: () => undefined,
    ...overrides,
  } as unknown as MDMInstance;

  return { mdm, warnings };
}

describe('honoAdapter admin auth default', () => {
  it('defaults enableAuth to true', () => {
    const { mdm, warnings } = buildMockMDM();
    honoAdapter(mdm);

    // With no config.auth set, the adapter still considers auth
    // "enabled" and warns about the missing resolver. If the default
    // ever silently regresses to false, this warning won't fire and
    // the test fails.
    const reasons = warnings.map((w) => (w[0] as { reason?: string }).reason);
    expect(reasons).toContain('auth-enabled-but-not-configured');
    expect(reasons).not.toContain('auth-explicitly-disabled');
  });

  it('warns when enableAuth: true but config.auth is missing', () => {
    const { mdm, warnings } = buildMockMDM();
    honoAdapter(mdm, { enableAuth: true });

    expect(warnings).toHaveLength(1);
    const [context, message] = warnings[0];
    expect((context as { reason: string }).reason).toBe(
      'auth-enabled-but-not-configured',
    );
    // The warning message must name the thing the user forgot.
    expect(message).toContain('mdm.config.auth');
  });

  it('does not warn when enableAuth: true and config.auth is configured', () => {
    const { mdm, warnings } = buildMockMDM({
      config: {
        auth: {
          getUser: async () => ({ id: 'u1' }),
          isAdmin: async () => true,
        },
      } as unknown as MDMInstance['config'],
    });

    honoAdapter(mdm, { enableAuth: true });

    expect(warnings).toHaveLength(0);
  });

  it('warns once when enableAuth is explicitly false', () => {
    const { mdm, warnings } = buildMockMDM();
    honoAdapter(mdm, { enableAuth: false });

    expect(warnings).toHaveLength(1);
    const [context, message] = warnings[0];
    expect((context as { reason: string }).reason).toBe(
      'auth-explicitly-disabled',
    );
    expect(message).toContain('unauthenticated');
  });

  it('respects an explicit enableAuth: false even with config.auth set', () => {
    // The "explicit opt-out" path is a legitimate escape hatch when
    // a parent router already authenticates every request. We still
    // emit the acknowledgement warning so a grep over startup logs
    // can find it.
    const { mdm, warnings } = buildMockMDM({
      config: {
        auth: {
          getUser: async () => ({ id: 'u1' }),
        },
      } as unknown as MDMInstance['config'],
    });

    honoAdapter(mdm, { enableAuth: false });

    const reasons = warnings.map((w) => (w[0] as { reason: string }).reason);
    expect(reasons).toContain('auth-explicitly-disabled');
    expect(reasons).not.toContain('auth-enabled-but-not-configured');
  });
});
