import type { MDMInstance } from '@openmdm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { honoAdapter } from '../src/index';

/**
 * A device token proves which device is calling, and only that device may
 * report on a command. Without this check any enrolled device could close or
 * fail another device's commands.
 */

function buildMDM(): MDMInstance {
  const silentLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child() {
      return silentLogger;
    },
  };
  return {
    devices: {},
    policies: {},
    apps: {},
    commands: {
      get: vi.fn(async (id: string) =>
        id === 'cmd-mine'
          ? { id, deviceId: 'device-42' }
          : id === 'cmd-other'
            ? { id, deviceId: 'device-7' }
            : null,
      ),
      acknowledge: vi.fn(async (id: string) => ({ id, status: 'acknowledged' })),
      complete: vi.fn(async (id: string) => ({ id, status: 'completed' })),
      fail: vi.fn(async (id: string) => ({ id, status: 'failed' })),
    },
    groups: {},
    push: {},
    db: {},
    logger: silentLogger,
    config: {},
    on: vi.fn(() => () => undefined),
    emit: vi.fn(async () => undefined),
    enroll: vi.fn(),
    processHeartbeat: vi.fn(),
    verifyDeviceToken: vi.fn(async () => ({ deviceId: 'device-42' })),
    getPlugins: () => [],
    getPlugin: () => undefined,
  } as unknown as MDMInstance;
}

const post = (app: ReturnType<typeof honoAdapter>, path: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid' },
    body: JSON.stringify({ success: true, error: 'x' }),
  });

describe.each([
  ['ack', 'acknowledge'],
  ['complete', 'complete'],
  ['fail', 'fail'],
] as const)('POST /agent/commands/:id/%s', (route, method) => {
  let mdm: MDMInstance;
  let app: ReturnType<typeof honoAdapter>;

  beforeEach(() => {
    mdm = buildMDM();
    app = honoAdapter(mdm);
  });

  it('applies to the calling device’s own command', async () => {
    const res = await post(app, `/agent/commands/cmd-mine/${route}`);

    expect(res.status).toBe(200);
    expect(mdm.commands[method]).toHaveBeenCalledTimes(1);
  });

  it('rejects another device’s command and does not touch it', async () => {
    const res = await post(app, `/agent/commands/cmd-other/${route}`);

    expect(res.status).toBe(404);
    expect(mdm.commands[method]).not.toHaveBeenCalled();
  });

  it('answers the same for a command that does not exist', async () => {
    const res = await post(app, `/agent/commands/cmd-missing/${route}`);

    expect(res.status).toBe(404);
  });
});
