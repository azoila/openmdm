/**
 * Tenant- and actor-scoped instances.
 *
 * The root `MDMInstance` is the *system* caller: it performs no tenant
 * isolation, no permission checks, and writes no audit trail. That is correct
 * for enrollment, background sweeps, and single-tenant embeds — there is no
 * user to authorize and no tenant to infer.
 *
 * It is emphatically NOT correct for anything driven by a user request. Before
 * this module existed, `TenantManager`, `AuthorizationManager`, and
 * `AuditManager` all shipped as opt-in side-cars that core never called, so the
 * default behaviour of every manager method was: return every tenant's data,
 * check nothing, record nothing. `mdm.withContext(...)` closes that by wrapping
 * the managers so the three concerns are enforced on every call instead of
 * relying on the host to remember.
 *
 * Three rules drive the implementation:
 *
 * 1. **A cross-tenant read must be indistinguishable from a miss.** Looking up
 *    another tenant's device id returns `null`, not a 403 — a 403 confirms the
 *    id exists, which is itself a leak.
 * 2. **Fail closed.** If the database adapter cannot scope by tenant, a scoped
 *    instance refuses to be created at all. Silently ignoring the filter and
 *    serving every tenant's rows is the one failure mode multi-tenancy cannot
 *    have.
 * 3. **Audit the attempt, not just the success.** A denied permission and a
 *    failed write are both recorded; an audit trail that only contains
 *    successes is not much of a trail.
 */

import type {
  Application,
  ApplicationManager,
  AuditManager,
  AuthorizationManager,
  Command,
  CommandFilter,
  CommandManager,
  CommandResult,
  CommandRetryResult,
  CreateApplicationInput,
  CreateDeviceInput,
  CreateGroupInput,
  CreatePolicyInput,
  DatabaseAdapter,
  DeployTarget,
  Device,
  DeviceFilter,
  DeviceListResult,
  DeviceManager,
  Group,
  GroupHierarchyStats,
  GroupManager,
  GroupTreeNode,
  Logger,
  MDMContext,
  PermissionAction,
  PermissionResource,
  Policy,
  PolicyManager,
  ScopedMDM,
  SendCommandInput,
  UpdateApplicationInput,
  UpdateDeviceInput,
  UpdateGroupInput,
  UpdatePolicyInput,
} from './types';
import {
  ApplicationNotFoundError,
  ConfigurationError,
  DeviceNotFoundError,
  GroupNotFoundError,
  PolicyNotFoundError,
} from './types';

export interface ScopedInstanceDeps {
  database: DatabaseAdapter;
  logger: Logger;
  managers: {
    devices: DeviceManager;
    policies: PolicyManager;
    apps: ApplicationManager;
    commands: CommandManager;
    groups: GroupManager;
  };
  /**
   * Resolved lazily (per call, not per instance) so a host that swaps the
   * authorization manager after construction — or a test that stubs it — is
   * honoured rather than silently ignored.
   */
  authorization?: () => AuthorizationManager | undefined;
  audit?: () => AuditManager | undefined;
  /** True when `config.authorization.enabled` is set. */
  authorizationEnabled: boolean;
  /** True when `config.audit.enabled` is set. */
  auditEnabled: boolean;
}

/** Anything that carries an owning tenant. */
interface TenantOwned {
  tenantId?: string | null;
}

export function createScopedInstance(context: MDMContext, deps: ScopedInstanceDeps): ScopedMDM {
  const { database, logger, managers, authorizationEnabled, auditEnabled } = deps;
  const authorization = () => deps.authorization?.();
  const audit = () => deps.audit?.();

  // Fail closed: a tenant-scoped instance against an adapter that ignores
  // tenant filters would serve every tenant's data while looking correct.
  if (context.tenantId && !database.supportsTenantScoping) {
    throw new ConfigurationError(
      'A tenant-scoped instance was requested, but the database adapter does not ' +
        'declare supportsTenantScoping. Serving this request would silently ignore ' +
        'the tenant filter and expose every tenant’s data. Upgrade to an adapter ' +
        'that supports tenant scoping (e.g. @openmdm/drizzle-adapter >= 0.6).',
    );
  }

  if (context.userId && !authorizationEnabled) {
    logger.warn(
      { userId: context.userId },
      'withContext was given a userId but authorization.enabled is false — ' +
        'no permission checks will run for this instance.',
    );
  }

  const scopeLog = logger.child({ component: 'scoped-mdm' });

  /** Does this row belong to the caller's tenant? Unscoped callers see everything. */
  const inScope = (row: TenantOwned | null | undefined): boolean => {
    if (!context.tenantId) return true;
    if (!row) return false;
    return row.tenantId === context.tenantId;
  };

  /** Narrow a filter to the caller's tenant. */
  const scopeFilter = <T extends { tenantId?: string }>(filter?: T): T =>
    ({ ...(filter ?? {}), ...(context.tenantId ? { tenantId: context.tenantId } : {}) }) as T;

  /** Stamp the owning tenant onto a create input. */
  const stampTenant = <T extends { tenantId?: string }>(input: T): T =>
    context.tenantId ? { ...input, tenantId: context.tenantId } : input;

  const writeAudit = async (
    action: 'create' | 'read' | 'update' | 'delete' | 'command',
    resource: string,
    resourceId: string | undefined,
    status: 'success' | 'failure',
    extra?: { error?: string; details?: Record<string, unknown> },
  ): Promise<void> => {
    const auditManager = audit();
    if (!auditEnabled || !auditManager) return;
    try {
      await auditManager.log({
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        resource,
        resourceId,
        status,
        error: extra?.error,
        details: extra?.details,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    } catch (error) {
      // An audit backend failure must not take down the operation it is
      // recording, but it must be loud — a silently missing trail is worse
      // than a noisy one.
      scopeLog.error(
        { err: error instanceof Error ? error.message : String(error), action, resource },
        'Failed to write audit log entry',
      );
    }
  };

  const checkPermission = async (
    action: PermissionAction,
    resource: PermissionResource,
    resourceId?: string,
  ): Promise<void> => {
    const authz = authorization();
    if (!authorizationEnabled || !authz || !context.userId) return;

    const allowed = await authz.can(context.userId, action, resource, resourceId);
    if (!allowed) {
      await writeAudit(auditActionFor(action), resource, resourceId, 'failure', {
        error: 'PERMISSION_DENIED',
      });
      // Delegate the throw so the error type stays consistent with the
      // authorization manager's own contract.
      await authz.requirePermission(context.userId, action, resource, resourceId);
    }
  };

  /**
   * Run an operation with the full guard chain: permission check → execute →
   * audit. Reads are not audited by default (a read-heavy fleet would drown
   * the audit table); pass `auditReads` for the ones that matter.
   */
  const guard = async <T>(
    op: {
      action: PermissionAction;
      resource: PermissionResource;
      resourceId?: string;
      auditAs?: 'create' | 'read' | 'update' | 'delete' | 'command';
      audited?: boolean;
      details?: Record<string, unknown>;
    },
    run: () => Promise<T>,
  ): Promise<T> => {
    await checkPermission(op.action, op.resource, op.resourceId);

    const auditAction = op.auditAs ?? auditActionFor(op.action);
    const audited = op.audited ?? op.action !== 'read';

    try {
      const result = await run();
      if (audited) {
        const resourceId = op.resourceId ?? idOf(result);
        await writeAudit(auditAction, op.resource, resourceId, 'success', {
          details: op.details,
        });
      }
      return result;
    } catch (error) {
      if (audited) {
        await writeAudit(auditAction, op.resource, op.resourceId, 'failure', {
          error: error instanceof Error ? error.message : String(error),
          details: op.details,
        });
      }
      throw error;
    }
  };

  /**
   * Load a resource and verify it belongs to the caller's tenant.
   *
   * Returns `null` for out-of-tenant rows rather than throwing: to the caller,
   * another tenant's device must look like a device that does not exist.
   */
  const loadInScope = async <T extends TenantOwned>(
    fetch: () => Promise<T | null>,
  ): Promise<T | null> => {
    const row = await fetch();
    if (!row || !inScope(row)) return null;
    return row;
  };

  // ============================================
  // Devices
  // ============================================

  const devices: DeviceManager = {
    ...managers.devices,

    async get(id: string): Promise<Device | null> {
      await checkPermission('read', 'devices', id);
      return loadInScope(() => managers.devices.get(id));
    },

    async getByEnrollmentId(enrollmentId: string): Promise<Device | null> {
      await checkPermission('read', 'devices');
      return loadInScope(() => managers.devices.getByEnrollmentId(enrollmentId));
    },

    async list(filter?: DeviceFilter): Promise<DeviceListResult> {
      await checkPermission('read', 'devices');
      return managers.devices.list(scopeFilter(filter));
    },

    async create(data: CreateDeviceInput): Promise<Device> {
      return guard({ action: 'create', resource: 'devices' }, () =>
        managers.devices.create(stampTenant(data)),
      );
    },

    async update(id: string, data: UpdateDeviceInput): Promise<Device> {
      return guard({ action: 'update', resource: 'devices', resourceId: id }, async () => {
        await assertDeviceInScope(id);
        return managers.devices.update(id, data);
      });
    },

    async delete(id: string): Promise<void> {
      return guard({ action: 'delete', resource: 'devices', resourceId: id }, async () => {
        await assertDeviceInScope(id);
        return managers.devices.delete(id);
      });
    },

    async assignPolicy(deviceId: string, policyId: string): Promise<Device> {
      return guard(
        {
          action: 'update',
          resource: 'devices',
          resourceId: deviceId,
          details: { policyId },
        },
        async () => {
          await assertDeviceInScope(deviceId);
          await assertPolicyInScope(policyId);
          return managers.devices.assignPolicy(deviceId, policyId);
        },
      );
    },

    async sendCommand(
      deviceId: string,
      input: Omit<SendCommandInput, 'deviceId'>,
    ): Promise<Command> {
      return guard(
        {
          action: 'create',
          resource: 'commands',
          auditAs: 'command',
          details: { deviceId, type: input.type },
        },
        async () => {
          await assertDeviceInScope(deviceId);
          return managers.devices.sendCommand(deviceId, stampTenant(input as SendCommandInput));
        },
      );
    },
  };

  // ============================================
  // Policies
  // ============================================

  const policies: PolicyManager = {
    ...managers.policies,

    async get(id: string): Promise<Policy | null> {
      await checkPermission('read', 'policies', id);
      return loadInScope(() => managers.policies.get(id));
    },

    async list(): Promise<Policy[]> {
      await checkPermission('read', 'policies');
      const all = await managers.policies.list();
      return all.filter(inScope);
    },

    async create(data: CreatePolicyInput): Promise<Policy> {
      return guard({ action: 'create', resource: 'policies' }, () =>
        managers.policies.create(stampTenant(data)),
      );
    },

    async update(id: string, data: UpdatePolicyInput): Promise<Policy> {
      return guard({ action: 'update', resource: 'policies', resourceId: id }, async () => {
        await assertPolicyInScope(id);
        return managers.policies.update(id, data);
      });
    },

    async delete(id: string): Promise<void> {
      return guard({ action: 'delete', resource: 'policies', resourceId: id }, async () => {
        await assertPolicyInScope(id);
        return managers.policies.delete(id);
      });
    },
  };

  // ============================================
  // Applications
  // ============================================

  const apps: ApplicationManager = {
    ...managers.apps,

    async get(id: string): Promise<Application | null> {
      await checkPermission('read', 'apps', id);
      return loadInScope(() => managers.apps.get(id));
    },

    async list(activeOnly?: boolean): Promise<Application[]> {
      await checkPermission('read', 'apps');
      const all = await managers.apps.list(activeOnly);
      return all.filter(inScope);
    },

    async getByPackage(packageName: string, version?: string): Promise<Application | null> {
      await checkPermission('read', 'apps');
      return loadInScope(() => managers.apps.getByPackage(packageName, version));
    },

    async register(data: CreateApplicationInput): Promise<Application> {
      return guard({ action: 'create', resource: 'apps' }, () =>
        managers.apps.register(stampTenant(data)),
      );
    },

    async update(id: string, data: UpdateApplicationInput): Promise<Application> {
      await assertAppInScope(id);
      return guard({ action: 'update', resource: 'apps', resourceId: id }, () =>
        managers.apps.update(id, data),
      );
    },

    async delete(id: string): Promise<void> {
      await assertAppInScope(id);
      return guard({ action: 'delete', resource: 'apps', resourceId: id }, () =>
        managers.apps.delete(id),
      );
    },

    async activate(id: string): Promise<Application> {
      await assertAppInScope(id);
      return guard({ action: 'update', resource: 'apps', resourceId: id }, () =>
        managers.apps.activate(id),
      );
    },

    async deactivate(id: string): Promise<Application> {
      await assertAppInScope(id);
      return guard({ action: 'update', resource: 'apps', resourceId: id }, () =>
        managers.apps.deactivate(id),
      );
    },

    async deploy(packageName: string, target: DeployTarget): Promise<void> {
      await assertAppPackageInScope(packageName);
      return guard(
        {
          action: 'create',
          resource: 'apps',
          auditAs: 'command',
          details: { packageName, target: target as unknown as Record<string, unknown> },
        },
        () => managers.apps.deploy(packageName, target),
      );
    },

    async installOnDevice(
      packageName: string,
      deviceId: string,
      version?: string,
    ): Promise<Command> {
      await assertAppPackageInScope(packageName);
      await assertDeviceInScope(deviceId);
      return guard(
        {
          action: 'create',
          resource: 'commands',
          auditAs: 'command',
          details: { packageName, deviceId, version },
        },
        () => managers.apps.installOnDevice(packageName, deviceId, version),
      );
    },

    async uninstallFromDevice(packageName: string, deviceId: string): Promise<Command> {
      await assertAppPackageInScope(packageName);
      await assertDeviceInScope(deviceId);
      return guard(
        {
          action: 'create',
          resource: 'commands',
          auditAs: 'command',
          details: { packageName, deviceId },
        },
        () => managers.apps.uninstallFromDevice(packageName, deviceId),
      );
    },
  };

  // ============================================
  // Commands
  // ============================================

  const commands: CommandManager = {
    ...managers.commands,

    async get(id: string): Promise<Command | null> {
      await checkPermission('read', 'commands', id);
      return loadInScope(() => managers.commands.get(id));
    },

    async list(filter?: CommandFilter): Promise<Command[]> {
      await checkPermission('read', 'commands');
      return managers.commands.list(scopeFilter(filter));
    },

    async send(input: SendCommandInput): Promise<Command> {
      await assertDeviceInScope(input.deviceId);
      return guard(
        {
          action: 'create',
          resource: 'commands',
          auditAs: 'command',
          details: { deviceId: input.deviceId, type: input.type },
        },
        () => managers.commands.send(stampTenant(input)),
      );
    },

    async cancel(id: string): Promise<Command> {
      return guard({ action: 'update', resource: 'commands', resourceId: id }, async () => {
        await assertCommandInScope(id);
        return managers.commands.cancel(id);
      });
    },

    async acknowledge(id: string): Promise<Command> {
      await assertCommandInScope(id);
      return managers.commands.acknowledge(id);
    },

    async complete(id: string, result: CommandResult): Promise<Command> {
      await assertCommandInScope(id);
      return managers.commands.complete(id, result);
    },

    async fail(id: string, error: string): Promise<Command> {
      await assertCommandInScope(id);
      return managers.commands.fail(id, error);
    },

    async getPending(deviceId: string): Promise<Command[]> {
      await assertDeviceInScope(deviceId);
      return managers.commands.getPending(deviceId);
    },

    async retryPending(options?: { limit?: number }): Promise<CommandRetryResult> {
      // Delivery sweeps are infrastructure, not a user action: they are not
      // tenant-scoped and are expected to be driven by the root instance.
      // Reaching them through a scoped instance still requires the permission.
      await checkPermission('manage', 'commands');
      return managers.commands.retryPending(options);
    },

    async expireStale(): Promise<number> {
      await checkPermission('manage', 'commands');
      return managers.commands.expireStale();
    },
  };

  // ============================================
  // Groups
  // ============================================

  const groups: GroupManager = {
    ...managers.groups,

    async get(id: string): Promise<Group | null> {
      await checkPermission('read', 'groups', id);
      return loadInScope(() => managers.groups.get(id));
    },

    async list(): Promise<Group[]> {
      await checkPermission('read', 'groups');
      const all = await managers.groups.list();
      return all.filter(inScope);
    },

    async create(data: CreateGroupInput): Promise<Group> {
      return guard({ action: 'create', resource: 'groups' }, () =>
        managers.groups.create(stampTenant(data)),
      );
    },

    async update(id: string, data: UpdateGroupInput): Promise<Group> {
      await assertGroupInScope(id);
      return guard({ action: 'update', resource: 'groups', resourceId: id }, () =>
        managers.groups.update(id, data),
      );
    },

    async delete(id: string): Promise<void> {
      await assertGroupInScope(id);
      return guard({ action: 'delete', resource: 'groups', resourceId: id }, () =>
        managers.groups.delete(id),
      );
    },

    async getDevices(groupId: string): Promise<Device[]> {
      await assertGroupInScope(groupId);
      const members = await managers.groups.getDevices(groupId);
      return members.filter(inScope);
    },

    async addDevice(groupId: string, deviceId: string): Promise<void> {
      await assertGroupInScope(groupId);
      await assertDeviceInScope(deviceId);
      return guard(
        { action: 'update', resource: 'groups', resourceId: groupId, details: { deviceId } },
        () => managers.groups.addDevice(groupId, deviceId),
      );
    },

    async removeDevice(groupId: string, deviceId: string): Promise<void> {
      await assertGroupInScope(groupId);
      await assertDeviceInScope(deviceId);
      return guard(
        { action: 'update', resource: 'groups', resourceId: groupId, details: { deviceId } },
        () => managers.groups.removeDevice(groupId, deviceId),
      );
    },

    async getTree(rootId?: string): Promise<GroupTreeNode[]> {
      await checkPermission('read', 'groups');
      const tree = await managers.groups.getTree(rootId);
      // GroupTreeNode extends Group, so the roots carry tenantId directly.
      // Filtering the roots is sufficient: a child group of an in-scope root
      // belongs to the same tenant by construction.
      return tree.filter(inScope);
    },

    async getHierarchyStats(): Promise<GroupHierarchyStats> {
      await checkPermission('read', 'groups');
      return managers.groups.getHierarchyStats();
    },
  };

  // ============================================
  // Scope assertions
  // ============================================
  //
  // Mutating a resource outside the caller's tenant raises NotFound, not a
  // permission error — same reasoning as reads: a distinct error would confirm
  // the id exists in another tenant.

  async function assertDeviceInScope(id: string): Promise<void> {
    if (!context.tenantId) return;
    const device = await managers.devices.get(id);
    if (!device || !inScope(device)) {
      throw new DeviceNotFoundError(id);
    }
  }

  async function assertPolicyInScope(id: string): Promise<void> {
    if (!context.tenantId) return;
    const policy = await managers.policies.get(id);
    if (!policy || !inScope(policy)) {
      throw new PolicyNotFoundError(id);
    }
  }

  async function assertAppInScope(id: string): Promise<void> {
    if (!context.tenantId) return;
    const app = await managers.apps.get(id);
    if (!app || !inScope(app)) {
      throw new ApplicationNotFoundError(id);
    }
  }

  /** Several app operations address the app by package name rather than id. */
  async function assertAppPackageInScope(packageName: string): Promise<void> {
    if (!context.tenantId) return;
    const app = await managers.apps.getByPackage(packageName);
    if (!app || !inScope(app)) {
      throw new ApplicationNotFoundError(packageName);
    }
  }

  async function assertGroupInScope(id: string): Promise<void> {
    if (!context.tenantId) return;
    const group = await managers.groups.get(id);
    if (!group || !inScope(group)) {
      throw new GroupNotFoundError(id);
    }
  }

  async function assertCommandInScope(id: string): Promise<void> {
    if (!context.tenantId) return;
    const command = await managers.commands.get(id);
    if (!command) {
      throw new DeviceNotFoundError(id);
    }
    // A command may predate tenant stamping; fall back to its device's tenant.
    if (command.tenantId) {
      if (command.tenantId !== context.tenantId) {
        throw new DeviceNotFoundError(id);
      }
      return;
    }
    await assertDeviceInScope(command.deviceId);
  }

  return {
    context,
    devices,
    policies,
    apps,
    commands,
    groups,
  };
}

/** Map a permission action onto the audit vocabulary. */
function auditActionFor(
  action: PermissionAction,
): 'create' | 'read' | 'update' | 'delete' | 'command' {
  switch (action) {
    case 'create':
      return 'create';
    case 'update':
      return 'update';
    case 'delete':
      return 'delete';
    case 'read':
      return 'read';
    default:
      // 'manage' and '*' are administrative umbrellas; record them as updates.
      return 'update';
  }
}

/** Best-effort resource id from an operation's return value, for audit rows. */
function idOf(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}
