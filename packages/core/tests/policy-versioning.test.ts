/**
 * Policy versioning, history, rollback, and drift detection.
 *
 * Policies used to mutate in place with no version at all. Devices reported a
 * `policyVersion` in every heartbeat and core never read it, so "is this device
 * running the current policy?" was a question the system could not answer —
 * there was no rollout state, no drift detection, no history, and no rollback.
 * Separately, the plugin `validatePolicy` hook was part of the plugin interface
 * and was never called, so a plugin could reject a policy and be ignored.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMDM, createSilentLogger } from '../src/index';
import type { MDMInstance, MDMPlugin, PolicySettings, PolicyVersion } from '../src/types';

function createMemoryAdapter() {
  const devices = new Map<string, any>();
  const policies = new Map<string, any>();
  const policyVersions: PolicyVersion[] = [];
  let counter = 0;

  const adapter: any = {
    _devices: devices,
    _policies: policies,
    _policyVersions: policyVersions,

    async findDevice(id: string) {
      return devices.get(id) ?? null;
    },
    async findDeviceByEnrollmentId() {
      return null;
    },
    async listDevices(filter?: any) {
      let list = Array.from(devices.values());
      if (filter?.policyId) list = list.filter((d) => d.policyId === filter.policyId);
      return { devices: list, total: list.length, limit: 100, offset: 0 };
    },
    async createDevice(data: any) {
      const device = {
        id: `dev_${++counter}`,
        status: 'enrolled',
        appliedPolicyVersion: null,
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

    async findPolicy(id: string) {
      return policies.get(id) ?? null;
    },
    async findDefaultPolicy() {
      return Array.from(policies.values()).find((p) => p.isDefault) ?? null;
    },
    async listPolicies() {
      return Array.from(policies.values());
    },
    async createPolicy(data: any) {
      const policy = {
        id: `pol_${++counter}`,
        isDefault: false,
        ...data,
        version: data.version ?? 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      policies.set(policy.id, policy);
      return policy;
    },
    async updatePolicy(id: string, data: any) {
      const updated = { ...policies.get(id), ...data, updatedAt: new Date() };
      policies.set(id, updated);
      return updated;
    },
    async deletePolicy(id: string) {
      policies.delete(id);
    },

    // Policy history
    async createPolicyVersion(data: any) {
      const existing = policyVersions.find(
        (v) => v.policyId === data.policyId && v.version === data.version,
      );
      if (existing) return existing;
      const snapshot = {
        id: `pv_${++counter}`,
        ...data,
        createdAt: new Date(),
      } as PolicyVersion;
      policyVersions.push(snapshot);
      return snapshot;
    },
    async listPolicyVersions(policyId: string) {
      return policyVersions
        .filter((v) => v.policyId === policyId)
        .sort((a, b) => b.version - a.version);
    },
    async findPolicyVersion(policyId: string, version: number) {
      return policyVersions.find((v) => v.policyId === policyId && v.version === version) ?? null;
    },

    async findCommand() {
      return null;
    },
    async listCommands() {
      return [];
    },
    async createCommand(d: any) {
      return { id: `cmd_${++counter}`, status: 'pending', attemptCount: 0, maxAttempts: 5, ...d };
    },
    async updateCommand(_i: string, d: any) {
      return d;
    },
    async getPendingCommands() {
      return [];
    },
    async createEvent(d: any) {
      return { id: `evt_${++counter}`, ...d, createdAt: new Date() };
    },
    async listEvents() {
      return [];
    },
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

function buildMDM(plugins: MDMPlugin[] = []) {
  const db = createMemoryAdapter();
  const mdm = createMDM({
    database: db,
    logger: createSilentLogger(),
    enrollment: { deviceSecret: 'policy-test', autoEnroll: true },
    plugins,
  }) as MDMInstance;
  return { db, mdm };
}

const KIOSK: PolicySettings = { kioskMode: true, mainApp: 'com.example.kiosk' } as PolicySettings;
const RELAXED: PolicySettings = { kioskMode: false } as PolicySettings;

describe('policy versioning', () => {
  let stack: ReturnType<typeof buildMDM>;

  beforeEach(() => {
    stack = buildMDM();
  });

  it('starts new policies at version 1', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });

    expect(policy.version).toBe(1);
  });

  it('bumps the version when settings change', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });

    const updated = await stack.mdm.policies.update(policy.id, { settings: RELAXED });

    expect(updated.version).toBe(2);
  });

  it('does NOT bump the version for a rename', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });

    const renamed = await stack.mdm.policies.update(policy.id, { name: 'Kiosk (EMEA)' });

    // Devices act on settings. Marking the whole fleet as drifted because
    // someone fixed a typo in the policy name would make drift meaningless.
    expect(renamed.version).toBe(1);
  });

  it('does not bump when settings are re-submitted unchanged', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });

    const resubmitted = await stack.mdm.policies.update(policy.id, { settings: { ...KIOSK } });

    expect(resubmitted.version).toBe(1);
  });

  it('emits policy.updated with the previous version and blast radius', async () => {
    const handler = vi.fn();
    stack.mdm.on('policy.updated', handler);

    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    await stack.db.createDevice({ enrollmentId: 'd1', policyId: policy.id });

    await stack.mdm.policies.update(policy.id, { settings: RELAXED });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload).toMatchObject({
      previousVersion: 1,
      affectedDeviceCount: 1,
    });
  });
});

describe('policy history and rollback', () => {
  let stack: ReturnType<typeof buildMDM>;

  beforeEach(() => {
    stack = buildMDM();
  });

  it('snapshots every version', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    await stack.mdm.policies.update(policy.id, { settings: RELAXED });

    const history = await stack.mdm.policies.history(policy.id);

    expect(history).toHaveLength(2);
    expect(history[0]!.version).toBe(2); // newest first
    expect(history[1]!.version).toBe(1);
    expect(history[1]!.settings).toMatchObject({ kioskMode: true });
  });

  it('restores earlier settings on rollback', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    await stack.mdm.policies.update(policy.id, { settings: RELAXED });

    const rolled = await stack.mdm.policies.rollback(policy.id, 1);

    expect(rolled.settings).toMatchObject({ kioskMode: true });
  });

  it('rolls FORWARD — a rollback is a new version, not a rewind', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    await stack.mdm.policies.update(policy.id, { settings: RELAXED }); // v2

    const rolled = await stack.mdm.policies.rollback(policy.id, 1);

    // v3, not v1. Rewinding the counter would make the rollback invisible to a
    // device that had already applied v1: it would compare its applied version
    // against an identical number, conclude it was compliant, and never
    // re-apply the restored settings.
    expect(rolled.version).toBe(3);

    const history = await stack.mdm.policies.history(policy.id);
    expect(history.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it('emits policy.rolledBack', async () => {
    const handler = vi.fn();
    stack.mdm.on('policy.rolledBack', handler);

    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    await stack.mdm.policies.update(policy.id, { settings: RELAXED });
    await stack.mdm.policies.rollback(policy.id, 1);

    expect(handler.mock.calls[0][0].payload).toMatchObject({
      fromVersion: 2,
      restoredVersion: 1,
    });
  });

  it('refuses to roll back to a version that never existed', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });

    await expect(stack.mdm.policies.rollback(policy.id, 7)).rejects.toThrow(/no version 7/);
  });

  it('fetches a single historical version', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    await stack.mdm.policies.update(policy.id, { settings: RELAXED });

    const v1 = await stack.mdm.policies.getVersion(policy.id, 1);

    expect(v1?.settings).toMatchObject({ kioskMode: true });
    expect(await stack.mdm.policies.getVersion(policy.id, 99)).toBeNull();
  });
});

describe('policy drift and compliance', () => {
  let stack: ReturnType<typeof buildMDM>;

  beforeEach(() => {
    stack = buildMDM();
  });

  async function seed() {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    const device = await stack.db.createDevice({ enrollmentId: 'd1', policyId: policy.id });
    return { policy, device };
  }

  function heartbeat(deviceId: string, policyVersion?: string | number) {
    return stack.mdm.processHeartbeat(deviceId, {
      deviceId,
      timestamp: new Date(),
      policyVersion,
    } as any);
  }

  it('records the version the device reports', async () => {
    const { device } = await seed();

    await heartbeat(device.id, '1');

    expect(stack.db._devices.get(device.id).appliedPolicyVersion).toBe(1);
  });

  it('accepts a numeric policyVersion as well as a string', async () => {
    const { device } = await seed();

    await heartbeat(device.id, 2);

    expect(stack.db._devices.get(device.id).appliedPolicyVersion).toBe(2);
  });

  it('ignores a garbage policyVersion rather than coercing it', async () => {
    const { device } = await seed();

    await heartbeat(device.id, 'not-a-version');

    // Number('not-a-version') is NaN; coercing it to 0 would be worse than
    // useless — a garbage value must not be mistaken for a real report.
    expect(stack.db._devices.get(device.id).appliedPolicyVersion).toBeNull();
  });

  it('reports compliant when the device is on the current version', async () => {
    const { device } = await seed();
    await heartbeat(device.id, 1);

    const compliance = await stack.mdm.devices.getPolicyCompliance(device.id);

    expect(compliance).toMatchObject({ status: 'compliant', currentVersion: 1, appliedVersion: 1 });
  });

  it('reports pending after the policy moves ahead of the device', async () => {
    const { policy, device } = await seed();
    await heartbeat(device.id, 1);

    await stack.mdm.policies.update(policy.id, { settings: RELAXED });

    const compliance = await stack.mdm.devices.getPolicyCompliance(device.id);
    expect(compliance).toMatchObject({ status: 'pending', currentVersion: 2, appliedVersion: 1 });
  });

  it('reports unknown for a device that has never said', async () => {
    const { device } = await seed();

    const compliance = await stack.mdm.devices.getPolicyCompliance(device.id);
    expect(compliance.status).toBe('unknown');
  });

  it('reports unassigned when no policy is attached', async () => {
    const device = await stack.db.createDevice({ enrollmentId: 'd9' });

    const compliance = await stack.mdm.devices.getPolicyCompliance(device.id);
    expect(compliance.status).toBe('unassigned');
  });

  it('emits device.policyDrifted when a stale device checks in', async () => {
    const handler = vi.fn();
    stack.mdm.on('device.policyDrifted', handler);

    const { policy, device } = await seed();
    await stack.mdm.policies.update(policy.id, { settings: RELAXED }); // v2

    await heartbeat(device.id, 1); // device still on v1

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload).toMatchObject({
      appliedVersion: 1,
      currentVersion: 2,
    });
  });

  it('keeps announcing drift on every heartbeat until it converges', async () => {
    const handler = vi.fn();
    stack.mdm.on('device.policyDrifted', handler);

    const { policy, device } = await seed();
    await stack.mdm.policies.update(policy.id, { settings: RELAXED });

    await heartbeat(device.id, 1);
    await heartbeat(device.id, 1);

    // A device that never converges should keep announcing itself rather than
    // going quiet after a single alert.
    expect(handler).toHaveBeenCalledTimes(2);

    await heartbeat(device.id, 2); // converged
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not report drift for a device ahead of the server', async () => {
    const { device } = await seed();

    await heartbeat(device.id, 5);

    const compliance = await stack.mdm.devices.getPolicyCompliance(device.id);
    expect(compliance.status).toBe('compliant');
  });

  it('summarises fleet rollout state', async () => {
    const policy = await stack.mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    const applied = await stack.db.createDevice({ enrollmentId: 'a', policyId: policy.id });
    const lagging = await stack.db.createDevice({ enrollmentId: 'b', policyId: policy.id });
    await stack.db.createDevice({ enrollmentId: 'c', policyId: policy.id }); // never reported

    await heartbeat(applied.id, 1);
    await heartbeat(lagging.id, 1);
    await stack.mdm.policies.update(policy.id, { settings: RELAXED }); // v2
    await heartbeat(applied.id, 2);

    const compliance = await stack.mdm.policies.getCompliance(policy.id);

    expect(compliance).toMatchObject({
      version: 2,
      total: 3,
      compliant: 1,
      pending: 1,
      unknown: 1,
    });
    expect(compliance.laggingDeviceIds).toHaveLength(2);
    expect(compliance.laggingDeviceIds).toContain(lagging.id);
  });
});

describe('plugin validatePolicy is invoked', () => {
  function rejectingPlugin(): MDMPlugin {
    return {
      name: 'strict-kiosk',
      async validatePolicy(settings: PolicySettings) {
        if (settings.kioskMode && !settings.mainApp) {
          return { valid: false, errors: ['kioskMode requires mainApp'] };
        }
        return { valid: true };
      },
    };
  }

  it('rejects an invalid policy on create', async () => {
    const { mdm } = buildMDM([rejectingPlugin()]);

    // The hook has been in the plugin interface all along and core never called
    // it, so a plugin could declare a policy invalid and be ignored entirely.
    await expect(
      mdm.policies.create({ name: 'Broken', settings: { kioskMode: true } as PolicySettings }),
    ).rejects.toThrow(/kioskMode requires mainApp/);
  });

  it('rejects an invalid policy on update', async () => {
    const { mdm } = buildMDM([rejectingPlugin()]);
    const policy = await mdm.policies.create({ name: 'Kiosk', settings: KIOSK });

    await expect(
      mdm.policies.update(policy.id, { settings: { kioskMode: true } as PolicySettings }),
    ).rejects.toThrow(/kioskMode requires mainApp/);
  });

  it('accepts a valid policy', async () => {
    const { mdm } = buildMDM([rejectingPlugin()]);

    await expect(mdm.policies.create({ name: 'Kiosk', settings: KIOSK })).resolves.toMatchObject({
      version: 1,
    });
  });
});
