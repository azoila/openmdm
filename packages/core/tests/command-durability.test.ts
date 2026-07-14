/**
 * Command delivery durability.
 *
 * Before this, `sendCommand` pushed once and, if the push failed, silently
 * left the command `pending` forever: no attempt recorded, no retry, no
 * expiry, and no dead-letter. A `factoryReset` queued for a device that
 * stayed offline for months would fire the moment it came back. These tests
 * pin the guarantees that replace that behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMDM, createSilentLogger, type MDMInstance, type PushAdapter } from '../src/index';

// ============================================
// In-memory adapter with the durability methods
// ============================================

function createMemoryAdapter() {
  const devices = new Map<string, any>();
  const commands = new Map<string, any>();
  let counter = 0;

  const adapter: any = {
    _commands: commands,

    async findDevice(id: string) {
      return devices.get(id) || null;
    },
    async findDeviceByEnrollmentId() {
      return null;
    },
    async listDevices() {
      const all = Array.from(devices.values());
      return { devices: all, total: all.length, limit: all.length, offset: 0 };
    },
    async createDevice(data: any) {
      const device = {
        id: `device-${++counter}`,
        status: 'enrolled',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      devices.set(device.id, device);
      return device;
    },
    async updateDevice(id: string, data: any) {
      const updated = { ...devices.get(id), ...data, updatedAt: new Date() };
      devices.set(id, updated);
      return updated;
    },
    async deleteDevice(id: string) {
      devices.delete(id);
    },
    async countDevices() {
      return devices.size;
    },

    async findCommand(id: string) {
      return commands.get(id) || null;
    },
    async listCommands(filter?: any) {
      return Array.from(commands.values()).filter((c) => {
        if (filter?.deviceId && c.deviceId !== filter.deviceId) return false;
        if (filter?.status) {
          const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
          if (!statuses.includes(c.status)) return false;
        }
        return true;
      });
    },
    async createCommand(data: any) {
      const command = {
        id: `command-${++counter}`,
        status: 'pending',
        attemptCount: 0,
        maxAttempts: data.maxAttempts ?? 5,
        idempotencyKey: data.idempotencyKey ?? null,
        expiresAt: data.expiresAt ?? null,
        payload: data.payload ?? null,
        deviceId: data.deviceId,
        type: data.type,
        createdAt: new Date(),
      };
      commands.set(command.id, command);
      return command;
    },
    async updateCommand(id: string, data: any) {
      const command = commands.get(id);
      if (!command) return null;
      const updated = { ...command, ...data };
      if (data.attemptCount !== undefined) {
        updated.lastAttemptAt = new Date();
      }
      commands.set(id, updated);
      return updated;
    },
    async getPendingCommands(deviceId: string) {
      return Array.from(commands.values()).filter(
        (c) => c.deviceId === deviceId && (c.status === 'pending' || c.status === 'sent'),
      );
    },

    // Durability surface
    async createCommandIdempotent(data: any) {
      if (data.idempotencyKey) {
        const existing = Array.from(commands.values()).find(
          (c) => c.deviceId === data.deviceId && c.idempotencyKey === data.idempotencyKey,
        );
        if (existing) return { command: existing, created: false };
      }
      return { command: await adapter.createCommand(data), created: true };
    },
    async findCommandByIdempotencyKey(deviceId: string, key: string) {
      return (
        Array.from(commands.values()).find(
          (c) => c.deviceId === deviceId && c.idempotencyKey === key,
        ) ?? null
      );
    },
    async expireCommands(now: Date) {
      let count = 0;
      for (const command of commands.values()) {
        if (
          ['pending', 'sent', 'acknowledged'].includes(command.status) &&
          command.expiresAt &&
          command.expiresAt.getTime() <= now.getTime()
        ) {
          command.status = 'expired';
          command.completedAt = now;
          count += 1;
        }
      }
      return count;
    },
    async listStuckAcknowledgedCommands({ now, ackTimeoutSeconds, limit }: any) {
      return Array.from(commands.values())
        .filter((c) => {
          if (c.status !== 'acknowledged') return false;
          if (!c.acknowledgedAt) return false;
          if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) return false;
          return c.acknowledgedAt.getTime() + ackTimeoutSeconds * 1000 <= now.getTime();
        })
        .slice(0, limit);
    },
    async listRetryableCommands({ now, backoffSeconds, limit }: any) {
      return Array.from(commands.values())
        .filter((c) => {
          if (c.status !== 'pending') return false;
          if (c.attemptCount >= c.maxAttempts) return false;
          if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) return false;
          if (!c.lastAttemptAt) return true;
          const wait = backoffSeconds * 2 ** (c.attemptCount - 1) * 1000;
          return c.lastAttemptAt.getTime() + wait <= now.getTime();
        })
        .slice(0, limit);
    },

    // Unused-but-required surface
    async findPolicy() {
      return null;
    },
    async findDefaultPolicy() {
      return null;
    },
    async listPolicies() {
      return [];
    },
    async createPolicy(d: any) {
      return d;
    },
    async updatePolicy(_i: string, d: any) {
      return d;
    },
    async deletePolicy() {},
    async findApplication() {
      return null;
    },
    async findApplicationByPackage() {
      return null;
    },
    async listApplications() {
      return [];
    },
    async createApplication(d: any) {
      return d;
    },
    async updateApplication(_i: string, d: any) {
      return d;
    },
    async deleteApplication() {},
    async createEvent(d: any) {
      return { id: `event-${++counter}`, ...d, createdAt: new Date() };
    },
    async listEvents() {
      return [];
    },
    async findGroup() {
      return null;
    },
    async listGroups() {
      return [];
    },
    async createGroup(d: any) {
      return d;
    },
    async updateGroup(_i: string, d: any) {
      return d;
    },
    async deleteGroup() {},
    async listDevicesInGroup() {
      return [];
    },
    async addDeviceToGroup() {},
    async removeDeviceFromGroup() {},
    async getDeviceGroups() {
      return [];
    },
    async findPushToken() {
      return null;
    },
    async upsertPushToken(d: any) {
      return d;
    },
    async deletePushToken() {},
  };

  return adapter;
}

/** A push adapter whose success can be toggled per test. */
function createFlakyPush(): PushAdapter & { succeed: boolean; sends: number } {
  const push: any = {
    succeed: true,
    sends: 0,
    async send() {
      push.sends += 1;
      if (!push.succeed) {
        return { success: false, error: 'device unreachable' };
      }
      return { success: true, messageId: `msg-${push.sends}` };
    },
    async sendBatch() {
      return { successCount: 0, failureCount: 0, results: [] };
    },
    async registerToken() {},
    async unregisterToken() {},
  };
  return push;
}

function buildMDM(commandsConfig?: Record<string, unknown>) {
  const db = createMemoryAdapter();
  const push = createFlakyPush();

  const mdm = createMDM({
    database: db,
    logger: createSilentLogger(),
    enrollment: { deviceSecret: 'durability-secret', autoEnroll: true },
    commands: commandsConfig,
  }) as MDMInstance;

  // createMDM builds its own push adapter from config; swap in the flaky one
  // so tests can drive delivery failures.
  (mdm as any).push.send = push.send;

  return { mdm, db, push };
}

describe('command idempotency', () => {
  let stack: ReturnType<typeof buildMDM>;
  let deviceId: string;

  beforeEach(async () => {
    stack = buildMDM();
    deviceId = (await stack.db.createDevice({ model: 'Pixel' })).id;
  });

  it('returns the same command for a repeated idempotency key', async () => {
    const first = await stack.mdm.devices.sendCommand(deviceId, {
      type: 'wipe',
      idempotencyKey: 'wipe-request-1',
    });
    const second = await stack.mdm.devices.sendCommand(deviceId, {
      type: 'wipe',
      idempotencyKey: 'wipe-request-1',
    });

    expect(second.id).toBe(first.id);
    expect(stack.db._commands.size).toBe(1);
  });

  it('does not re-push a duplicate', async () => {
    await stack.mdm.devices.sendCommand(deviceId, { type: 'wipe', idempotencyKey: 'k' });
    const pushesAfterFirst = stack.push.sends;

    await stack.mdm.devices.sendCommand(deviceId, { type: 'wipe', idempotencyKey: 'k' });

    expect(stack.push.sends).toBe(pushesAfterFirst);
  });

  it('scopes keys per device', async () => {
    const other = await stack.db.createDevice({ model: 'Pixel 2' });

    await stack.mdm.devices.sendCommand(deviceId, { type: 'sync', idempotencyKey: 'shared' });
    await stack.mdm.devices.sendCommand(other.id, { type: 'sync', idempotencyKey: 'shared' });

    expect(stack.db._commands.size).toBe(2);
  });

  it('still queues distinct commands without a key', async () => {
    await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });

    expect(stack.db._commands.size).toBe(2);
  });
});

describe('command expiry', () => {
  let stack: ReturnType<typeof buildMDM>;
  let deviceId: string;

  beforeEach(async () => {
    stack = buildMDM();
    deviceId = (await stack.db.createDevice({ model: 'Pixel' })).id;
  });

  it('applies the default TTL', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });

    expect(command.expiresAt).toBeInstanceOf(Date);
    expect(command.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('honours an explicit ttlSeconds', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, {
      type: 'sync',
      ttlSeconds: 60,
    });

    const delta = command.expiresAt!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(50_000);
    expect(delta).toBeLessThanOrEqual(60_000);
  });

  it('leaves expiry unset when the TTL is 0', async () => {
    const noTtl = buildMDM({ defaultTtlSeconds: 0 });
    const device = await noTtl.db.createDevice({ model: 'Pixel' });

    const command = await noTtl.mdm.devices.sendCommand(device.id, { type: 'sync' });

    expect(command.expiresAt ?? null).toBeNull();
  });

  it('withholds an expired command from the device even if the reaper has not run', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, {
      type: 'factoryReset',
      ttlSeconds: 60,
    });

    // The device was offline long enough for the command to expire.
    stack.db._commands.get(command.id).expiresAt = new Date(Date.now() - 1000);

    const pending = await stack.mdm.commands.getPending(deviceId);

    expect(pending).toHaveLength(0);
    // ...and the row is settled, not left dangling for the next poll.
    expect(stack.db._commands.get(command.id).status).toBe('expired');
  });

  it('reaps expired commands via expireStale()', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    stack.db._commands.get(command.id).expiresAt = new Date(Date.now() - 1000);

    const reaped = await stack.mdm.commands.expireStale();

    expect(reaped).toBe(1);
    expect(stack.db._commands.get(command.id).status).toBe('expired');
  });

  it('does not expire commands the device already completed', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    await stack.mdm.commands.complete(command.id, { success: true });
    stack.db._commands.get(command.id).expiresAt = new Date(Date.now() - 1000);

    await stack.mdm.commands.expireStale();

    expect(stack.db._commands.get(command.id).status).toBe('completed');
  });
});

describe('delivery retry and dead-lettering', () => {
  let stack: ReturnType<typeof buildMDM>;
  let deviceId: string;

  beforeEach(async () => {
    // backoff 0 so the sweep is immediately eligible
    stack = buildMDM({ retryBackoffSeconds: 0, defaultMaxAttempts: 3 });
    deviceId = (await stack.db.createDevice({ model: 'Pixel' })).id;
  });

  it('records the attempt and leaves the command pending when push fails', async () => {
    stack.push.succeed = false;

    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });

    expect(command.status).toBe('pending');
    expect(command.attemptCount).toBe(1);
  });

  it('marks the command sent when push succeeds', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });

    expect(command.status).toBe('sent');
    expect(command.attemptCount).toBe(1);
  });

  it('re-delivers a failed command on the next sweep', async () => {
    stack.push.succeed = false;
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    expect(command.status).toBe('pending');

    stack.push.succeed = true;
    const result = await stack.mdm.commands.retryPending();

    expect(result.delivered).toBe(1);
    expect(stack.db._commands.get(command.id).status).toBe('sent');
  });

  it('dead-letters a command that exhausts its attempts', async () => {
    stack.push.succeed = false;

    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    // attempt 1 spent on send; sweeps spend 2 and 3
    await stack.mdm.commands.retryPending();
    const final = await stack.mdm.commands.retryPending();

    expect(final.deadLettered).toBe(1);

    const row = stack.db._commands.get(command.id);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('DELIVERY_EXHAUSTED');
    expect(row.attemptCount).toBe(3);
  });

  it('emits command.failed when dead-lettering', async () => {
    stack.push.succeed = false;
    const handler = vi.fn();
    stack.mdm.on('command.failed', handler);

    await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    await stack.mdm.commands.retryPending();
    await stack.mdm.commands.retryPending();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload.error).toBe('DELIVERY_EXHAUSTED');
  });

  it('stops retrying a dead-lettered command', async () => {
    stack.push.succeed = false;
    await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    await stack.mdm.commands.retryPending();
    await stack.mdm.commands.retryPending();

    const after = await stack.mdm.commands.retryPending();

    expect(after).toEqual({ delivered: 0, retried: 0, deadLettered: 0 });
  });

  it('does not retry an expired command', async () => {
    stack.push.succeed = false;
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    stack.db._commands.get(command.id).expiresAt = new Date(Date.now() - 1000);

    stack.push.succeed = true;
    const result = await stack.mdm.commands.retryPending();

    expect(result.delivered).toBe(0);
  });

  it('survives a push adapter that throws', async () => {
    (stack.mdm as any).push.send = async () => {
      throw new Error('FCM exploded');
    };

    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });

    expect(command.status).toBe('pending');
    expect(command.attemptCount).toBe(1);
  });
});

describe('acknowledged-command watchdog', () => {
  let stack: ReturnType<typeof buildMDM>;
  let deviceId: string;

  beforeEach(async () => {
    // ackTimeoutSeconds: 0 in the config means "disabled", so use a tiny window
    // and backdate acknowledgedAt to simulate elapsed time.
    stack = buildMDM({ ackTimeoutSeconds: 60, retryBackoffSeconds: 0, defaultMaxAttempts: 3 });
    deviceId = (await stack.db.createDevice({ model: 'Pixel' })).id;
  });

  /** Acknowledge a command and pretend it happened `secondsAgo` ago. */
  async function ackAndAge(commandId: string, secondsAgo: number) {
    await stack.mdm.commands.acknowledge(commandId);
    stack.db._commands.get(commandId).acknowledgedAt = new Date(Date.now() - secondsAgo * 1000);
  }

  it('requeues a command the device acked and never finished', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'installApp' });
    await ackAndAge(command.id, 120); // acked 2 minutes ago, timeout is 60s

    // Before the sweep, the command is invisible to the device: getPending only
    // returns pending/sent, so an acked-then-crashed agent never sees it again.
    expect(await stack.mdm.commands.getPending(deviceId)).toHaveLength(0);

    const result = await stack.mdm.commands.sweepStuck();

    expect(result.requeued).toBe(1);
    expect(stack.db._commands.get(command.id).status).toBe('pending');
    expect(await stack.mdm.commands.getPending(deviceId)).toHaveLength(1);
  });

  it('leaves a freshly-acked command alone', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    await ackAndAge(command.id, 5); // well inside the 60s window

    const result = await stack.mdm.commands.sweepStuck();

    expect(result.requeued).toBe(0);
    expect(stack.db._commands.get(command.id).status).toBe('acknowledged');
  });

  it('leaves completed commands alone', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    await stack.mdm.commands.acknowledge(command.id);
    await stack.mdm.commands.complete(command.id, { success: true });
    stack.db._commands.get(command.id).acknowledgedAt = new Date(Date.now() - 3600_000);

    const result = await stack.mdm.commands.sweepStuck();

    expect(result.requeued).toBe(0);
    expect(stack.db._commands.get(command.id).status).toBe('completed');
  });

  it('a requeued command is re-delivered by the next retry sweep', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'installApp' });
    await ackAndAge(command.id, 120);

    await stack.mdm.commands.sweepStuck();
    const retry = await stack.mdm.commands.retryPending();

    expect(retry.delivered).toBe(1);
    expect(stack.db._commands.get(command.id).status).toBe('sent');
  });

  it('emits command.requeued', async () => {
    const handler = vi.fn();
    stack.mdm.on('command.requeued', handler);

    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    await ackAndAge(command.id, 120);
    await stack.mdm.commands.sweepStuck();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload.reason).toBe('ACK_TIMEOUT');
  });

  it('dead-letters a device that keeps acking and dying', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });
    // Burn the attempts.
    stack.db._commands.get(command.id).attemptCount = 3;
    await ackAndAge(command.id, 120);

    const result = await stack.mdm.commands.sweepStuck();

    expect(result.deadLettered).toBe(1);
    const row = stack.db._commands.get(command.id);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('ACK_TIMEOUT_EXHAUSTED');
  });

  it('does not requeue an expired command — that is the reaper’s job', async () => {
    const command = await stack.mdm.devices.sendCommand(deviceId, { type: 'factoryReset' });
    await ackAndAge(command.id, 120);
    stack.db._commands.get(command.id).expiresAt = new Date(Date.now() - 1000);

    const result = await stack.mdm.commands.sweepStuck();

    expect(result.requeued).toBe(0);
  });

  it('is disabled when ackTimeoutSeconds is 0', async () => {
    const disabled = buildMDM({ ackTimeoutSeconds: 0 });
    const device = await disabled.db.createDevice({ model: 'Pixel' });
    const command = await disabled.mdm.devices.sendCommand(device.id, { type: 'sync' });
    await disabled.mdm.commands.acknowledge(command.id);
    disabled.db._commands.get(command.id).acknowledgedAt = new Date(Date.now() - 86_400_000);

    const result = await disabled.mdm.commands.sweepStuck();

    expect(result).toEqual({ requeued: 0, deadLettered: 0 });
    expect(disabled.db._commands.get(command.id).status).toBe('acknowledged');
  });
});
