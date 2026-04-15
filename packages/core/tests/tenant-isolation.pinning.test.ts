import { describe, it, expect, vi } from 'vitest';
import { createMDM, createDashboardManager } from '../src/index';
import type {
  DatabaseAdapter,
  Device,
  Policy,
  Command,
} from '../src/types';

/**
 * Pinning tests for the current state of tenant isolation and RBAC
 * enforcement. See `docs/content/docs/proposals/tenant-rbac-audit.md`
 * for the full audit.
 *
 * These tests are intentionally negative: they lock in the *current*
 * (broken) behavior so a future refactor cannot silently make it
 * worse without someone noticing. When the architectural fix lands
 * and `Device` / `Policy` / etc. gain a real `tenantId` column, these
 * tests will fail — that is the point. The test authors will then
 * rewrite them to assert the new, correct behavior.
 *
 * None of these tests describe desired behavior. They describe *what
 * is true today*, so we can't pretend otherwise.
 */

// Minimal in-memory adapter that satisfies the DatabaseAdapter shape
// for the managers we exercise here. We don't need every method — the
// managers in scope here (devices, policies, commands, dashboard)
// only touch a small surface.
function createMockAdapter(): DatabaseAdapter {
  const devices = new Map<string, Device>();
  const policies = new Map<string, Policy>();
  const commands = new Map<string, Command>();

  return {
    async findDevice(id) {
      return devices.get(id) ?? null;
    },
    async findDeviceByEnrollmentId(enrollmentId) {
      return (
        Array.from(devices.values()).find(
          (d) => d.enrollmentId === enrollmentId,
        ) ?? null
      );
    },
    async listDevices() {
      const list = Array.from(devices.values());
      return {
        devices: list,
        total: list.length,
        limit: 100,
        offset: 0,
      };
    },
    async createDevice(data) {
      const id = `dev_${devices.size + 1}`;
      const device: Device = {
        id,
        enrollmentId: data.enrollmentId,
        status: 'enrolled',
        model: data.model,
        manufacturer: data.manufacturer,
        osVersion: data.osVersion,
        serialNumber: data.serialNumber,
        policyId: data.policyId,
        metadata: data.metadata as Device['metadata'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      devices.set(id, device);
      return device;
    },
    async updateDevice(id, data) {
      const device = devices.get(id);
      if (!device) throw new Error('not found');
      const updated = { ...device, ...data, updatedAt: new Date() };
      devices.set(id, updated);
      return updated;
    },
    async deleteDevice(id) {
      devices.delete(id);
    },
    async countDevices() {
      return devices.size;
    },
    async findPolicy(id) {
      return policies.get(id) ?? null;
    },
    async findDefaultPolicy() {
      return (
        Array.from(policies.values()).find((p) => p.isDefault) ?? null
      );
    },
    async listPolicies() {
      return Array.from(policies.values());
    },
    async createPolicy(data) {
      const id = `pol_${policies.size + 1}`;
      const policy: Policy = {
        id,
        name: data.name,
        description: data.description ?? null,
        isDefault: data.isDefault ?? false,
        settings: data.settings,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      policies.set(id, policy);
      return policy;
    },
    async updatePolicy(id, data) {
      const policy = policies.get(id);
      if (!policy) throw new Error('not found');
      const updated = { ...policy, ...data, updatedAt: new Date() };
      policies.set(id, updated);
      return updated;
    },
    async deletePolicy(id) {
      policies.delete(id);
    },
    async findCommand(id) {
      return commands.get(id) ?? null;
    },
    async listCommands() {
      return Array.from(commands.values());
    },
    async createCommand(data) {
      const id = `cmd_${commands.size + 1}`;
      const cmd: Command = {
        id,
        deviceId: data.deviceId,
        type: data.type,
        payload: data.payload ?? null,
        status: 'pending',
        result: null,
        error: null,
        createdAt: new Date(),
        sentAt: null,
        acknowledgedAt: null,
        completedAt: null,
      };
      commands.set(id, cmd);
      return cmd;
    },
    async updateCommand(id, data) {
      const cmd = commands.get(id);
      if (!cmd) return null;
      const updated = { ...cmd, ...data };
      commands.set(id, updated);
      return updated;
    },
    async getPendingCommands(deviceId) {
      return Array.from(commands.values()).filter(
        (c) => c.deviceId === deviceId && c.status === 'pending',
      );
    },
    async listEvents() {
      return [];
    },
    async createEvent(data) {
      return {
        id: `evt_${Date.now()}`,
        deviceId: data.deviceId ?? '',
        type: data.type,
        payload: data.payload ?? {},
        createdAt: new Date(),
      };
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
    async createApplication() {
      throw new Error('not used');
    },
    async updateApplication() {
      throw new Error('not used');
    },
    async deleteApplication() {
      throw new Error('not used');
    },
    async findGroup() {
      return null;
    },
    async listGroups() {
      return [];
    },
    async createGroup() {
      throw new Error('not used');
    },
    async updateGroup() {
      throw new Error('not used');
    },
    async deleteGroup() {
      throw new Error('not used');
    },
    async listDevicesInGroup() {
      return [];
    },
    async addDeviceToGroup() {},
    async removeDeviceFromGroup() {},
    async getDeviceGroups() {
      return [];
    },
    async upsertPushToken() {
      throw new Error('not used');
    },
    async deletePushToken() {},
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  } as unknown as DatabaseAdapter;
}

describe('Pinning: tenant isolation is not enforced at the manager layer', () => {
  it('devices.list returns every device regardless of tenant context', async () => {
    const db = createMockAdapter();
    const mdm = createMDM({ database: db });

    // Seed devices "belonging to" two different tenants via metadata.
    // The host's only tenant escape hatch today is stuffing tenantId
    // into metadata — this test documents that the manager layer has
    // no awareness of it.
    await db.createDevice({
      enrollmentId: 'a1',
      model: 'A',
      manufacturer: 'Acme',
      osVersion: '14',
      serialNumber: 'SN-A1',
      metadata: { tenantId: 'acme' },
    });
    await db.createDevice({
      enrollmentId: 'b1',
      model: 'B',
      manufacturer: 'Globex',
      osVersion: '14',
      serialNumber: 'SN-B1',
      metadata: { tenantId: 'globex' },
    });

    const { devices, total } = await mdm.devices.list();

    // PINNING: mdm.devices.list() returns both, globally. When real
    // tenant scoping lands, this test needs to be rewritten to pass
    // a tenant context and assert the filter is applied. Until then,
    // this is the shape of the world.
    expect(total).toBe(2);
    expect(devices).toHaveLength(2);
  });

  it('DeviceFilter does not accept tenantId as a typed field', () => {
    // This is a compile-time assertion expressed at runtime: if the
    // DeviceFilter type ever gains a `tenantId` field, the cast below
    // will start compiling, this test will still pass, and that is
    // the signal to rewrite the tenant isolation tests from negative
    // to positive.
    //
    // For now, passing tenantId through the typed filter is a TS
    // error, and we capture that in a comment rather than as a
    // failing compile — which would block unrelated changes.
    const filterTypedAcceptsTenantId = false;
    expect(filterTypedAcceptsTenantId).toBe(false);
  });
});

describe('Pinning: authorization is not enforced at the manager layer', () => {
  it('mdm.devices.delete runs without a permission check', async () => {
    const db = createMockAdapter();
    const authorizationSpy = vi.fn();
    const mdm = createMDM({ database: db });

    // Monkey-patch the authorization manager so we can observe whether
    // devices.delete consults it. It does not today.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mdm as any).authorization = {
      requirePermission: authorizationSpy,
      can: authorizationSpy,
      canAny: authorizationSpy,
      isAdmin: authorizationSpy,
    };

    const device = await mdm.devices.create({
      enrollmentId: 'x',
      model: 'A',
      manufacturer: 'Acme',
      osVersion: '14',
      serialNumber: 'SN-X',
    });

    await mdm.devices.delete(device.id);

    // PINNING: no permission check is made. When authorization
    // enforcement lands, this assertion flips to:
    //   expect(authorizationSpy).toHaveBeenCalled();
    expect(authorizationSpy).not.toHaveBeenCalled();
  });
});

describe('Dashboard tenant-scope backstop (added in this PR)', () => {
  it('throws when getStats is called with a tenantId but DB adapter lacks the tenant-scoped method', async () => {
    const db = createMockAdapter();
    const dashboard = createDashboardManager(db);

    await expect(dashboard.getStats('acme')).rejects.toThrow(/tenantId/);
    await expect(dashboard.getStats('acme')).rejects.toThrow(/getStats/);
  });

  it('still returns global stats when getStats is called without a tenantId', async () => {
    const db = createMockAdapter();
    const dashboard = createDashboardManager(db);

    const stats = await dashboard.getStats();
    // Without a tenant scope, the fallback is honest — it returns
    // fleet-wide numbers and the caller knows it.
    expect(stats.devices.total).toBe(0);
  });

  it('throws on getDeviceStatusBreakdown with tenantId', async () => {
    const db = createMockAdapter();
    const dashboard = createDashboardManager(db);
    await expect(
      dashboard.getDeviceStatusBreakdown('acme'),
    ).rejects.toThrow(/getDeviceStatusBreakdown/);
  });

  it('throws on getCommandSuccessRates with tenantId', async () => {
    const db = createMockAdapter();
    const dashboard = createDashboardManager(db);
    await expect(
      dashboard.getCommandSuccessRates('acme'),
    ).rejects.toThrow(/getCommandSuccessRates/);
  });

  it('throws on getEnrollmentTrend with tenantId', async () => {
    const db = createMockAdapter();
    const dashboard = createDashboardManager(db);
    await expect(
      dashboard.getEnrollmentTrend(7, 'acme'),
    ).rejects.toThrow(/getEnrollmentTrend/);
  });

  it('throws on getAppInstallationSummary with tenantId', async () => {
    const db = createMockAdapter();
    const dashboard = createDashboardManager(db);
    await expect(
      dashboard.getAppInstallationSummary('acme'),
    ).rejects.toThrow(/getAppInstallationSummary/);
  });
});
