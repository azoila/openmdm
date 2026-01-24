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

import { eq, and, or, like, inArray, desc, sql, isNull, type SQL } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  DatabaseAdapter,
  Device,
  DeviceFilter,
  DeviceListResult,
  CreateDeviceInput,
  UpdateDeviceInput,
  Policy,
  CreatePolicyInput,
  UpdatePolicyInput,
  Application,
  CreateApplicationInput,
  UpdateApplicationInput,
  Command,
  SendCommandInput,
  CommandFilter,
  MDMEvent,
  EventFilter,
  Group,
  CreateGroupInput,
  UpdateGroupInput,
  PushToken,
  RegisterPushTokenInput,
  PolicySettings,
  InstalledApp,
  DeviceLocation,
  AppVersion,
  AppRollback,
  CreateAppRollbackInput,
} from '@openmdm/core';

// Import postgres schema types
import type {
  mdmDevices,
  mdmPolicies,
  mdmApplications,
  mdmCommands,
  mdmEvents,
  mdmGroups,
  mdmDeviceGroups,
  mdmPushTokens,
  mdmAppVersions,
  mdmRollbacks,
} from './postgres';

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
  };
}

/**
 * Create a Drizzle database adapter for OpenMDM
 */
export function drizzleAdapter(
  db: DrizzleDB,
  options: DrizzleAdapterOptions
): DatabaseAdapter {
  const { tables } = options;
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
  } = tables;

  // Helper to generate IDs
  const generateId = () => nanoid(21);

  // Helper to transform DB row to Device
  const toDevice = (row: Record<string, unknown>): Device => ({
    id: row.id as string,
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
    agentVersion: row.agentVersion as string | null,
    lastHeartbeat: row.lastHeartbeat as Date | null,
    lastSync: row.lastSync as Date | null,
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
    name: row.name as string,
    description: row.description as string | null,
    isDefault: row.isDefault as boolean,
    settings: row.settings as PolicySettings,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  });

  // Helper to transform DB row to Application
  const toApplication = (row: Record<string, unknown>): Application => ({
    id: row.id as string,
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
    // ============================================
    // Device Methods
    // ============================================

    async findDevice(id: string): Promise<Device | null> {
      const result = await (db as any)
        .select()
        .from(devices)
        .where(eq(devices.id, id))
        .limit(1);
      return result[0] ? toDevice(result[0]) : null;
    },

    async findDeviceByEnrollmentId(
      enrollmentId: string
    ): Promise<Device | null> {
      const result = await (db as any)
        .select()
        .from(devices)
        .where(eq(devices.enrollmentId, enrollmentId))
        .limit(1);
      return result[0] ? toDevice(result[0]) : null;
    },

    async listDevices(filter?: DeviceFilter): Promise<DeviceListResult> {
      const limit = filter?.limit ?? 100;
      const offset = filter?.offset ?? 0;

      let query = (db as any).select().from(devices);

      // Build WHERE conditions
      const conditions: (SQL | undefined)[] = [];

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
            like(devices.serialNumber, searchPattern)
          )
        );
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      // Get total count
      const countResult = await (db as any)
        .select({ count: sql<number>`count(*)` })
        .from(devices)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      const total = Number(countResult[0]?.count ?? 0);

      // Get paginated results
      const result = await query
        .orderBy(desc(devices.createdAt))
        .limit(limit)
        .offset(offset);

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

      await (db as any).insert(devices).values(deviceData);

      return this.findDevice(id) as Promise<Device>;
    },

    async updateDevice(id: string, data: UpdateDeviceInput): Promise<Device> {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.externalId !== undefined) updateData.externalId = data.externalId;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.policyId !== undefined) updateData.policyId = data.policyId;
      if (data.agentVersion !== undefined) updateData.agentVersion = data.agentVersion;
      if (data.model !== undefined) updateData.model = data.model;
      if (data.manufacturer !== undefined)
        updateData.manufacturer = data.manufacturer;
      if (data.osVersion !== undefined) updateData.osVersion = data.osVersion;
      if (data.batteryLevel !== undefined)
        updateData.batteryLevel = data.batteryLevel;
      if (data.storageUsed !== undefined)
        updateData.storageUsed = data.storageUsed;
      if (data.storageTotal !== undefined)
        updateData.storageTotal = data.storageTotal;
      if (data.lastHeartbeat !== undefined)
        updateData.lastHeartbeat = data.lastHeartbeat;
      if (data.lastSync !== undefined) updateData.lastSync = data.lastSync;
      if (data.installedApps !== undefined)
        updateData.installedApps = data.installedApps;
      if (data.tags !== undefined) updateData.tags = data.tags;
      if (data.metadata !== undefined) updateData.metadata = data.metadata;

      if (data.location) {
        updateData.latitude = data.location.latitude.toString();
        updateData.longitude = data.location.longitude.toString();
        updateData.locationTimestamp = data.location.timestamp;
      }

      await (db as any)
        .update(devices)
        .set(updateData)
        .where(eq(devices.id, id));

      return this.findDevice(id) as Promise<Device>;
    },

    async deleteDevice(id: string): Promise<void> {
      await (db as any).delete(devices).where(eq(devices.id, id));
    },

    async countDevices(filter?: DeviceFilter): Promise<number> {
      const result = await this.listDevices({ ...filter, limit: 0 });
      return result.total;
    },

    // ============================================
    // Policy Methods
    // ============================================

    async findPolicy(id: string): Promise<Policy | null> {
      const result = await (db as any)
        .select()
        .from(policies)
        .where(eq(policies.id, id))
        .limit(1);
      return result[0] ? toPolicy(result[0]) : null;
    },

    async findDefaultPolicy(): Promise<Policy | null> {
      const result = await (db as any)
        .select()
        .from(policies)
        .where(eq(policies.isDefault, true))
        .limit(1);
      return result[0] ? toPolicy(result[0]) : null;
    },

    async listPolicies(): Promise<Policy[]> {
      const result = await (db as any)
        .select()
        .from(policies)
        .orderBy(desc(policies.createdAt));
      return result.map(toPolicy);
    },

    async createPolicy(data: CreatePolicyInput): Promise<Policy> {
      const id = generateId();
      const now = new Date();

      const policyData = {
        id,
        name: data.name,
        description: data.description ?? null,
        isDefault: data.isDefault ?? false,
        settings: data.settings,
        createdAt: now,
        updatedAt: now,
      };

      await (db as any).insert(policies).values(policyData);

      return this.findPolicy(id) as Promise<Policy>;
    },

    async updatePolicy(id: string, data: UpdatePolicyInput): Promise<Policy> {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined)
        updateData.description = data.description;
      if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
      if (data.settings !== undefined) updateData.settings = data.settings;

      await (db as any)
        .update(policies)
        .set(updateData)
        .where(eq(policies.id, id));

      return this.findPolicy(id) as Promise<Policy>;
    },

    async deletePolicy(id: string): Promise<void> {
      await (db as any).delete(policies).where(eq(policies.id, id));
    },

    // ============================================
    // Application Methods
    // ============================================

    async findApplication(id: string): Promise<Application | null> {
      const result = await (db as any)
        .select()
        .from(applications)
        .where(eq(applications.id, id))
        .limit(1);
      return result[0] ? toApplication(result[0]) : null;
    },

    async findApplicationByPackage(
      packageName: string,
      version?: string
    ): Promise<Application | null> {
      let query = (db as any)
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
      let query = (db as any).select().from(applications);

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

      await (db as any).insert(applications).values(appData);

      return this.findApplication(id) as Promise<Application>;
    },

    async updateApplication(
      id: string,
      data: UpdateApplicationInput
    ): Promise<Application> {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.name !== undefined) updateData.name = data.name;
      if (data.version !== undefined) updateData.version = data.version;
      if (data.versionCode !== undefined)
        updateData.versionCode = data.versionCode;
      if (data.url !== undefined) updateData.url = data.url;
      if (data.hash !== undefined) updateData.hash = data.hash;
      if (data.size !== undefined) updateData.size = data.size;
      if (data.minSdkVersion !== undefined)
        updateData.minSdkVersion = data.minSdkVersion;
      if (data.showIcon !== undefined) updateData.showIcon = data.showIcon;
      if (data.runAfterInstall !== undefined)
        updateData.runAfterInstall = data.runAfterInstall;
      if (data.runAtBoot !== undefined) updateData.runAtBoot = data.runAtBoot;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;
      if (data.metadata !== undefined) updateData.metadata = data.metadata;

      await (db as any)
        .update(applications)
        .set(updateData)
        .where(eq(applications.id, id));

      return this.findApplication(id) as Promise<Application>;
    },

    async deleteApplication(id: string): Promise<void> {
      await (db as any).delete(applications).where(eq(applications.id, id));
    },

    // ============================================
    // Command Methods
    // ============================================

    async findCommand(id: string): Promise<Command | null> {
      const result = await (db as any)
        .select()
        .from(commands)
        .where(eq(commands.id, id))
        .limit(1);
      return result[0] ? toCommand(result[0]) : null;
    },

    async listCommands(filter?: CommandFilter): Promise<Command[]> {
      let query = (db as any).select().from(commands);

      const conditions: (SQL | undefined)[] = [];

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

      const result = await query
        .orderBy(desc(commands.createdAt))
        .limit(limit)
        .offset(offset);

      return result.map(toCommand);
    },

    async createCommand(data: SendCommandInput): Promise<Command> {
      const id = generateId();
      const now = new Date();

      const commandData = {
        id,
        deviceId: data.deviceId,
        type: data.type,
        payload: data.payload ?? null,
        status: 'pending' as const,
        createdAt: now,
      };

      await (db as any).insert(commands).values(commandData);

      return this.findCommand(id) as Promise<Command>;
    },

    async updateCommand(id: string, data: Partial<Command>): Promise<Command> {
      const updateData: Record<string, unknown> = {};

      if (data.status !== undefined) updateData.status = data.status;
      if (data.result !== undefined) updateData.result = data.result;
      if (data.error !== undefined) updateData.error = data.error;
      if (data.sentAt !== undefined) updateData.sentAt = data.sentAt;
      if (data.acknowledgedAt !== undefined)
        updateData.acknowledgedAt = data.acknowledgedAt;
      if (data.completedAt !== undefined)
        updateData.completedAt = data.completedAt;

      await (db as any)
        .update(commands)
        .set(updateData)
        .where(eq(commands.id, id));

      return this.findCommand(id) as Promise<Command>;
    },

    async getPendingCommands(deviceId: string): Promise<Command[]> {
      return this.listCommands({
        deviceId,
        status: ['pending', 'sent'],
      });
    },

    // ============================================
    // Event Methods
    // ============================================

    async createEvent(
      data: Omit<MDMEvent, 'id' | 'createdAt'>
    ): Promise<MDMEvent> {
      const id = generateId();
      const now = new Date();

      const eventData = {
        id,
        deviceId: data.deviceId,
        type: data.type,
        payload: data.payload,
        createdAt: now,
      };

      await (db as any).insert(events).values(eventData);

      return {
        ...eventData,
        createdAt: now,
      };
    },

    async listEvents(filter?: EventFilter): Promise<MDMEvent[]> {
      let query = (db as any).select().from(events);

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

      const result = await query
        .orderBy(desc(events.createdAt))
        .limit(limit)
        .offset(offset);

      return result.map(toEvent);
    },

    // ============================================
    // Group Methods
    // ============================================

    async findGroup(id: string): Promise<Group | null> {
      const result = await (db as any)
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .limit(1);
      return result[0] ? toGroup(result[0]) : null;
    },

    async listGroups(): Promise<Group[]> {
      const result = await (db as any)
        .select()
        .from(groups)
        .orderBy(groups.name);
      return result.map(toGroup);
    },

    async createGroup(data: CreateGroupInput): Promise<Group> {
      const id = generateId();
      const now = new Date();

      const groupData = {
        id,
        name: data.name,
        description: data.description ?? null,
        policyId: data.policyId ?? null,
        parentId: data.parentId ?? null,
        metadata: data.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };

      await (db as any).insert(groups).values(groupData);

      return this.findGroup(id) as Promise<Group>;
    },

    async updateGroup(id: string, data: UpdateGroupInput): Promise<Group> {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined)
        updateData.description = data.description;
      if (data.policyId !== undefined) updateData.policyId = data.policyId;
      if (data.parentId !== undefined) updateData.parentId = data.parentId;
      if (data.metadata !== undefined) updateData.metadata = data.metadata;

      await (db as any)
        .update(groups)
        .set(updateData)
        .where(eq(groups.id, id));

      return this.findGroup(id) as Promise<Group>;
    },

    async deleteGroup(id: string): Promise<void> {
      await (db as any).delete(groups).where(eq(groups.id, id));
    },

    async listDevicesInGroup(groupId: string): Promise<Device[]> {
      const result = await (db as any)
        .select({ device: devices })
        .from(deviceGroups)
        .innerJoin(devices, eq(deviceGroups.deviceId, devices.id))
        .where(eq(deviceGroups.groupId, groupId));

      return result.map((r: { device: Record<string, unknown> }) =>
        toDevice(r.device)
      );
    },

    async addDeviceToGroup(deviceId: string, groupId: string): Promise<void> {
      await (db as any).insert(deviceGroups).values({
        deviceId,
        groupId,
        createdAt: new Date(),
      });
    },

    async removeDeviceFromGroup(
      deviceId: string,
      groupId: string
    ): Promise<void> {
      await (db as any)
        .delete(deviceGroups)
        .where(
          and(
            eq(deviceGroups.deviceId, deviceId),
            eq(deviceGroups.groupId, groupId)
          )
        );
    },

    async getDeviceGroups(deviceId: string): Promise<Group[]> {
      const result = await (db as any)
        .select({ group: groups })
        .from(deviceGroups)
        .innerJoin(groups, eq(deviceGroups.groupId, groups.id))
        .where(eq(deviceGroups.deviceId, deviceId));

      return result.map((r: { group: Record<string, unknown> }) =>
        toGroup(r.group)
      );
    },

    // ============================================
    // Push Token Methods
    // ============================================

    async findPushToken(
      deviceId: string,
      provider: string
    ): Promise<PushToken | null> {
      const result = await (db as any)
        .select()
        .from(pushTokens)
        .where(
          and(
            eq(pushTokens.deviceId, deviceId),
            eq(pushTokens.provider, provider as any)
          )
        )
        .limit(1);
      return result[0] ? toPushToken(result[0]) : null;
    },

    async upsertPushToken(data: RegisterPushTokenInput): Promise<PushToken> {
      const existing = await this.findPushToken(data.deviceId, data.provider);
      const now = new Date();

      if (existing) {
        await (db as any)
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
      await (db as any).insert(pushTokens).values({
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
        await (db as any)
          .delete(pushTokens)
          .where(
            and(
              eq(pushTokens.deviceId, deviceId),
              eq(pushTokens.provider, provider as any)
            )
          );
      } else {
        await (db as any)
          .delete(pushTokens)
          .where(eq(pushTokens.deviceId, deviceId));
      }
    },

    // ============================================
    // App Version Methods (Optional)
    // ============================================

    ...(appVersions
      ? {
          async listAppVersions(packageName: string): Promise<AppVersion[]> {
            const result = await (db as any)
              .select()
              .from(appVersions)
              .where(eq(appVersions.packageName, packageName))
              .orderBy(desc(appVersions.versionCode));
            return result.map(toAppVersion);
          },

          async createAppVersion(
            data: Omit<AppVersion, 'id' | 'createdAt'>
          ): Promise<AppVersion> {
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

            await (db as any).insert(appVersions).values(versionData);

            const result = await (db as any)
              .select()
              .from(appVersions)
              .where(eq(appVersions.id, id))
              .limit(1);
            return toAppVersion(result[0]);
          },

          async setMinimumVersion(
            packageName: string,
            versionCode: number
          ): Promise<void> {
            // First, unset all minimum versions for this package
            await (db as any)
              .update(appVersions)
              .set({ isMinimumVersion: false })
              .where(eq(appVersions.packageName, packageName));

            // Then set the new minimum version
            await (db as any)
              .update(appVersions)
              .set({ isMinimumVersion: true })
              .where(
                and(
                  eq(appVersions.packageName, packageName),
                  eq(appVersions.versionCode, versionCode)
                )
              );
          },

          async getMinimumVersion(packageName: string): Promise<AppVersion | null> {
            const result = await (db as any)
              .select()
              .from(appVersions)
              .where(
                and(
                  eq(appVersions.packageName, packageName),
                  eq(appVersions.isMinimumVersion, true)
                )
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
            const deviceResult = await (db as any)
              .select()
              .from(devices)
              .where(eq(devices.id, data.deviceId))
              .limit(1);

            const device = deviceResult[0];
            const installedApps = (device?.installedApps as any[]) || [];
            const currentApp = installedApps.find(
              (app: any) => app.packageName === data.packageName
            );

            // Get target version info
            const targetVersionResult = await (db as any)
              .select()
              .from(appVersions!)
              .where(
                and(
                  eq(appVersions!.packageName, data.packageName),
                  eq(appVersions!.versionCode, data.toVersionCode)
                )
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

            await (db as any).insert(rollbacks).values(rollbackData);

            const result = await (db as any)
              .select()
              .from(rollbacks)
              .where(eq(rollbacks.id, id))
              .limit(1);
            return toAppRollback(result[0]);
          },

          async updateRollback(
            id: string,
            data: Partial<AppRollback>
          ): Promise<AppRollback> {
            const updateData: Record<string, unknown> = {};

            if (data.status !== undefined) updateData.status = data.status;
            if (data.error !== undefined) updateData.error = data.error;
            if (data.completedAt !== undefined)
              updateData.completedAt = data.completedAt;

            await (db as any)
              .update(rollbacks)
              .set(updateData)
              .where(eq(rollbacks.id, id));

            const result = await (db as any)
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
            let query = (db as any).select().from(rollbacks);

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
    // Transaction Support
    // ============================================

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return db.transaction(async () => {
        return fn();
      });
    },
  };
}

// Re-export schema utilities
export { DEFAULT_TABLE_PREFIX } from './schema';
export type { SchemaOptions } from './schema';
