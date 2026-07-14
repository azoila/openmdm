/**
 * OpenMDM Drizzle Adapter
 *
 * Database adapter for Drizzle ORM, supporting PostgreSQL, MySQL, and SQLite.
 *
 * @example
 * ```typescript
 * import { drizzle } from 'drizzle-orm/node-postgres';
 * import { drizzleAdapter } from '@openmdm/drizzle-adapter';
 * import { mdmSchema } from '@openmdm/drizzle-adapter/postgres';
 * import { createMDM } from '@openmdm/core';
 *
 * const pool = new Pool({ connectionString: DATABASE_URL });
 * const db = drizzle(pool, { schema: mdmSchema });
 *
 * const mdm = createMDM({
 *   database: drizzleAdapter(db),
 *   // ...
 * });
 * ```
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  Application,
  AppRollback,
  AppVersion,
  Command,
  CommandFilter,
  CreateApplicationInput,
  CreateAppRollbackInput,
  CreateDeviceInput,
  CreateGroupInput,
  CreatePolicyInput,
  DatabaseAdapter,
  Device,
  DeviceApp,
  DeviceFilter,
  DeviceListResult,
  DeviceLocation,
  EnrollmentChallenge,
  EventFilter,
  Group,
  InstalledApp,
  MDMEvent,
  Policy,
  PolicySettings,
  PolicyVersion,
  PushToken,
  RegisterPushTokenInput,
  SendCommandInput,
  UpdateApplicationInput,
  UpdateDeviceInput,
  UpdateGroupInput,
  UpdatePolicyInput,
} from '@openmdm/core';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { nanoid } from 'nanoid';

// Import postgres schema types
import type {
  mdmApplications,
  mdmAppVersions,
  mdmCommands,
  mdmDeviceApps,
  mdmDeviceGroups,
  mdmDevices,
  mdmEnrollmentChallenges,
  mdmEvents,
  mdmGroups,
  mdmPluginStorage,
  mdmPolicies,
  mdmPolicyVersions,
  mdmPushTokens,
  mdmRollbacks,
} from './postgres';

/**
 * Holds the active transaction handle for the current async context. See
 * `conn()` in `drizzleAdapter` for why this is per-context rather than a
 * shared variable.
 */
const txStorage = new AsyncLocalStorage<unknown>();

// Type for Drizzle database instance
type DrizzleDB = {
  select: (columns?: unknown) => unknown;
  insert: (table: unknown) => unknown;
  update: (table: unknown) => unknown;
  delete: (table: unknown) => unknown;
  query: Record<string, unknown>;
  transaction: <T>(fn: (tx: DrizzleDB) => Promise<T>) => Promise<T>;
};

export interface DrizzleAdapterOptions {
  /**
   * Table references - pass your imported Drizzle tables
   */
  tables: {
    devices: typeof mdmDevices;
    policies: typeof mdmPolicies;
    applications: typeof mdmApplications;
    commands: typeof mdmCommands;
    events: typeof mdmEvents;
    groups: typeof mdmGroups;
    deviceGroups: typeof mdmDeviceGroups;
    pushTokens: typeof mdmPushTokens;
    appVersions?: typeof mdmAppVersions;
    rollbacks?: typeof mdmRollbacks;
    pluginStorage?: typeof mdmPluginStorage;
    /**
     * Policy history table. Required for `policies.history()` and
     * `policies.rollback()`. Omit and versioning/drift still work — only
     * history and rollback are unavailable.
     */
    policyVersions?: typeof mdmPolicyVersions;
    /**
     * Canonical app inventory. Required for app update enforcement
     * (mdm.updates) and for querying devices by installed app version.
     */
    deviceApps?: typeof mdmDeviceApps;
    /**
     * Phase 2b enrollment challenges table. Required for
     * device-pinned-key enrollment. Omit to run enrollment in
     * legacy HMAC-only mode.
     */
    enrollmentChallenges?: typeof mdmEnrollmentChallenges;
  };
}

/**
 * Create a Drizzle database adapter for OpenMDM
 */
export function drizzleAdapter(db: DrizzleDB, options: DrizzleAdapterOptions): DatabaseAdapter {
  const { tables } = options;

  /**
   * The connection every query runs on.
   *
   * Inside `transaction(fn)` this resolves to the transaction handle, so
   * adapter methods called from `fn` participate in that transaction. Outside
   * one it is the pool. The handle is carried in AsyncLocalStorage rather than
   * a module-level variable because a shared mutable "current tx" would leak
   * across concurrent requests — request A's transaction would silently
   * capture request B's queries.
   */
  const conn = (): any => txStorage.getStore() ?? (db as any);
  const {
    devices,
    policies,
    applications,
    commands,
    events,
    groups,
    deviceGroups,
    pushTokens,
    appVersions,
    rollbacks,
    pluginStorage,
    enrollmentChallenges,
    policyVersions,
    deviceApps,
  } = tables;

  // Helper to generate IDs
  const generateId = () => nanoid(21);

  // Helper to transform DB row to Device
  const toDevice = (row: Record<string, unknown>): Device => ({
    id: row.id as string,
    tenantId: (row.tenantId as string | null) ?? null,
    externalId: row.externalId as string | null,
    enrollmentId: row.enrollmentId as string,
    status: row.status as Device['status'],
    model: row.model as string | null,
    manufacturer: row.manufacturer as string | null,
    osVersion: row.osVersion as string | null,
    serialNumber: row.serialNumber as string | null,
    imei: row.imei as string | null,
    macAddress: row.macAddress as string | null,
    androidId: row.androidId as string | null,
    policyId: row.policyId as string | null,
    appliedPolicyVersion: (row.appliedPolicyVersion as number | null) ?? null,
    policyAppliedAt: (row.policyAppliedAt as Date | null) ?? null,
    desiredState: (row.desiredState as Record<string, unknown> | null) ?? null,
    desiredStateVersion: (row.desiredStateVersion as number | null) ?? 0,
    reportedStateVersion: (row.reportedStateVersion as number | null) ?? null,
    stateReportedAt: (row.stateReportedAt as Date | null) ?? null,
    deletedAt: (row.deletedAt as Date | null) ?? null,
    agentVersion: row.agentVersion as string | null,
    lastHeartbeat: row.lastHeartbeat as Date | null,
    lastSync: row.lastSync as Date | null,
    publicKey: (row.publicKey as string | null) ?? null,
    enrollmentMethod: (row.enrollmentMethod as Device['enrollmentMethod']) ?? null,
    batteryLevel: row.batteryLevel as number | null,
    storageUsed: row.storageUsed as number | null,
    storageTotal: row.storageTotal as number | null,
    location:
      row.latitude && row.longitude
        ? {
            latitude: parseFloat(row.latitude as string),
            longitude: parseFloat(row.longitude as string),
            timestamp: row.locationTimestamp as Date,
          }
        : null,
    installedApps: row.installedApps as InstalledApp[] | null,
    tags: row.tags as Record<string, string> | null,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  });

  // Helper to transform DB row to Policy
  const toPolicy = (row: Record<string, unknown>): Policy => ({
    id: row.id as string,
    tenantId: (row.tenantId as string | null) ?? null,
    name: row.name as string,
    description: row.description as string | null,
    isDefault: row.isDefault as boolean,
    settings: row.settings as PolicySettings,
    version: (row.version as number | null) ?? 1,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  });

  // Helper to transform DB row to Application
  const toApplication = (row: Record<string, unknown>): Application => ({
    id: row.id as string,
    tenantId: (row.tenantId as string | null) ?? null,
    name: row.name as string,
    packageName: row.packageName as string,
    version: row.version as string,
    versionCode: row.versionCode as number,
    url: row.url as string,
    hash: row.hash as string | null,
    size: row.size as number | null,
    minSdkVersion: row.minSdkVersion as number | null,
    showIcon: row.showIcon as boolean,
    runAfterInstall: row.runAfterInstall as boolean,
    runAtBoot: row.runAtBoot as boolean,
    isSystem: row.isSystem as boolean,
    isActive: row.isActive as boolean,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  });

  // Helper to transform DB row to Command
  const toCommand = (row: Record<string, unknown>): Command => ({
    id: row.id as string,
    tenantId: (row.tenantId as string | null) ?? null,
    deviceId: row.deviceId as string,
    type: row.type as Command['type'],
    payload: row.payload as Record<string, unknown> | null,
    status: row.status as Command['status'],
    result: row.result as Command['result'],
    error: row.error as string | null,
    createdAt: row.createdAt as Date,
    sentAt: row.sentAt as Date | null,
    acknowledgedAt: row.acknowledgedAt as Date | null,
    completedAt: row.completedAt as Date | null,
    idempotencyKey: (row.idempotencyKey as string | null) ?? null,
    expiresAt: (row.expiresAt as Date | null) ?? null,
    attemptCount: (row.attemptCount as number | null) ?? 0,
    maxAttempts: (row.maxAttempts as number | null) ?? 5,
  });

  // Helper to transform DB row to DeviceApp
  const toDeviceApp = (row: Record<string, unknown>): DeviceApp => ({
    deviceId: row.deviceId as string,
    packageName: row.packageName as string,
    observedVersion: (row.observedVersion as string | null) ?? null,
    observedVersionCode: (row.observedVersionCode as number | null) ?? null,
    observedAt: (row.observedAt as Date | null) ?? null,
    desiredVersion: (row.desiredVersion as string | null) ?? null,
    desiredVersionCode: (row.desiredVersionCode as number | null) ?? null,
    updateAttempts: (row.updateAttempts as number | null) ?? 0,
    lastAttemptAt: (row.lastAttemptAt as Date | null) ?? null,
    escalatedAt: (row.escalatedAt as Date | null) ?? null,
  });

  // Helper to transform DB row to PolicyVersion
  const toPolicyVersion = (row: Record<string, unknown>): PolicyVersion => ({
    id: row.id as string,
    policyId: row.policyId as string,
    version: row.version as number,
    settings: row.settings as PolicySettings,
    createdBy: (row.createdBy as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdAt: row.createdAt as Date,
  });

  // Helper to transform DB row to Event
  const toEvent = (row: Record<string, unknown>): MDMEvent => ({
    id: row.id as string,
    deviceId: row.deviceId as string,
    type: row.type as MDMEvent['type'],
    payload: row.payload as Record<string, unknown>,
    createdAt: row.createdAt as Date,
  });

  // Helper to transform DB row to Group
  const toGroup = (row: Record<string, unknown>): Group => ({
    id: row.id as string,
    tenantId: (row.tenantId as string | null) ?? null,
    name: row.name as string,
    description: row.description as string | null,
    policyId: row.policyId as string | null,
    parentId: row.parentId as string | null,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  });

  // Helper to transform DB row to PushToken
  const toPushToken = (row: Record<string, unknown>): PushToken => ({
    id: row.id as string,
    deviceId: row.deviceId as string,
    provider: row.provider as PushToken['provider'],
    token: row.token as string,
    isActive: row.isActive as boolean,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  });

  // Helper to transform DB row to AppVersion
  const toAppVersion = (row: Record<string, unknown>): AppVersion => ({
    id: row.id as string,
    applicationId: row.applicationId as string,
    packageName: row.packageName as string,
    version: row.version as string,
    versionCode: row.versionCode as number,
    url: row.url as string,
    hash: row.hash as string | null,
    size: row.size as number | null,
    releaseNotes: row.releaseNotes as string | null,
    isMinimumVersion: row.isMinimumVersion as boolean,
    createdAt: row.createdAt as Date,
  });

  // Helper to transform DB row to AppRollback
  const toAppRollback = (row: Record<string, unknown>): AppRollback => ({
    id: row.id as string,
    deviceId: row.deviceId as string,
    packageName: row.packageName as string,
    fromVersion: row.fromVersion as string,
    fromVersionCode: row.fromVersionCode as number,
    toVersion: row.toVersion as string,
    toVersionCode: row.toVersionCode as number,
    reason: row.reason as string | null,
    status: row.status as AppRollback['status'],
    error: row.error as string | null,
    initiatedBy: row.initiatedBy as string | null,
    createdAt: row.createdAt as Date,
    completedAt: row.completedAt as Date | null,
  });

  return {
    // This adapter persists tenant_id on create and honours tenantId on
    // filters, so core will serve tenant-scoped instances against it.
    supportsTenantScoping: true,

    // ============================================
    // Device Methods
    // ============================================

    async findDevice(id: string): Promise<Device | null> {
      const result = await conn().select().from(devices).where(eq(devices.id, id)).limit(1);
      return result[0] ? toDevice(result[0]) : null;
    },

    async findDeviceByEnrollmentId(enrollmentId: string): Promise<Device | null> {
      const result = await conn()
        .select()
        .from(devices)
        .where(eq(devices.enrollmentId, enrollmentId))
        .limit(1);
      return result[0] ? toDevice(result[0]) : null;
    },

    async listDevices(filter?: DeviceFilter): Promise<DeviceListResult> {
      const limit = filter?.limit ?? 100;
      const offset = filter?.offset ?? 0;

      let query = conn().select().from(devices);

      // Build WHERE conditions
      const conditions: (SQL | undefined)[] = [];

      if (filter?.tenantId) {
        conditions.push(eq(devices.tenantId, filter.tenantId));
      }

      // A retired device keeps its row for audit, but it must not show up in a
      // device list just because the row still exists.
      if (!filter?.includeDeleted) {
        conditions.push(isNull(devices.deletedAt));
      }

      if (filter?.status) {
        if (Array.isArray(filter.status)) {
          conditions.push(inArray(devices.status, filter.status));
        } else {
          conditions.push(eq(devices.status, filter.status));
        }
      }

      if (filter?.policyId) {
        conditions.push(eq(devices.policyId, filter.policyId));
      }

      if (filter?.search) {
        const searchPattern = `%${filter.search}%`;
        conditions.push(
          or(
            like(devices.model, searchPattern),
            like(devices.manufacturer, searchPattern),
            like(devices.enrollmentId, searchPattern),
            like(devices.serialNumber, searchPattern),
          ),
        );
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      // Get total count
      const countResult = await conn()
        .select({ count: sql<number>`count(*)` })
        .from(devices)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      const total = Number(countResult[0]?.count ?? 0);

      // Get paginated results
      const result = await query.orderBy(desc(devices.createdAt)).limit(limit).offset(offset);

      return {
        devices: result.map(toDevice),
        total,
        limit,
        offset,
      };
    },

    async createDevice(data: CreateDeviceInput): Promise<Device> {
      const id = generateId();
      const now = new Date();

      const deviceData = {
        id,
        tenantId: data.tenantId ?? null,
        enrollmentId: data.enrollmentId,
        externalId: data.externalId ?? null,
        status: 'pending' as const,
        model: data.model ?? null,
        manufacturer: data.manufacturer ?? null,
        osVersion: data.osVersion ?? null,
        serialNumber: data.serialNumber ?? null,
        imei: data.imei ?? null,
        macAddress: data.macAddress ?? null,
        androidId: data.androidId ?? null,
        policyId: data.policyId ?? null,
        tags: data.tags ?? null,
        metadata: data.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };

      await conn().insert(devices).values(deviceData);

      return this.findDevice(id) as Promise<Device>;
    },

    async updateDevice(id: string, data: UpdateDeviceInput): Promise<Device> {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.externalId !== undefined) updateData.externalId = data.externalId;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.policyId !== undefined) updateData.policyId = data.policyId;
      if (data.appliedPolicyVersion !== undefined)
        updateData.appliedPolicyVersion = data.appliedPolicyVersion;
      if (data.policyAppliedAt !== undefined) updateData.policyAppliedAt = data.policyAppliedAt;
      if (data.desiredState !== undefined) updateData.desiredState = data.desiredState;
      if (data.desiredStateVersion !== undefined)
        updateData.desiredStateVersion = data.desiredStateVersion;
      if (data.reportedStateVersion !== undefined)
        updateData.reportedStateVersion = data.reportedStateVersion;
      if (data.stateReportedAt !== undefined) updateData.stateReportedAt = data.stateReportedAt;
      if (data.deletedAt !== undefined) updateData.deletedAt = data.deletedAt;
      if (data.agentVersion !== undefined) updateData.agentVersion = data.agentVersion;
      if (data.model !== undefined) updateData.model = data.model;
      if (data.manufacturer !== undefined) updateData.manufacturer = data.manufacturer;
      if (data.osVersion !== undefined) updateData.osVersion = data.osVersion;
      if (data.batteryLevel !== undefined) updateData.batteryLevel = data.batteryLevel;
      if (data.storageUsed !== undefined) updateData.storageUsed = data.storageUsed;
      if (data.storageTotal !== undefined) updateData.storageTotal = data.storageTotal;
      if (data.lastHeartbeat !== undefined) updateData.lastHeartbeat = data.lastHeartbeat;
      if (data.lastSync !== undefined) updateData.lastSync = data.lastSync;
      if (data.installedApps !== undefined) updateData.installedApps = data.installedApps;
      if (data.tags !== undefined) updateData.tags = data.tags;
      if (data.metadata !== undefined) updateData.metadata = data.metadata;
      if (data.publicKey !== undefined) updateData.publicKey = data.publicKey;
      if (data.enrollmentMethod !== undefined) updateData.enrollmentMethod = data.enrollmentMethod;

      if (data.location) {
        updateData.latitude = data.location.latitude.toString();
        updateData.longitude = data.location.longitude.toString();
        updateData.locationTimestamp = data.location.timestamp;
      }

      await conn().update(devices).set(updateData).where(eq(devices.id, id));

      return this.findDevice(id) as Promise<Device>;
    },

    async deleteDevice(id: string): Promise<void> {
      await conn().delete(devices).where(eq(devices.id, id));
    },

    async countDevices(filter?: DeviceFilter): Promise<number> {
      const result = await this.listDevices({ ...filter, limit: 0 });
      return result.total;
    },

    // ============================================
    // Policy Methods
    // ============================================

    async findPolicy(id: string): Promise<Policy | null> {
      const result = await conn().select().from(policies).where(eq(policies.id, id)).limit(1);
      return result[0] ? toPolicy(result[0]) : null;
    },

    async findDefaultPolicy(): Promise<Policy | null> {
      const result = await conn()
        .select()
        .from(policies)
        .where(eq(policies.isDefault, true))
        .limit(1);
      return result[0] ? toPolicy(result[0]) : null;
    },

    async listPolicies(): Promise<Policy[]> {
      const result = await conn().select().from(policies).orderBy(desc(policies.createdAt));
      return result.map(toPolicy);
    },

    async createPolicy(data: CreatePolicyInput): Promise<Policy> {
      const id = generateId();
      const now = new Date();

      const policyData = {
        id,
        tenantId: data.tenantId ?? null,
        version: data.version ?? 1,
        name: data.name,
        description: data.description ?? null,
        isDefault: data.isDefault ?? false,
        settings: data.settings,
        createdAt: now,
        updatedAt: now,
      };

      await conn().insert(policies).values(policyData);

      return this.findPolicy(id) as Promise<Policy>;
    },

    async updatePolicy(id: string, data: UpdatePolicyInput): Promise<Policy> {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
      if (data.settings !== undefined) updateData.settings = data.settings;
      if (data.version !== undefined) updateData.version = data.version;

      await conn().update(policies).set(updateData).where(eq(policies.id, id));

      return this.findPolicy(id) as Promise<Policy>;
    },

    async deletePolicy(id: string): Promise<void> {
      await conn().delete(policies).where(eq(policies.id, id));
    },

    // ============================================
    // Application Methods
    // ============================================

    async findApplication(id: string): Promise<Application | null> {
      const result = await conn()
        .select()
        .from(applications)
        .where(eq(applications.id, id))
        .limit(1);
      return result[0] ? toApplication(result[0]) : null;
    },

    async findApplicationByPackage(
      packageName: string,
      version?: string,
    ): Promise<Application | null> {
      let query = conn()
        .select()
        .from(applications)
        .where(eq(applications.packageName, packageName));

      if (version) {
        query = query.where(eq(applications.version, version));
      }

      const result = await query.orderBy(desc(applications.versionCode)).limit(1);
      return result[0] ? toApplication(result[0]) : null;
    },

    async listApplications(activeOnly?: boolean): Promise<Application[]> {
      let query = conn().select().from(applications);

      if (activeOnly) {
        query = query.where(eq(applications.isActive, true));
      }

      const result = await query.orderBy(desc(applications.createdAt));
      return result.map(toApplication);
    },

    async createApplication(data: CreateApplicationInput): Promise<Application> {
      const id = generateId();
      const now = new Date();

      const appData = {
        id,
        tenantId: data.tenantId ?? null,
        name: data.name,
        packageName: data.packageName,
        version: data.version,
        versionCode: data.versionCode,
        url: data.url,
        hash: data.hash ?? null,
        size: data.size ?? null,
        minSdkVersion: data.minSdkVersion ?? null,
        showIcon: data.showIcon ?? true,
        runAfterInstall: data.runAfterInstall ?? false,
        runAtBoot: data.runAtBoot ?? false,
        isSystem: data.isSystem ?? false,
        isActive: true,
        metadata: data.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };

      await conn().insert(applications).values(appData);

      return this.findApplication(id) as Promise<Application>;
    },

    async updateApplication(id: string, data: UpdateApplicationInput): Promise<Application> {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.name !== undefined) updateData.name = data.name;
      if (data.version !== undefined) updateData.version = data.version;
      if (data.versionCode !== undefined) updateData.versionCode = data.versionCode;
      if (data.url !== undefined) updateData.url = data.url;
      if (data.hash !== undefined) updateData.hash = data.hash;
      if (data.size !== undefined) updateData.size = data.size;
      if (data.minSdkVersion !== undefined) updateData.minSdkVersion = data.minSdkVersion;
      if (data.showIcon !== undefined) updateData.showIcon = data.showIcon;
      if (data.runAfterInstall !== undefined) updateData.runAfterInstall = data.runAfterInstall;
      if (data.runAtBoot !== undefined) updateData.runAtBoot = data.runAtBoot;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;
      if (data.metadata !== undefined) updateData.metadata = data.metadata;

      await conn().update(applications).set(updateData).where(eq(applications.id, id));

      return this.findApplication(id) as Promise<Application>;
    },

    async deleteApplication(id: string): Promise<void> {
      await conn().delete(applications).where(eq(applications.id, id));
    },

    // ============================================
    // Command Methods
    // ============================================

    async findCommand(id: string): Promise<Command | null> {
      const result = await conn().select().from(commands).where(eq(commands.id, id)).limit(1);
      return result[0] ? toCommand(result[0]) : null;
    },

    async listCommands(filter?: CommandFilter): Promise<Command[]> {
      let query = conn().select().from(commands);

      const conditions: (SQL | undefined)[] = [];

      if (filter?.tenantId) {
        conditions.push(eq(commands.tenantId, filter.tenantId));
      }

      if (filter?.deviceId) {
        conditions.push(eq(commands.deviceId, filter.deviceId));
      }

      if (filter?.status) {
        if (Array.isArray(filter.status)) {
          conditions.push(inArray(commands.status, filter.status));
        } else {
          conditions.push(eq(commands.status, filter.status));
        }
      }

      if (filter?.type) {
        if (Array.isArray(filter.type)) {
          conditions.push(inArray(commands.type, filter.type));
        } else {
          conditions.push(eq(commands.type, filter.type));
        }
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const limit = filter?.limit ?? 100;
      const offset = filter?.offset ?? 0;

      const result = await query.orderBy(desc(commands.createdAt)).limit(limit).offset(offset);

      return result.map(toCommand);
    },

    async createCommand(data: SendCommandInput): Promise<Command> {
      const id = generateId();
      const now = new Date();

      const commandData = {
        id,
        tenantId: data.tenantId ?? null,
        deviceId: data.deviceId,
        type: data.type,
        payload: data.payload ?? null,
        status: 'pending' as const,
        createdAt: now,
        idempotencyKey: data.idempotencyKey ?? null,
        expiresAt: data.expiresAt ?? null,
        attemptCount: 0,
        maxAttempts: data.maxAttempts ?? 5,
      };

      await conn().insert(commands).values(commandData);

      return this.findCommand(id) as Promise<Command>;
    },

    // ============================================
    // Canonical App Inventory / Update Enforcement
    // ============================================

    async syncDeviceApps(deviceId: string, apps: any[]): Promise<void> {
      if (!deviceApps) return;

      const now = new Date();

      // Upsert what the device reports. We deliberately do NOT delete rows for
      // apps that disappeared: a row can carry a *desired* version for an app
      // that is not installed yet (that is how a first install is expressed), and
      // deleting it would erase the intent. Uninstalled apps simply have their
      // observed version cleared.
      for (const app of apps) {
        await conn()
          .insert(deviceApps)
          .values({
            deviceId,
            packageName: app.packageName,
            observedVersion: app.version ?? null,
            observedVersionCode: app.versionCode ?? null,
            observedAt: now,
          })
          .onConflictDoUpdate({
            target: [deviceApps.deviceId, deviceApps.packageName],
            set: {
              observedVersion: app.version ?? null,
              observedVersionCode: app.versionCode ?? null,
              observedAt: now,
            },
          });
      }

      // Clear the observed version for apps the device no longer reports.
      //
      // The empty case is NOT a no-op: a device that reports zero installed apps
      // has uninstalled everything, and skipping the clear would leave the whole
      // inventory frozen at the last non-empty heartbeat.
      const reported = apps.map((app) => app.packageName);
      const stale = and(
        eq(deviceApps.deviceId, deviceId),
        isNotNull(deviceApps.observedVersion),
        ...(reported.length > 0 ? [not(inArray(deviceApps.packageName, reported))] : []),
      );

      await conn()
        .update(deviceApps)
        .set({ observedVersion: null, observedVersionCode: null, observedAt: now })
        .where(stale);
    },

    async listDeviceApps(deviceId: string): Promise<any[]> {
      if (!deviceApps) return [];

      const result = await conn()
        .select()
        .from(deviceApps)
        .where(eq(deviceApps.deviceId, deviceId));

      return result.map(toDeviceApp);
    },

    async setDesiredAppVersion(
      deviceIds: string[],
      packageName: string,
      version: string,
      versionCode?: number,
    ): Promise<void> {
      if (!deviceApps || deviceIds.length === 0) return;

      for (const deviceId of deviceIds) {
        await conn()
          .insert(deviceApps)
          .values({
            deviceId,
            packageName,
            desiredVersion: version,
            desiredVersionCode: versionCode ?? null,
            updateAttempts: 0,
          })
          .onConflictDoUpdate({
            target: [deviceApps.deviceId, deviceApps.packageName],
            set: {
              desiredVersion: version,
              desiredVersionCode: versionCode ?? null,
              // A new target is a fresh start: reset the attempt counter and
              // clear any escalation. A device stranded on the last version
              // deserves a clean shot at this one.
              updateAttempts: 0,
              lastAttemptAt: null,
              escalatedAt: null,
            },
          });
      }
    },

    async listAppsNeedingUpdate(options: {
      now: Date;
      backoffSeconds: number;
      limit: number;
    }): Promise<any[]> {
      if (!deviceApps) return [];

      const { now, backoffSeconds, limit } = options;
      const nowIso = now.toISOString();

      const result = await conn()
        .select()
        .from(deviceApps)
        .where(
          and(
            isNotNull(deviceApps.desiredVersion),
            // The comparison is a plain string inequality here — the ordering
            // decision is made in core, which understands version semantics. This
            // only has to be a cheap filter that never excludes a device that
            // might need work.
            or(
              isNull(deviceApps.observedVersion),
              sql`${deviceApps.observedVersion} <> ${deviceApps.desiredVersion}`,
            ),
            or(
              isNull(deviceApps.lastAttemptAt),
              sql`${deviceApps.lastAttemptAt} + make_interval(secs => ${backoffSeconds}::float8 * power(2, greatest(${deviceApps.updateAttempts} - 1, 0))) <= ${nowIso}::timestamptz`,
            ),
          ),
        )
        .orderBy(deviceApps.lastAttemptAt)
        .limit(limit);

      return result.map(toDeviceApp);
    },

    async recordAppUpdateAttempt(deviceId: string, packageName: string): Promise<void> {
      if (!deviceApps) return;

      await conn()
        .update(deviceApps)
        .set({
          updateAttempts: sql`${deviceApps.updateAttempts} + 1`,
          lastAttemptAt: new Date(),
        })
        .where(and(eq(deviceApps.deviceId, deviceId), eq(deviceApps.packageName, packageName)));
    },

    async escalateAppUpdate(deviceId: string, packageName: string): Promise<void> {
      if (!deviceApps) return;

      await conn()
        .update(deviceApps)
        .set({ escalatedAt: new Date() })
        .where(
          and(
            eq(deviceApps.deviceId, deviceId),
            eq(deviceApps.packageName, packageName),
            // Escalate once. Re-stamping on every sweep would make "when did this
            // device get stuck?" unanswerable.
            isNull(deviceApps.escalatedAt),
          ),
        );
    },

    async listEscalatedApps(packageName?: string): Promise<any[]> {
      if (!deviceApps) return [];

      const conditions = [isNotNull(deviceApps.escalatedAt)];
      if (packageName) {
        conditions.push(eq(deviceApps.packageName, packageName));
      }

      const result = await conn()
        .select()
        .from(deviceApps)
        .where(and(...conditions))
        .orderBy(desc(deviceApps.escalatedAt));

      return result.map(toDeviceApp);
    },

    // ============================================
    // Policy Version Methods
    // ============================================

    async createPolicyVersion(data: any): Promise<any> {
      if (!policyVersions) {
        throw new Error(
          'drizzleAdapter was not given a policyVersions table — policy history is unavailable.',
        );
      }

      const id = generateId();
      await conn()
        .insert(policyVersions)
        .values({
          id,
          policyId: data.policyId,
          version: data.version,
          settings: data.settings,
          createdBy: data.createdBy ?? null,
          note: data.note ?? null,
          createdAt: new Date(),
        })
        // A snapshot is written once per (policy, version) and never rewritten.
        // If a retry re-runs the write, keep the original row.
        .onConflictDoNothing({
          target: [policyVersions.policyId, policyVersions.version],
        });

      const found = await conn()
        .select()
        .from(policyVersions)
        .where(
          and(eq(policyVersions.policyId, data.policyId), eq(policyVersions.version, data.version)),
        )
        .limit(1);

      return toPolicyVersion(found[0]);
    },

    async listPolicyVersions(policyId: string): Promise<any[]> {
      if (!policyVersions) {
        throw new Error(
          'drizzleAdapter was not given a policyVersions table — policy history is unavailable.',
        );
      }

      const result = await conn()
        .select()
        .from(policyVersions)
        .where(eq(policyVersions.policyId, policyId))
        .orderBy(desc(policyVersions.version));

      return result.map(toPolicyVersion);
    },

    async findPolicyVersion(policyId: string, version: number): Promise<any> {
      if (!policyVersions) {
        throw new Error(
          'drizzleAdapter was not given a policyVersions table — policy history is unavailable.',
        );
      }

      const result = await conn()
        .select()
        .from(policyVersions)
        .where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.version, version)))
        .limit(1);

      return result[0] ? toPolicyVersion(result[0]) : null;
    },

    /**
     * Atomic idempotent insert.
     *
     * `ON CONFLICT DO NOTHING` against the partial unique index on
     * `(device_id, idempotency_key)` means two concurrent senders race in the
     * database rather than in application code: exactly one insert lands, the
     * other returns zero rows and reads back the winner. A find-then-insert in
     * application code cannot give this guarantee.
     */
    async createCommandIdempotent(
      data: SendCommandInput,
    ): Promise<{ command: Command; created: boolean }> {
      if (!data.idempotencyKey) {
        return { command: await this.createCommand(data), created: true };
      }

      const id = generateId();
      const inserted = await conn()
        .insert(commands)
        .values({
          id,
          tenantId: data.tenantId ?? null,
          deviceId: data.deviceId,
          type: data.type,
          payload: data.payload ?? null,
          status: 'pending' as const,
          createdAt: new Date(),
          idempotencyKey: data.idempotencyKey,
          expiresAt: data.expiresAt ?? null,
          attemptCount: 0,
          maxAttempts: data.maxAttempts ?? 5,
        })
        .onConflictDoNothing({
          target: [commands.deviceId, commands.idempotencyKey],
          // The unique index is partial, so Postgres only matches it as an
          // ON CONFLICT target when its predicate is restated. Without this:
          // "there is no unique or exclusion constraint matching the
          // ON CONFLICT specification". (For onConflictDoNothing, drizzle
          // emits this option as the index predicate, not a row filter.)
          where: sql`${commands.idempotencyKey} IS NOT NULL`,
        })
        .returning();

      if (inserted.length > 0) {
        return { command: toCommand(inserted[0]), created: true };
      }

      // Lost the race (or a duplicate send): the winning row is authoritative.
      const conflicting = await conn()
        .select()
        .from(commands)
        .where(
          and(
            eq(commands.deviceId, data.deviceId),
            eq(commands.idempotencyKey, data.idempotencyKey),
          ),
        )
        .limit(1);
      const existing = conflicting[0] ? toCommand(conflicting[0]) : null;
      if (!existing) {
        // The conflicting row vanished between the insert and this read —
        // only possible if it was deleted concurrently. Treat as a fresh send.
        return { command: await this.createCommand(data), created: true };
      }
      return { command: existing, created: false };
    },

    async findCommandByIdempotencyKey(
      deviceId: string,
      idempotencyKey: string,
    ): Promise<Command | null> {
      const result = await conn()
        .select()
        .from(commands)
        .where(and(eq(commands.deviceId, deviceId), eq(commands.idempotencyKey, idempotencyKey)))
        .limit(1);

      return result[0] ? toCommand(result[0]) : null;
    },

    async updateCommand(id: string, data: Partial<Command>): Promise<Command | null> {
      const updateData: Record<string, unknown> = {};

      if (data.status !== undefined) updateData.status = data.status;
      if (data.result !== undefined) updateData.result = data.result;
      if (data.error !== undefined) updateData.error = data.error;
      if (data.sentAt !== undefined) updateData.sentAt = data.sentAt;
      if (data.acknowledgedAt !== undefined) updateData.acknowledgedAt = data.acknowledgedAt;
      if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;
      if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt;
      if (data.maxAttempts !== undefined) updateData.maxAttempts = data.maxAttempts;
      // Recording the attempt also stamps lastAttemptAt — that timestamp is
      // what the retry sweep measures backoff against.
      if (data.attemptCount !== undefined) {
        updateData.attemptCount = data.attemptCount;
        updateData.lastAttemptAt = new Date();
      }

      await conn().update(commands).set(updateData).where(eq(commands.id, id));

      return this.findCommand(id);
    },

    async getPendingCommands(deviceId: string): Promise<Command[]> {
      return this.listCommands({
        deviceId,
        status: ['pending', 'sent'],
      });
    },

    /**
     * Reap commands that outlived their TTL before a device collected them.
     * Only undelivered statuses are touched: a command the device already
     * completed or failed keeps its terminal status.
     */
    async expireCommands(now: Date): Promise<number> {
      const expired = await conn()
        .update(commands)
        .set({ status: 'expired', completedAt: now })
        .where(
          and(
            inArray(commands.status, ['pending', 'sent', 'acknowledged']),
            isNotNull(commands.expiresAt),
            lte(commands.expiresAt, now),
          ),
        )
        .returning({ id: commands.id });

      return expired.length;
    },

    /**
     * Commands the device acknowledged and then never finished.
     *
     * `getPendingCommands` only returns `pending`/`sent`, so without this sweep
     * an agent that acked a command and crashed mid-execution would never be
     * given it again — the command would sit `acknowledged` forever.
     */
    async listStuckAcknowledgedCommands(options: {
      now: Date;
      ackTimeoutSeconds: number;
      limit: number;
    }): Promise<Command[]> {
      const { now, ackTimeoutSeconds, limit } = options;
      const nowIso = now.toISOString();

      const result = await conn()
        .select()
        .from(commands)
        .where(
          and(
            eq(commands.status, 'acknowledged'),
            isNotNull(commands.acknowledgedAt),
            sql`${commands.acknowledgedAt} + make_interval(secs => ${ackTimeoutSeconds}::float8) <= ${nowIso}::timestamptz`,
            // An expired command is the reaper's business, not the watchdog's.
            or(isNull(commands.expiresAt), sql`${commands.expiresAt} > ${nowIso}::timestamptz`),
          ),
        )
        .orderBy(commands.acknowledgedAt)
        .limit(limit);

      return result.map(toCommand);
    },

    /**
     * Commands whose push failed and are due another attempt: still `pending`,
     * not expired, attempts remaining, and past their exponential backoff
     * window (`backoffSeconds * 2^(attemptCount - 1)` since the last attempt).
     */
    async listRetryableCommands(options: {
      now: Date;
      backoffSeconds: number;
      limit: number;
    }): Promise<Command[]> {
      const { now, backoffSeconds, limit } = options;

      // Timestamps are passed as ISO strings with an explicit cast: handing a
      // JS Date to a raw sql`` fragment leaves the driver to guess the
      // parameter type, and postgres-js rejects it outright.
      const nowIso = now.toISOString();

      const result = await conn()
        .select()
        .from(commands)
        .where(
          and(
            eq(commands.status, 'pending'),
            lt(commands.attemptCount, commands.maxAttempts),
            or(isNull(commands.expiresAt), sql`${commands.expiresAt} > ${nowIso}::timestamptz`),
            or(
              // Never attempted: no backoff to wait out.
              isNull(commands.lastAttemptAt),
              // attempt N waits backoffSeconds * 2^(N-1)
              sql`${commands.lastAttemptAt} + make_interval(secs => ${backoffSeconds}::float8 * power(2, ${commands.attemptCount} - 1)) <= ${nowIso}::timestamptz`,
            ),
          ),
        )
        .orderBy(commands.createdAt)
        .limit(limit);

      return result.map(toCommand);
    },

    // ============================================
    // Event Methods
    // ============================================

    async createEvent(data: Omit<MDMEvent, 'id' | 'createdAt'>): Promise<MDMEvent> {
      const id = generateId();
      const now = new Date();

      const eventData = {
        id,
        deviceId: data.deviceId,
        type: data.type,
        payload: data.payload,
        createdAt: now,
      };

      await conn().insert(events).values(eventData);

      return {
        ...eventData,
        createdAt: now,
      };
    },

    async listEvents(filter?: EventFilter): Promise<MDMEvent[]> {
      let query = conn().select().from(events);

      const conditions: (SQL | undefined)[] = [];

      if (filter?.deviceId) {
        conditions.push(eq(events.deviceId, filter.deviceId));
      }

      if (filter?.type) {
        if (Array.isArray(filter.type)) {
          conditions.push(inArray(events.type, filter.type));
        } else {
          conditions.push(eq(events.type, filter.type));
        }
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const limit = filter?.limit ?? 100;
      const offset = filter?.offset ?? 0;

      const result = await query.orderBy(desc(events.createdAt)).limit(limit).offset(offset);

      return result.map(toEvent);
    },

    // ============================================
    // Group Methods
    // ============================================

    async findGroup(id: string): Promise<Group | null> {
      const result = await conn().select().from(groups).where(eq(groups.id, id)).limit(1);
      return result[0] ? toGroup(result[0]) : null;
    },

    async listGroups(): Promise<Group[]> {
      const result = await conn().select().from(groups).orderBy(groups.name);
      return result.map(toGroup);
    },

    async createGroup(data: CreateGroupInput): Promise<Group> {
      const id = generateId();
      const now = new Date();

      const groupData = {
        id,
        tenantId: data.tenantId ?? null,
        name: data.name,
        description: data.description ?? null,
        policyId: data.policyId ?? null,
        parentId: data.parentId ?? null,
        metadata: data.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };

      await conn().insert(groups).values(groupData);

      return this.findGroup(id) as Promise<Group>;
    },

    async updateGroup(id: string, data: UpdateGroupInput): Promise<Group> {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.policyId !== undefined) updateData.policyId = data.policyId;
      if (data.parentId !== undefined) updateData.parentId = data.parentId;
      if (data.metadata !== undefined) updateData.metadata = data.metadata;

      await conn().update(groups).set(updateData).where(eq(groups.id, id));

      return this.findGroup(id) as Promise<Group>;
    },

    async deleteGroup(id: string): Promise<void> {
      await conn().delete(groups).where(eq(groups.id, id));
    },

    async listDevicesInGroup(groupId: string): Promise<Device[]> {
      const result = await conn()
        .select({ device: devices })
        .from(deviceGroups)
        .innerJoin(devices, eq(deviceGroups.deviceId, devices.id))
        .where(eq(deviceGroups.groupId, groupId));

      return result.map((r: { device: Record<string, unknown> }) => toDevice(r.device));
    },

    async addDeviceToGroup(deviceId: string, groupId: string): Promise<void> {
      await conn().insert(deviceGroups).values({
        deviceId,
        groupId,
        createdAt: new Date(),
      });
    },

    async removeDeviceFromGroup(deviceId: string, groupId: string): Promise<void> {
      await conn()
        .delete(deviceGroups)
        .where(and(eq(deviceGroups.deviceId, deviceId), eq(deviceGroups.groupId, groupId)));
    },

    async getDeviceGroups(deviceId: string): Promise<Group[]> {
      const result = await conn()
        .select({ group: groups })
        .from(deviceGroups)
        .innerJoin(groups, eq(deviceGroups.groupId, groups.id))
        .where(eq(deviceGroups.deviceId, deviceId));

      return result.map((r: { group: Record<string, unknown> }) => toGroup(r.group));
    },

    // ============================================
    // Push Token Methods
    // ============================================

    async findPushToken(deviceId: string, provider: string): Promise<PushToken | null> {
      const result = await conn()
        .select()
        .from(pushTokens)
        .where(and(eq(pushTokens.deviceId, deviceId), eq(pushTokens.provider, provider as any)))
        .limit(1);
      return result[0] ? toPushToken(result[0]) : null;
    },

    async upsertPushToken(data: RegisterPushTokenInput): Promise<PushToken> {
      const existing = await this.findPushToken(data.deviceId, data.provider);
      const now = new Date();

      if (existing) {
        await conn()
          .update(pushTokens)
          .set({
            token: data.token,
            isActive: true,
            updatedAt: now,
          })
          .where(eq(pushTokens.id, existing.id));

        return this.findPushToken(data.deviceId, data.provider) as Promise<PushToken>;
      }

      const id = generateId();
      await conn().insert(pushTokens).values({
        id,
        deviceId: data.deviceId,
        provider: data.provider,
        token: data.token,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      return this.findPushToken(data.deviceId, data.provider) as Promise<PushToken>;
    },

    async deletePushToken(deviceId: string, provider?: string): Promise<void> {
      if (provider) {
        await conn()
          .delete(pushTokens)
          .where(and(eq(pushTokens.deviceId, deviceId), eq(pushTokens.provider, provider as any)));
      } else {
        await conn().delete(pushTokens).where(eq(pushTokens.deviceId, deviceId));
      }
    },

    // ============================================
    // App Version Methods (Optional)
    // ============================================

    ...(appVersions
      ? {
          async listAppVersions(packageName: string): Promise<AppVersion[]> {
            const result = await conn()
              .select()
              .from(appVersions)
              .where(eq(appVersions.packageName, packageName))
              .orderBy(desc(appVersions.versionCode));
            return result.map(toAppVersion);
          },

          async createAppVersion(data: Omit<AppVersion, 'id' | 'createdAt'>): Promise<AppVersion> {
            const id = generateId();
            const now = new Date();

            const versionData = {
              id,
              applicationId: data.applicationId,
              packageName: data.packageName,
              version: data.version,
              versionCode: data.versionCode,
              url: data.url,
              hash: data.hash ?? null,
              size: data.size ?? null,
              releaseNotes: data.releaseNotes ?? null,
              isMinimumVersion: data.isMinimumVersion ?? false,
              createdAt: now,
            };

            await conn().insert(appVersions).values(versionData);

            const result = await conn()
              .select()
              .from(appVersions)
              .where(eq(appVersions.id, id))
              .limit(1);
            return toAppVersion(result[0]);
          },

          async setMinimumVersion(packageName: string, versionCode: number): Promise<void> {
            // First, unset all minimum versions for this package
            await conn()
              .update(appVersions)
              .set({ isMinimumVersion: false })
              .where(eq(appVersions.packageName, packageName));

            // Then set the new minimum version
            await conn()
              .update(appVersions)
              .set({ isMinimumVersion: true })
              .where(
                and(
                  eq(appVersions.packageName, packageName),
                  eq(appVersions.versionCode, versionCode),
                ),
              );
          },

          async getMinimumVersion(packageName: string): Promise<AppVersion | null> {
            const result = await conn()
              .select()
              .from(appVersions)
              .where(
                and(
                  eq(appVersions.packageName, packageName),
                  eq(appVersions.isMinimumVersion, true),
                ),
              )
              .limit(1);
            return result[0] ? toAppVersion(result[0]) : null;
          },
        }
      : {}),

    // ============================================
    // Rollback Methods (Optional)
    // ============================================

    ...(rollbacks
      ? {
          async createRollback(data: CreateAppRollbackInput): Promise<AppRollback> {
            const id = generateId();
            const now = new Date();

            // Get current version info for the from_version fields
            const deviceResult = await conn()
              .select()
              .from(devices)
              .where(eq(devices.id, data.deviceId))
              .limit(1);

            const device = deviceResult[0];
            const installedApps = (device?.installedApps as any[]) || [];
            const currentApp = installedApps.find(
              (app: any) => app.packageName === data.packageName,
            );

            // Get target version info
            const targetVersionResult = await conn()
              .select()
              .from(appVersions!)
              .where(
                and(
                  eq(appVersions!.packageName, data.packageName),
                  eq(appVersions!.versionCode, data.toVersionCode),
                ),
              )
              .limit(1);

            const targetVersion = targetVersionResult[0];

            const rollbackData = {
              id,
              deviceId: data.deviceId,
              packageName: data.packageName,
              fromVersion: currentApp?.version ?? 'unknown',
              fromVersionCode: currentApp?.versionCode ?? 0,
              toVersion: targetVersion?.version ?? 'unknown',
              toVersionCode: data.toVersionCode,
              reason: data.reason ?? null,
              status: 'pending' as const,
              initiatedBy: data.initiatedBy ?? null,
              createdAt: now,
            };

            await conn().insert(rollbacks).values(rollbackData);

            const result = await conn()
              .select()
              .from(rollbacks)
              .where(eq(rollbacks.id, id))
              .limit(1);
            return toAppRollback(result[0]);
          },

          async updateRollback(id: string, data: Partial<AppRollback>): Promise<AppRollback> {
            const updateData: Record<string, unknown> = {};

            if (data.status !== undefined) updateData.status = data.status;
            if (data.error !== undefined) updateData.error = data.error;
            if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;

            await conn().update(rollbacks).set(updateData).where(eq(rollbacks.id, id));

            const result = await conn()
              .select()
              .from(rollbacks)
              .where(eq(rollbacks.id, id))
              .limit(1);
            return toAppRollback(result[0]);
          },

          async listRollbacks(filter?: {
            deviceId?: string;
            packageName?: string;
          }): Promise<AppRollback[]> {
            let query = conn().select().from(rollbacks);

            const conditions: (SQL | undefined)[] = [];

            if (filter?.deviceId) {
              conditions.push(eq(rollbacks.deviceId, filter.deviceId));
            }

            if (filter?.packageName) {
              conditions.push(eq(rollbacks.packageName, filter.packageName));
            }

            if (conditions.length > 0) {
              query = query.where(and(...conditions));
            }

            const result = await query.orderBy(desc(rollbacks.createdAt));
            return result.map(toAppRollback);
          },
        }
      : {}),

    // ============================================
    // Plugin Storage
    // ============================================
    //
    // These methods are only wired when the caller passes a
    // `pluginStorage` table. Plugins that need cross-instance
    // persistence (e.g. the kiosk plugin's lockout counters) check
    // for `mdm.pluginStorage` and fall back to in-memory state when
    // it is not configured.

    ...(pluginStorage
      ? {
          async getPluginValue(pluginName: string, key: string): Promise<unknown> {
            const rows = await conn()
              .select()
              .from(pluginStorage)
              .where(and(eq(pluginStorage.pluginName, pluginName), eq(pluginStorage.key, key)))
              .limit(1);
            if (rows.length === 0) return null;
            return rows[0].value;
          },

          async setPluginValue(pluginName: string, key: string, value: unknown): Promise<void> {
            // Postgres upsert: on conflict (plugin_name, key) update value + updated_at.
            // This keeps writes idempotent and last-writer-wins, which matches
            // the semantics the plugin-storage interface promises.
            await conn()
              .insert(pluginStorage)
              .values({
                pluginName,
                key,
                value,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [pluginStorage.pluginName, pluginStorage.key],
                set: {
                  value,
                  updatedAt: new Date(),
                },
              });
          },

          async deletePluginValue(pluginName: string, key: string): Promise<void> {
            await conn()
              .delete(pluginStorage)
              .where(and(eq(pluginStorage.pluginName, pluginName), eq(pluginStorage.key, key)));
          },

          async listPluginKeys(pluginName: string, prefix?: string): Promise<string[]> {
            const whereExpr = prefix
              ? and(eq(pluginStorage.pluginName, pluginName), like(pluginStorage.key, `${prefix}%`))
              : eq(pluginStorage.pluginName, pluginName);
            const rows = await conn()
              .select({ key: pluginStorage.key })
              .from(pluginStorage)
              .where(whereExpr);
            return rows.map((r: { key: string }) => r.key);
          },

          async clearPluginData(pluginName: string): Promise<void> {
            await conn().delete(pluginStorage).where(eq(pluginStorage.pluginName, pluginName));
          },
        }
      : {}),

    // ============================================
    // Enrollment Challenges (Phase 2b)
    // ============================================
    //
    // Only wired when the caller passes `enrollmentChallenges`.
    // The atomic consume is implemented as a conditional UPDATE
    // WHERE consumed_at IS NULL RETURNING *, which both guarantees
    // single-use semantics and returns the row only when the
    // transition actually happened.

    ...(enrollmentChallenges
      ? {
          async createEnrollmentChallenge(challenge: EnrollmentChallenge): Promise<void> {
            await conn()
              .insert(enrollmentChallenges)
              .values({
                challenge: challenge.challenge,
                expiresAt: challenge.expiresAt,
                consumedAt: challenge.consumedAt ?? null,
                createdAt: challenge.createdAt,
              });
          },

          async findEnrollmentChallenge(challenge: string): Promise<EnrollmentChallenge | null> {
            const rows = await conn()
              .select()
              .from(enrollmentChallenges)
              .where(eq(enrollmentChallenges.challenge, challenge))
              .limit(1);
            if (rows.length === 0) return null;
            const row = rows[0];
            return {
              challenge: row.challenge,
              expiresAt: row.expiresAt,
              consumedAt: row.consumedAt ?? null,
              createdAt: row.createdAt,
            };
          },

          async consumeEnrollmentChallenge(challenge: string): Promise<EnrollmentChallenge | null> {
            // Conditional UPDATE: the RETURNING clause gives us the
            // row only if the WHERE matched a previously-unused
            // challenge. Two concurrent calls can't both succeed
            // because the second one sees consumed_at IS NOT NULL
            // and no row matches.
            const rows = await conn()
              .update(enrollmentChallenges)
              .set({ consumedAt: new Date() })
              .where(
                and(
                  eq(enrollmentChallenges.challenge, challenge),
                  isNull(enrollmentChallenges.consumedAt),
                ),
              )
              .returning();
            if (rows.length === 0) return null;
            const row = rows[0];
            return {
              challenge: row.challenge,
              expiresAt: row.expiresAt,
              consumedAt: row.consumedAt,
              createdAt: row.createdAt,
            };
          },

          async pruneExpiredEnrollmentChallenges(now: Date): Promise<number> {
            const rows = await conn()
              .delete(enrollmentChallenges)
              .where(
                and(
                  lt(enrollmentChallenges.expiresAt, now),
                  isNull(enrollmentChallenges.consumedAt),
                ),
              )
              .returning({ challenge: enrollmentChallenges.challenge });
            return rows.length;
          },
        }
      : {}),

    // ============================================
    // Transaction Support
    // ============================================

    /**
     * Run `fn` inside a database transaction.
     *
     * Adapter calls made from `fn` execute on the transaction handle, so they
     * commit or roll back together. Previously this opened a transaction and
     * then ran `fn` against the *outer* connection, so nothing inside it was
     * actually transactional — a partial failure left half-written state.
     *
     * Nested calls join the enclosing transaction rather than opening a second
     * one.
     */
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (txStorage.getStore()) {
        return fn();
      }
      return db.transaction(async (tx) => txStorage.run(tx, () => fn()));
    },
  };
}

export type { SchemaOptions } from './schema';
// Re-export schema utilities
export { DEFAULT_TABLE_PREFIX } from './schema';
