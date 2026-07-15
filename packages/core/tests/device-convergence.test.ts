/**
 * Device lifecycle, desired state, canonical inventory, and update enforcement.
 *
 * These four are one system, not four features:
 *
 * - **Desired state** is the primitive. A command is an *event* — miss it and the
 *   intent is gone. Desired state is a *fact*: it rides on every heartbeat until
 *   the device reports it has converged. "Put this device in maintenance mode"
 *   belongs here; a maintenance flag that lives only client-side, or only in a
 *   command the device never received, describes a device nobody can account for.
 * - **Canonical inventory** is the observed half. App versions lived only inside
 *   a JSON blob, so a reconcile loop could not ask "observed != desired" in SQL
 *   at all, and "which devices run the broken build?" meant walking JSON for the
 *   whole fleet.
 * - **Update enforcement** is then just: compare the two, act, back off, escalate.
 * - **Lifecycle** governs the status writes all of the above depend on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMDM, createSilentLogger } from '../src/index';
import type { Device, MDMInstance } from '../src/types';

function createMemoryAdapter() {
  const devices = new Map<string, any>();
  const commands = new Map<string, any>();
  const apps = new Map<string, any>(); // `${deviceId}:${pkg}`
  const applications = new Map<string, any>();
  let counter = 0;

  const key = (deviceId: string, pkg: string) => `${deviceId}:${pkg}`;

  const adapter: any = {
    _devices: devices,
    _commands: commands,
    _apps: apps,

    async findDevice(id: string) {
      return devices.get(id) ?? null;
    },
    async findDeviceByEnrollmentId() {
      return null;
    },
    async listDevices(filter?: any) {
      let list = Array.from(devices.values());
      if (!filter?.includeDeleted) list = list.filter((d) => !d.deletedAt);
      if (filter?.status) list = list.filter((d) => d.status === filter.status);
      return { devices: list, total: list.length, limit: 100, offset: 0 };
    },
    async createDevice(data: any) {
      const device = {
        id: `dev_${++counter}`,
        status: 'enrolled',
        desiredStateVersion: 0,
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

    // Canonical inventory
    async syncDeviceApps(deviceId: string, installed: any[]) {
      const now = new Date();
      for (const app of installed) {
        const existing = apps.get(key(deviceId, app.packageName)) ?? {
          deviceId,
          packageName: app.packageName,
          updateAttempts: 0,
        };
        apps.set(key(deviceId, app.packageName), {
          ...existing,
          observedVersion: app.version,
          observedVersionCode: app.versionCode ?? null,
          observedAt: now,
        });
      }
      const reported = new Set(installed.map((a) => a.packageName));
      for (const [k, app] of apps) {
        if (app.deviceId === deviceId && !reported.has(app.packageName)) {
          apps.set(k, { ...app, observedVersion: null, observedAt: now });
        }
      }
    },
    async listDeviceApps(deviceId: string) {
      return Array.from(apps.values()).filter((a) => a.deviceId === deviceId);
    },
    async setDesiredAppVersion(
      deviceIds: string[],
      packageName: string,
      version: string,
      versionCode?: number,
    ) {
      for (const deviceId of deviceIds) {
        const existing = apps.get(key(deviceId, packageName)) ?? {
          deviceId,
          packageName,
        };
        apps.set(key(deviceId, packageName), {
          ...existing,
          desiredVersion: version,
          desiredVersionCode: versionCode ?? null,
          updateAttempts: 0,
          lastAttemptAt: null,
          escalatedAt: null,
        });
      }
    },
    async listAppsNeedingUpdate({ now, backoffSeconds, limit }: any) {
      return Array.from(apps.values())
        .filter((app) => {
          if (!app.desiredVersion) return false;
          if (app.observedVersion === app.desiredVersion) return false;
          if (!app.lastAttemptAt) return true;
          const wait = backoffSeconds * 2 ** Math.max(app.updateAttempts - 1, 0) * 1000;
          return app.lastAttemptAt.getTime() + wait <= now.getTime();
        })
        .slice(0, limit);
    },
    async recordAppUpdateAttempt(deviceId: string, packageName: string) {
      const app = apps.get(key(deviceId, packageName));
      apps.set(key(deviceId, packageName), {
        ...app,
        updateAttempts: (app.updateAttempts ?? 0) + 1,
        lastAttemptAt: new Date(),
      });
    },
    async escalateAppUpdate(deviceId: string, packageName: string) {
      const app = apps.get(key(deviceId, packageName));
      if (!app.escalatedAt) {
        apps.set(key(deviceId, packageName), { ...app, escalatedAt: new Date() });
      }
    },
    async listEscalatedApps(packageName?: string) {
      return Array.from(apps.values()).filter(
        (a) => a.escalatedAt && (!packageName || a.packageName === packageName),
      );
    },

    async findApplication() {
      return null;
    },
    async findApplicationByPackage(pkg: string, version?: string) {
      return (
        Array.from(applications.values()).find(
          (a) => a.packageName === pkg && (!version || a.version === version),
        ) ?? null
      );
    },
    async listApplications() {
      return Array.from(applications.values());
    },
    async createApplication(data: any) {
      const app = { id: `app_${++counter}`, ...data };
      applications.set(app.id, app);
      return app;
    },
    async updateApplication(_i: string, d: any) {
      return d;
    },
    async deleteApplication() {},

    async findCommand(id: string) {
      return commands.get(id) ?? null;
    },
    async listCommands() {
      return Array.from(commands.values());
    },
    async createCommand(data: any) {
      const command = {
        id: `cmd_${++counter}`,
        status: 'pending',
        attemptCount: 0,
        maxAttempts: 5,
        ...data,
        createdAt: new Date(),
      };
      commands.set(command.id, command);
      return command;
    },
    async createCommandIdempotent(data: any) {
      if (data.idempotencyKey) {
        const existing = Array.from(commands.values()).find(
          (c) => c.deviceId === data.deviceId && c.idempotencyKey === data.idempotencyKey,
        );
        if (existing) return { command: existing, created: false };
      }
      return { command: await adapter.createCommand(data), created: true };
    },
    async updateCommand(id: string, data: any) {
      const updated = { ...commands.get(id), ...data };
      commands.set(id, updated);
      return updated;
    },
    async getPendingCommands() {
      return [];
    },

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
    async createEvent(d: any) {
      return { id: `evt_${++counter}`, ...d, createdAt: new Date() };
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

function buildMDM(config: Record<string, unknown> = {}) {
  const db = createMemoryAdapter();
  const mdm = createMDM({
    database: db,
    logger: createSilentLogger(),
    enrollment: { deviceSecret: 'convergence-test', autoEnroll: true },
    ...config,
  }) as MDMInstance;
  return { db, mdm };
}

function heartbeat(mdm: MDMInstance, deviceId: string, data: Record<string, unknown> = {}) {
  return mdm.processHeartbeat(deviceId, {
    deviceId,
    timestamp: new Date(),
    ...data,
  } as never);
}

// ============================================
// Lifecycle
// ============================================

describe('device lifecycle state machine', () => {
  let stack: ReturnType<typeof buildMDM>;
  let device: Device;

  beforeEach(async () => {
    stack = buildMDM();
    device = await stack.db.createDevice({ enrollmentId: 'e1', status: 'enrolled' });
  });

  it('rejects an illegal transition', async () => {
    await stack.mdm.devices.update(device.id, { status: 'unenrolled' });

    // Terminal. A device that comes back must enroll again — resurrecting the
    // row would give it a history it did not live.
    await expect(stack.mdm.devices.update(device.id, { status: 'enrolled' })).rejects.toThrow(
      /Illegal device status transition: unenrolled → enrolled/,
    );
  });

  it('allows a legal transition', async () => {
    const blocked = await stack.mdm.devices.block(device.id, 'stolen');
    expect(blocked.status).toBe('blocked');

    const restored = await stack.mdm.devices.unblock(device.id);
    expect(restored.status).toBe('enrolled');
  });

  it('soft-deletes rather than erasing history', async () => {
    await stack.mdm.devices.delete(device.id);

    // Gone to callers...
    expect(await stack.mdm.devices.get(device.id)).toBeNull();
    // ...but the row survives, so "what happened to this device?" is still
    // answerable. A hard DELETE cascaded away its entire command history.
    expect(stack.db._devices.get(device.id).deletedAt).toBeInstanceOf(Date);
    expect(stack.db._devices.get(device.id).status).toBe('unenrolled');
  });

  it('hard-deletes only when explicitly asked', async () => {
    await stack.mdm.devices.delete(device.id, { hard: true });
    expect(stack.db._devices.has(device.id)).toBe(false);
  });

  it('excludes retired devices from listings', async () => {
    await stack.db.createDevice({ enrollmentId: 'e2' });
    await stack.mdm.devices.delete(device.id);

    const { total } = await stack.mdm.devices.list();
    expect(total).toBe(1);
  });
});

describe('two-phase unenroll', () => {
  let stack: ReturnType<typeof buildMDM>;
  let device: Device;

  beforeEach(async () => {
    stack = buildMDM();
    device = await stack.db.createDevice({ enrollmentId: 'e1', status: 'enrolled' });
  });

  it('arms rather than flipping', async () => {
    const armed = await stack.mdm.devices.beginUnenroll(device.id);

    // NOT unenrolled yet. Flipping straight to `unenrolled` is what strands
    // devices: the row says the device left, while the device — which never got
    // the message — keeps heartbeating at a server that no longer knows it.
    expect(armed.status).toBe('unenrolling');
    expect(stack.db._devices.get(device.id).deletedAt).toBeUndefined();
  });

  it('sends the device an unenroll command', async () => {
    await stack.mdm.devices.beginUnenroll(device.id);

    const sent = Array.from(stack.db._commands.values());
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('unenroll');
  });

  it('sends a factory reset when asked to wipe', async () => {
    await stack.mdm.devices.beginUnenroll(device.id, { wipe: true });

    expect(Array.from(stack.db._commands.values())[0].type).toBe('factoryReset');
  });

  it('queues an overridden command shape when the caller owns the wire protocol', async () => {
    // A fleet mid-migration from a legacy agent protocol: the teardown
    // funnel triggers on `custom`/{action}, not the native command type.
    await stack.mdm.devices.beginUnenroll(device.id, {
      command: { type: 'custom', payload: { action: 'unenroll' } },
    });

    const sent = Array.from(stack.db._commands.values());
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('custom');
    expect(sent[0].payload).toEqual({ action: 'unenroll' });
    // The default dedup key survives an override that doesn't carry its own.
    expect(sent[0].idempotencyKey).toBe(`unenroll:${device.id}`);
  });

  it('lets an overridden command carry its own idempotency key', async () => {
    await stack.mdm.devices.beginUnenroll(device.id, {
      command: {
        type: 'custom',
        payload: { action: 'unenroll' },
        idempotencyKey: 'teardown:custom-key',
      },
    });

    expect(Array.from(stack.db._commands.values())[0].idempotencyKey).toBe('teardown:custom-key');
  });

  it('command override takes precedence over wipe for command selection', async () => {
    await stack.mdm.devices.beginUnenroll(device.id, {
      wipe: true,
      command: { type: 'custom', payload: { action: 'unenroll' } },
    });

    expect(Array.from(stack.db._commands.values())[0].type).toBe('custom');
  });

  it('arms without queueing anything when queueCommand is false', async () => {
    const armed = await stack.mdm.devices.beginUnenroll(device.id, {
      queueCommand: false,
    });

    expect(armed.status).toBe('unenrolling');
    expect(Array.from(stack.db._commands.values())).toHaveLength(0);
  });

  it('a queueCommand:false arm still completes and cancels normally', async () => {
    await stack.mdm.devices.beginUnenroll(device.id, { queueCommand: false });
    const restored = await stack.mdm.devices.cancelUnenroll(device.id);
    expect(restored.status).toBe('enrolled');

    await stack.mdm.devices.beginUnenroll(device.id, { queueCommand: false });
    const gone = await stack.mdm.devices.completeUnenroll(device.id);
    expect(gone.status).toBe('unenrolled');
  });

  it('does not queue the same unenroll twice', async () => {
    await stack.mdm.devices.beginUnenroll(device.id);
    // An operator clicking twice must not queue two wipes.
    await stack.mdm.devices.cancelUnenroll(device.id);
    await stack.mdm.devices.beginUnenroll(device.id);

    expect(Array.from(stack.db._commands.values())).toHaveLength(1);
  });

  it('completes when the device confirms', async () => {
    await stack.mdm.devices.beginUnenroll(device.id);
    const gone = await stack.mdm.devices.completeUnenroll(device.id);

    expect(gone.status).toBe('unenrolled');
    expect(gone.deletedAt).toBeInstanceOf(Date);
  });

  it('refuses to complete an unenroll that was never armed', async () => {
    await expect(stack.mdm.devices.completeUnenroll(device.id)).rejects.toThrow(
      /not 'unenrolling'/,
    );
  });

  it('can force-complete a device that never acknowledged', async () => {
    const gone = await stack.mdm.devices.completeUnenroll(device.id, { force: true });
    expect(gone.status).toBe('unenrolled');
  });

  it('can be called off', async () => {
    await stack.mdm.devices.beginUnenroll(device.id);
    const restored = await stack.mdm.devices.cancelUnenroll(device.id);

    expect(restored.status).toBe('enrolled');
  });
});

// ============================================
// Desired state
// ============================================

describe('desired state', () => {
  let stack: ReturnType<typeof buildMDM>;
  let device: Device;

  beforeEach(async () => {
    stack = buildMDM();
    device = await stack.db.createDevice({ enrollmentId: 'e1' });
  });

  it('merges a patch and bumps the version', async () => {
    const updated = await stack.mdm.devices.setDesiredState(device.id, {
      maintenanceMode: true,
    });

    expect(updated.desiredState).toEqual({ maintenanceMode: true });
    expect(updated.desiredStateVersion).toBe(1);
  });

  it('merges rather than replacing', async () => {
    await stack.mdm.devices.setDesiredState(device.id, { maintenanceMode: true });
    const updated = await stack.mdm.devices.setDesiredState(device.id, { kioskApp: 'com.x' });

    expect(updated.desiredState).toEqual({ maintenanceMode: true, kioskApp: 'com.x' });
    expect(updated.desiredStateVersion).toBe(2);
  });

  it('null deletes a key rather than storing null', async () => {
    await stack.mdm.devices.setDesiredState(device.id, { maintenanceMode: true });
    const updated = await stack.mdm.devices.setDesiredState(device.id, {
      maintenanceMode: null,
    });

    // "Unset" and "set to nothing" are different facts: an unset maintenanceMode
    // means the server has no opinion, which is not "maintenance mode off".
    expect(updated.desiredState).toEqual({});
  });

  it('does not bump the version when nothing changed', async () => {
    await stack.mdm.devices.setDesiredState(device.id, { maintenanceMode: true });
    const again = await stack.mdm.devices.setDesiredState(device.id, { maintenanceMode: true });

    // An operator clicking a toggle that is already in position must not
    // re-version the state and make the whole fleet re-report convergence for a
    // change that never happened.
    expect(again.desiredStateVersion).toBe(1);
  });

  it('is not converged until the device reports the version', async () => {
    await stack.mdm.devices.setDesiredState(device.id, { maintenanceMode: true });

    const before = await stack.mdm.devices.getConvergence(device.id);
    expect(before.converged).toBe(false);
    expect(before.reportedStateVersion).toBeNull();

    await heartbeat(stack.mdm, device.id, { desiredStateVersion: 1 });

    const after = await stack.mdm.devices.getConvergence(device.id);
    expect(after.converged).toBe(true);
    expect(after.reportedStateVersion).toBe(1);
  });

  it('emits device.converged when the device catches up', async () => {
    const handler = vi.fn();
    stack.mdm.on('device.converged', handler);

    await stack.mdm.devices.setDesiredState(device.id, { maintenanceMode: true });
    await heartbeat(stack.mdm, device.id, { desiredStateVersion: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload.stateVersion).toBe(1);
  });

  it('a device reporting a stale version is not converged', async () => {
    await stack.mdm.devices.setDesiredState(device.id, { a: 1 });
    await heartbeat(stack.mdm, device.id, { desiredStateVersion: 1 });
    await stack.mdm.devices.setDesiredState(device.id, { b: 2 }); // v2

    const convergence = await stack.mdm.devices.getConvergence(device.id);
    expect(convergence.converged).toBe(false);
  });
});

// ============================================
// Canonical inventory
// ============================================

describe('canonical app inventory', () => {
  let stack: ReturnType<typeof buildMDM>;
  let device: Device;

  beforeEach(async () => {
    stack = buildMDM();
    device = await stack.db.createDevice({ enrollmentId: 'e1' });
  });

  it('syncs what the device reports into queryable rows', async () => {
    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '1.0.0', versionCode: 1 }],
    });

    const apps = await stack.mdm.devices.getApps(device.id);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ packageName: 'com.player', observedVersion: '1.0.0' });
  });

  it('emits device.appVersionChanged on a version change', async () => {
    const handler = vi.fn();
    stack.mdm.on('device.appVersionChanged', handler);

    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
    });
    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '2.0.0' }],
    });

    // Versions used to be overwritten inside a JSON blob with no record that
    // anything changed, so "when did this fleet start running the broken build?"
    // had no answer.
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0].payload).toMatchObject({
      packageName: 'com.player',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
    });
  });

  it('does not re-announce an unchanged version', async () => {
    const handler = vi.fn();
    stack.mdm.on('device.appVersionChanged', handler);

    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
    });
    handler.mockClear();
    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ============================================
// Update enforcement
// ============================================

describe('app update enforcement', () => {
  let stack: ReturnType<typeof buildMDM>;
  let device: Device;

  beforeEach(async () => {
    stack = buildMDM({ updates: { retryBackoffSeconds: 0, maxAttempts: 3 } });
    device = await stack.db.createDevice({ enrollmentId: 'e1', status: 'enrolled' });

    await stack.db.createApplication({
      packageName: 'com.player',
      version: '2.0.0',
      versionCode: 2,
      url: 'https://cdn/player-2.apk',
      hash: 'abc123',
    });
  });

  it('issues an install when the device is behind', async () => {
    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
    });
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
    });

    const result = await stack.mdm.updates.reconcile();

    expect(result.issued).toBe(1);
    const command = Array.from(stack.db._commands.values())[0];
    expect(command.type).toBe('installApp');
    // The APK hash rides along — without it a compromised download channel is
    // arbitrary code execution as Device Owner.
    expect(command.payload.expectedSha256).toBe('abc123');
  });

  it('installs an app the device has never had — absent is 0.0.0, not "skip"', async () => {
    // No heartbeat: the device has never reported this app at all.
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
    });

    const result = await stack.mdm.updates.reconcile();

    // Treating "absent" as "skip" would make this an upgrade-only engine, and a
    // freshly-provisioned device would silently never get the app it exists to run.
    expect(result.issued).toBe(1);
  });

  it('does nothing once the device has converged', async () => {
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
    });
    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '2.0.0' }],
    });

    const result = await stack.mdm.updates.reconcile();

    expect(result.issued).toBe(0);
    expect(result.converged).toBe(0); // filtered out before it reaches core
  });

  it('does not downgrade a device that is ahead', async () => {
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
    });
    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '3.0.0' }],
    });

    const result = await stack.mdm.updates.reconcile();

    expect(result.converged).toBe(1);
    expect(result.issued).toBe(0);
  });

  it('escalates a device that keeps taking the install and not moving', async () => {
    const handler = vi.fn();
    stack.mdm.on('device.updateEscalated', handler);

    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
    });
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
    });

    // Three sweeps, three installs, and the device never budges.
    await stack.mdm.updates.reconcile();
    await stack.mdm.updates.reconcile();
    await stack.mdm.updates.reconcile();

    const result = await stack.mdm.updates.reconcile();

    expect(result.escalated).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);

    const escalated = await stack.mdm.updates.listEscalated();
    expect(escalated).toHaveLength(1);
  });

  it('escalates once, then goes quiet', async () => {
    const handler = vi.fn();
    stack.mdm.on('device.updateEscalated', handler);

    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
    });
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
    });

    for (let i = 0; i < 6; i++) {
      await stack.mdm.updates.reconcile();
    }

    // Repeating the alert every sweep buries the signal an operator needs.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a new target version gives a stranded device a clean shot', async () => {
    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
    });
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
    });
    for (let i = 0; i < 5; i++) await stack.mdm.updates.reconcile();
    expect(await stack.mdm.updates.listEscalated()).toHaveLength(1);

    await stack.db.createApplication({
      packageName: 'com.player',
      version: '3.0.0',
      versionCode: 3,
      url: 'https://cdn/player-3.apk',
    });
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '3.0.0',
    });

    expect(await stack.mdm.updates.listEscalated()).toHaveLength(0);
    const result = await stack.mdm.updates.reconcile();
    expect(result.issued).toBe(1);
  });

  it('does not issue an install for a version with no registered APK', async () => {
    await heartbeat(stack.mdm, device.id, {
      installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
    });
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '9.9.9', // never uploaded
    });

    const result = await stack.mdm.updates.reconcile();
    expect(result.issued).toBe(0);
  });
});

describe('staged rollout', () => {
  it('targets roughly the requested fraction of the fleet', async () => {
    const stack = buildMDM();
    for (let i = 0; i < 200; i++) {
      await stack.db.createDevice({ enrollmentId: `e${i}`, status: 'enrolled' });
    }

    const { targeted } = await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
      rolloutPercentage: 25,
    });

    // Hashing is not sampling: expect approximately, not exactly, 25%.
    expect(targeted).toBeGreaterThan(200 * 0.1);
    expect(targeted).toBeLessThan(200 * 0.45);
  });

  it('is stable — the same devices stay in the slice across sweeps', async () => {
    const stack = buildMDM();
    for (let i = 0; i < 100; i++) {
      await stack.db.createDevice({ enrollmentId: `e${i}`, status: 'enrolled' });
    }

    const first = await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
      rolloutPercentage: 30,
    });
    const selectedFirst = (
      await stack.db.listAppsNeedingUpdate({
        now: new Date(),
        backoffSeconds: 0,
        limit: 1000,
      })
    )
      .map((a: any) => a.deviceId)
      .sort();

    // Re-running the same rollout must select the same devices. Random sampling
    // would re-roll the dice and eventually creep to the whole fleet.
    await stack.mdm.updates.setDesiredAppVersion({
      packageName: 'com.player',
      version: '2.0.0',
      rolloutPercentage: 30,
    });
    const selectedAgain = (
      await stack.db.listAppsNeedingUpdate({
        now: new Date(),
        backoffSeconds: 0,
        limit: 1000,
      })
    )
      .map((a: any) => a.deviceId)
      .sort();

    expect(selectedAgain).toEqual(selectedFirst);
    expect(first.targeted).toBe(selectedFirst.length);
  });

  it('draws an independent slice per version — the same 10% are not always the canaries', async () => {
    const stack = buildMDM();
    for (let i = 0; i < 300; i++) {
      await stack.db.createDevice({ enrollmentId: `e${i}`, status: 'enrolled' });
    }

    const bucketFor = async (version: string) => {
      const fresh = buildMDM();
      for (let i = 0; i < 300; i++) {
        await fresh.db.createDevice({ enrollmentId: `e${i}`, status: 'enrolled' });
      }
      await fresh.mdm.updates.setDesiredAppVersion({
        packageName: 'com.player',
        version,
        rolloutPercentage: 10,
      });
      return new Set(
        (
          await fresh.db.listAppsNeedingUpdate({
            now: new Date(),
            backoffSeconds: 0,
            limit: 1000,
          })
        ).map((a: any) => a.deviceId),
      );
    };

    const canariesV2 = await bucketFor('2.0.0');
    const canariesV3 = await bucketFor('3.0.0');

    // If the hash were salted by device id alone, these two sets would be
    // identical — the same unlucky 10% of the fleet would be the canary for
    // every release we ever ship, and would eat every bad build.
    const overlap = [...canariesV2].filter((id) => canariesV3.has(id));
    expect(overlap.length).toBeLessThan(canariesV2.size);
  });
});
