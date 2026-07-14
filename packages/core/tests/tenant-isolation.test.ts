/**
 * Tenant isolation, RBAC enforcement, and automatic audit logging.
 *
 * This file replaces `tenant-isolation.pinning.test.ts`, which locked in the
 * old (broken) behaviour: tenancy, authorization, and audit all shipped as
 * opt-in side-cars that core never called, so every manager method returned
 * every tenant's data, checked nothing, and recorded nothing. Those tests said
 * of themselves: "When the architectural fix lands, these tests will fail —
 * that is the point. The test authors will then rewrite them to assert the new,
 * correct behavior." This is that rewrite.
 *
 * The model: the **root instance is the system caller** — unscoped by design,
 * because enrollment, background sweeps, and single-tenant embeds have no user
 * to authorize and no tenant to infer. Anything driven by a user request goes
 * through `mdm.withContext({ tenantId, userId })`, which enforces all three.
 * The tests below pin both halves of that contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboardManager, createMDM } from '../src/index';
import type { AuditLog, DatabaseAdapter, MDMInstance } from '../src/types';

const ACME = 'acme';
const GLOBEX = 'globex';

function createMockAdapter(options: { supportsTenantScoping?: boolean } = {}) {
  const devices = new Map<string, any>();
  const policies = new Map<string, any>();
  const commands = new Map<string, any>();
  const auditLogs: AuditLog[] = [];
  let counter = 0;

  const adapter: any = {
    supportsTenantScoping: options.supportsTenantScoping ?? true,
    _devices: devices,
    _auditLogs: auditLogs,

    async findDevice(id: string) {
      return devices.get(id) ?? null;
    },
    async findDeviceByEnrollmentId(enrollmentId: string) {
      return Array.from(devices.values()).find((d) => d.enrollmentId === enrollmentId) ?? null;
    },
    async listDevices(filter?: any) {
      // A real adapter filters in SQL. The important thing this fake models is
      // that it *honours* the tenantId filter — that is what
      // supportsTenantScoping promises.
      let list = Array.from(devices.values());
      if (filter?.tenantId) {
        list = list.filter((d) => d.tenantId === filter.tenantId);
      }
      return { devices: list, total: list.length, limit: 100, offset: 0 };
    },
    async createDevice(data: any) {
      const device = {
        id: `dev_${++counter}`,
        status: 'enrolled',
        ...data,
        tenantId: data.tenantId ?? null,
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
      return null;
    },
    async listPolicies() {
      return Array.from(policies.values());
    },
    async createPolicy(data: any) {
      const policy = {
        id: `pol_${++counter}`,
        ...data,
        tenantId: data.tenantId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      policies.set(policy.id, policy);
      return policy;
    },
    async updatePolicy(id: string, data: any) {
      const updated = { ...policies.get(id), ...data };
      policies.set(id, updated);
      return updated;
    },
    async deletePolicy(id: string) {
      policies.delete(id);
    },

    async findCommand(id: string) {
      return commands.get(id) ?? null;
    },
    async listCommands(filter?: any) {
      let list = Array.from(commands.values());
      if (filter?.tenantId) {
        list = list.filter((c) => c.tenantId === filter.tenantId);
      }
      return list;
    },
    async createCommand(data: any) {
      const command = {
        id: `cmd_${++counter}`,
        status: 'pending',
        attemptCount: 0,
        maxAttempts: 5,
        ...data,
        tenantId: data.tenantId ?? null,
        createdAt: new Date(),
      };
      commands.set(command.id, command);
      return command;
    },
    async updateCommand(id: string, data: any) {
      const updated = { ...commands.get(id), ...data };
      commands.set(id, updated);
      return updated;
    },
    async getPendingCommands() {
      return [];
    },

    // Audit storage
    async createAuditLog(entry: any) {
      const log = { id: `audit_${++counter}`, ...entry, createdAt: new Date() };
      auditLogs.push(log);
      return log;
    },
    async listAuditLogs() {
      return { logs: auditLogs, total: auditLogs.length, limit: 100, offset: 0 };
    },

    async createEvent(data: any) {
      return { id: `evt_${++counter}`, ...data, createdAt: new Date() };
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
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };

  return adapter as DatabaseAdapter & {
    _devices: Map<string, any>;
    _auditLogs: AuditLog[];
  };
}

async function seedTwoTenants(mdm: MDMInstance) {
  const acme = await mdm.withContext({ tenantId: ACME }).devices.create({
    enrollmentId: 'a1',
    model: 'A',
  } as any);
  const globex = await mdm.withContext({ tenantId: GLOBEX }).devices.create({
    enrollmentId: 'b1',
    model: 'B',
  } as any);
  return { acme, globex };
}

// ============================================
// Tenant isolation
// ============================================

describe('tenant isolation is enforced on scoped instances', () => {
  let db: ReturnType<typeof createMockAdapter>;
  let mdm: MDMInstance;

  beforeEach(() => {
    db = createMockAdapter();
    mdm = createMDM({ database: db, logger: { ...console, child: () => console } as any });
  });

  it('stamps the owning tenant on create', async () => {
    const device = await mdm
      .withContext({ tenantId: ACME })
      .devices.create({ enrollmentId: 'a1' } as any);

    expect(device.tenantId).toBe(ACME);
  });

  it('list returns only the caller’s tenant', async () => {
    await seedTwoTenants(mdm);

    const { devices, total } = await mdm.withContext({ tenantId: ACME }).devices.list();

    expect(total).toBe(1);
    expect(devices).toHaveLength(1);
    expect(devices[0]!.tenantId).toBe(ACME);
  });

  it('get on another tenant’s device returns null, not a 403', async () => {
    const { globex } = await seedTwoTenants(mdm);

    const found = await mdm.withContext({ tenantId: ACME }).devices.get(globex.id);

    // Returning null rather than throwing is deliberate: a distinct error would
    // confirm the id exists in another tenant, which is itself a leak.
    expect(found).toBeNull();
  });

  it('refuses to update another tenant’s device', async () => {
    const { globex } = await seedTwoTenants(mdm);

    await expect(
      mdm.withContext({ tenantId: ACME }).devices.update(globex.id, { model: 'pwned' }),
    ).rejects.toThrow();

    expect(db._devices.get(globex.id).model).toBe('B');
  });

  it('refuses to delete another tenant’s device', async () => {
    const { globex } = await seedTwoTenants(mdm);

    await expect(mdm.withContext({ tenantId: ACME }).devices.delete(globex.id)).rejects.toThrow();

    expect(db._devices.has(globex.id)).toBe(true);
  });

  it('refuses to send a command to another tenant’s device', async () => {
    const { globex } = await seedTwoTenants(mdm);

    await expect(
      mdm.withContext({ tenantId: ACME }).devices.sendCommand(globex.id, { type: 'wipe' }),
    ).rejects.toThrow();
  });

  it('scopes commands to the tenant', async () => {
    const { acme } = await seedTwoTenants(mdm);
    const scoped = mdm.withContext({ tenantId: ACME });

    await scoped.devices.sendCommand(acme.id, { type: 'sync' });

    const acmeCommands = await scoped.commands.list();
    const globexCommands = await mdm.withContext({ tenantId: GLOBEX }).commands.list();

    expect(acmeCommands).toHaveLength(1);
    expect(globexCommands).toHaveLength(0);
  });

  it('the root instance stays unscoped — it is the system caller', async () => {
    await seedTwoTenants(mdm);

    // Intentional: enrollment and background sweeps run here, with no tenant to
    // infer. This is the one place cross-tenant visibility is correct, and it
    // is why user-facing code must go through withContext().
    const { total } = await mdm.devices.list();
    expect(total).toBe(2);
  });
});

describe('tenant scoping fails closed', () => {
  it('refuses to build a scoped instance on an adapter that cannot scope', () => {
    const db = createMockAdapter({ supportsTenantScoping: false });
    const mdm = createMDM({ database: db, logger: { ...console, child: () => console } as any });

    // Serving this request would silently ignore the tenant filter and return
    // every tenant's data while looking perfectly healthy. Refuse instead.
    expect(() => mdm.withContext({ tenantId: ACME })).toThrow(/supportsTenantScoping/);
  });

  it('still allows an unscoped context on such an adapter', () => {
    const db = createMockAdapter({ supportsTenantScoping: false });
    const mdm = createMDM({ database: db, logger: { ...console, child: () => console } as any });

    expect(() => mdm.withContext({ userId: 'u1' })).not.toThrow();
  });
});

// ============================================
// RBAC enforcement
// ============================================

describe('authorization is enforced on scoped instances', () => {
  function buildWithAuth(allowed: boolean) {
    const db = createMockAdapter();
    const mdm = createMDM({
      database: db,
      authorization: { enabled: true },
      logger: { ...console, child: () => console } as any,
    });

    const can = vi.fn(async () => allowed);
    const requirePermission = vi.fn(async () => {
      throw new Error('PERMISSION_DENIED');
    });
    (mdm as any).authorization = { can, requirePermission, isAdmin: vi.fn() };

    return { db, mdm, can, requirePermission };
  }

  it('checks the permission before deleting a device', async () => {
    const { mdm, can } = buildWithAuth(true);
    const device = await mdm.devices.create({ enrollmentId: 'x' } as any);

    // No tenantId in this context — the device is reachable, and what we are
    // asserting is that the permission check happens at all.
    await mdm.withContext({ userId: 'user-1' }).devices.delete(device.id);

    // The pinning test asserted `expect(authorizationSpy).not.toHaveBeenCalled()`.
    // That is exactly what flips here.
    expect(can).toHaveBeenCalledWith('user-1', 'delete', 'devices', device.id);
  });

  it('blocks the operation when the permission is denied', async () => {
    const { db, mdm } = buildWithAuth(false);
    const device = await mdm.devices.create({ enrollmentId: 'x' } as any);

    await expect(mdm.withContext({ userId: 'user-1' }).devices.delete(device.id)).rejects.toThrow(
      /PERMISSION_DENIED/,
    );

    expect(db._devices.has(device.id)).toBe(true);
  });

  it('checks read permission on list', async () => {
    const { mdm, can } = buildWithAuth(true);

    await mdm.withContext({ userId: 'user-1' }).devices.list();

    expect(can).toHaveBeenCalledWith('user-1', 'read', 'devices', undefined);
  });

  it('does not check permissions without a userId', async () => {
    const { mdm, can } = buildWithAuth(true);
    const device = await mdm.devices.create({ enrollmentId: 'x' } as any);

    await mdm.withContext({ tenantId: ACME }).devices.get(device.id);

    expect(can).not.toHaveBeenCalled();
  });
});

// ============================================
// Automatic audit logging
// ============================================

describe('audit logging is automatic on scoped instances', () => {
  function buildWithAudit() {
    const db = createMockAdapter();
    const mdm = createMDM({
      database: db,
      audit: { enabled: true },
      logger: { ...console, child: () => console } as any,
    });
    return { db, mdm };
  }

  it('records a device deletion without the host wiring anything', async () => {
    const { db, mdm } = buildWithAudit();
    const scoped = mdm.withContext({ tenantId: ACME, userId: 'user-1', ipAddress: '10.0.0.1' });
    const device = await scoped.devices.create({ enrollmentId: 'x' } as any);

    await scoped.devices.delete(device.id);

    const entry = db._auditLogs.find((l) => l.action === 'delete');
    expect(entry).toMatchObject({
      tenantId: ACME,
      userId: 'user-1',
      action: 'delete',
      resource: 'devices',
      resourceId: device.id,
      status: 'success',
      ipAddress: '10.0.0.1',
    });
  });

  it('records commands as a distinct action', async () => {
    const { db, mdm } = buildWithAudit();
    const scoped = mdm.withContext({ tenantId: ACME, userId: 'user-1' });
    const device = await scoped.devices.create({ enrollmentId: 'x' } as any);

    await scoped.devices.sendCommand(device.id, { type: 'wipe' });

    const entry = db._auditLogs.find((l) => l.action === 'command');
    expect(entry?.details).toMatchObject({ deviceId: device.id, type: 'wipe' });
  });

  it('records a cross-tenant attempt as a failure', async () => {
    const { db, mdm } = buildWithAudit();

    // Globex owns this device.
    const victim = await mdm
      .withContext({ tenantId: GLOBEX })
      .devices.create({ enrollmentId: 'v' } as any);

    // Acme reaches for it.
    await expect(
      mdm.withContext({ tenantId: ACME, userId: 'mallory' }).devices.delete(victim.id),
    ).rejects.toThrow();

    // An audit trail that only records successes is not much of a trail — a
    // cross-tenant attempt is precisely the event worth keeping.
    const failure = db._auditLogs.find((l) => l.status === 'failure');
    expect(failure).toMatchObject({
      tenantId: ACME,
      userId: 'mallory',
      action: 'delete',
      resource: 'devices',
      resourceId: victim.id,
      status: 'failure',
    });
  });

  it('does not audit reads (they would drown the table)', async () => {
    const { db, mdm } = buildWithAudit();
    await mdm.withContext({ tenantId: ACME, userId: 'user-1' }).devices.list();

    expect(db._auditLogs.filter((l) => l.action === 'read')).toHaveLength(0);
  });

  it('writes nothing when audit is disabled', async () => {
    const db = createMockAdapter();
    const mdm = createMDM({ database: db, logger: { ...console, child: () => console } as any });
    const scoped = mdm.withContext({ tenantId: ACME, userId: 'u' });
    const device = await scoped.devices.create({ enrollmentId: 'x' } as any);

    await scoped.devices.delete(device.id);

    expect(db._auditLogs).toHaveLength(0);
  });
});

// ============================================
// Dashboard backstop (retained from the pinning suite)
// ============================================

describe('dashboard tenant-scope backstop', () => {
  it('throws when a tenant scope is requested but the adapter cannot honour it', async () => {
    const db = createMockAdapter();
    const dashboard = createDashboardManager(db);

    await expect(dashboard.getStats('acme')).rejects.toThrow(/tenantId/);
  });

  it('returns global stats when no tenant scope is requested', async () => {
    const db = createMockAdapter();
    const dashboard = createDashboardManager(db);

    const stats = await dashboard.getStats();
    expect(stats.devices.total).toBe(0);
  });
});
