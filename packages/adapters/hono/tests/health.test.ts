import { describe, it, expect, vi } from 'vitest';
import type { MDMInstance } from '@openmdm/core';
import { honoAdapter } from '../src/index';

/**
 * Tests for the /healthz (liveness) and /readyz (readiness) probes
 * on the hono adapter.
 *
 * The contract these tests lock in:
 *  - /healthz is pure liveness: it NEVER touches the database. If
 *    the process is alive and serving HTTP, it returns 200.
 *  - /readyz is readiness: it round-trips through `mdm.db.listDevices`
 *    and reports 200 + ok or 503 + degraded. A 503 here tells the
 *    orchestrator to stop sending traffic, but the process stays up.
 *  - Both endpoints are unauthenticated so load balancers / k8s
 *    probes / HAProxy / etc. can hit them without credentials.
 *
 * A regression in any of these silently breaks the deploy story,
 * which is precisely the kind of bug an observability surface is
 * supposed to make visible rather than paper over.
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

function buildMockMDM(opts: {
  dbOk: boolean;
  push?: unknown;
}): MDMInstance {
  const listDevices = opts.dbOk
    ? vi.fn(async () => ({ devices: [], total: 0, limit: 1, offset: 0 }))
    : vi.fn(async () => {
        throw new Error('connection refused');
      });

  return {
    devices: {},
    policies: {},
    apps: {},
    commands: {},
    groups: {},
    push: opts.push === undefined ? {} : opts.push,
    db: { listDevices },
    logger: silentLogger,
    config: {},
    on: vi.fn(() => () => undefined),
    emit: vi.fn(async () => undefined),
    enroll: vi.fn(),
    processHeartbeat: vi.fn(async () => undefined),
    verifyDeviceToken: vi.fn(async () => null),
    getPlugins: () => [],
    getPlugin: () => undefined,
  } as unknown as MDMInstance;
}

describe('/healthz (liveness probe)', () => {
  it('returns 200 OK when everything is fine', async () => {
    const mdm = buildMockMDM({ dbOk: true });
    const app = honoAdapter(mdm);

    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 200 even when the database is down — liveness ≠ readiness', async () => {
    const mdm = buildMockMDM({ dbOk: false });
    const app = honoAdapter(mdm);

    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(mdm.db.listDevices).not.toHaveBeenCalled();
  });

  it('is unauthenticated — no Authorization header required', async () => {
    const mdm = buildMockMDM({ dbOk: true });
    const app = honoAdapter(mdm);

    // No headers at all. A probe from k8s/HAProxy/ALB won't send any.
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
  });
});

describe('/readyz (readiness probe)', () => {
  it('returns 200 and ok when db + push are available', async () => {
    const mdm = buildMockMDM({ dbOk: true });
    const app = honoAdapter(mdm);

    const res = await app.request('/readyz');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { ok: boolean }>;
    };
    expect(body.status).toBe('ok');
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.push.ok).toBe(true);
  });

  it('calls mdm.db.listDevices with a cheap limit', async () => {
    const mdm = buildMockMDM({ dbOk: true });
    const app = honoAdapter(mdm);

    await app.request('/readyz');

    expect(mdm.db.listDevices).toHaveBeenCalledTimes(1);
    const call = (mdm.db.listDevices as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toEqual({ limit: 1, offset: 0 });
  });

  it('returns 503 and degraded when the database check throws', async () => {
    const mdm = buildMockMDM({ dbOk: false });
    const app = honoAdapter(mdm);

    const res = await app.request('/readyz');
    expect(res.status).toBe(503);

    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { ok: boolean; error?: string }>;
    };
    expect(body.status).toBe('degraded');
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.database.error).toContain('connection refused');
  });

  it('returns 503 when push adapter is missing', async () => {
    // An MDM instance with no push adapter is a config mistake; readyz
    // should surface it rather than let traffic land on a broken
    // deploy.
    const mdm = buildMockMDM({ dbOk: true, push: null });
    const app = honoAdapter(mdm);

    const res = await app.request('/readyz');
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { ok: boolean }>;
    };
    expect(body.status).toBe('degraded');
    expect(body.checks.push.ok).toBe(false);
  });

  it('is unauthenticated', async () => {
    const mdm = buildMockMDM({ dbOk: true });
    const app = honoAdapter(mdm);

    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
  });
});
