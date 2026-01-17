/**
 * OpenMDM Drizzle Schema for PostgreSQL
 *
 * Ready-to-use Drizzle table definitions for PostgreSQL databases.
 *
 * @example
 * ```typescript
 * import { mdmDevices, mdmPolicies } from '@openmdm/drizzle-adapter/postgres';
 * import { drizzle } from 'drizzle-orm/node-postgres';
 *
 * const db = drizzle(pool, { schema: { mdmDevices, mdmPolicies, ... } });
 * ```
 */

import {
  pgTable,
  pgEnum,
  text,
  varchar,
  boolean,
  integer,
  bigint,
  timestamp,
  json,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================
// Enums
// ============================================

export const deviceStatusEnum = pgEnum('mdm_device_status', [
  'pending',
  'enrolled',
  'unenrolled',
  'blocked',
]);

export const commandStatusEnum = pgEnum('mdm_command_status', [
  'pending',
  'sent',
  'acknowledged',
  'completed',
  'failed',
  'cancelled',
]);

export const pushProviderEnum = pgEnum('mdm_push_provider', [
  'fcm',
  'mqtt',
  'websocket',
]);

export const deployTargetTypeEnum = pgEnum('mdm_deploy_target_type', [
  'policy',
  'group',
]);

export const deployActionEnum = pgEnum('mdm_deploy_action', [
  'install',
  'update',
  'uninstall',
]);

// ============================================
// Devices Table
// ============================================

export const mdmDevices = pgTable(
  'mdm_devices',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    externalId: varchar('external_id', { length: 255 }),
    enrollmentId: varchar('enrollment_id', { length: 255 }).notNull().unique(),
    status: deviceStatusEnum('status').notNull().default('pending'),

    // Device Info
    model: varchar('model', { length: 255 }),
    manufacturer: varchar('manufacturer', { length: 255 }),
    osVersion: varchar('os_version', { length: 50 }),
    serialNumber: varchar('serial_number', { length: 255 }),
    imei: varchar('imei', { length: 50 }),
    macAddress: varchar('mac_address', { length: 50 }),
    androidId: varchar('android_id', { length: 100 }),

    // MDM State
    policyId: varchar('policy_id', { length: 36 }).references(
      () => mdmPolicies.id,
      { onDelete: 'set null' }
    ),
    lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
    lastSync: timestamp('last_sync', { withTimezone: true }),

    // Telemetry
    batteryLevel: integer('battery_level'),
    storageUsed: bigint('storage_used', { mode: 'number' }),
    storageTotal: bigint('storage_total', { mode: 'number' }),
    latitude: varchar('latitude', { length: 50 }),
    longitude: varchar('longitude', { length: 50 }),
    locationTimestamp: timestamp('location_timestamp', { withTimezone: true }),

    // JSON fields
    installedApps: json('installed_apps').$type<
      Array<{ packageName: string; version: string; versionCode?: number }>
    >(),
    tags: json('tags').$type<Record<string, string>>(),
    metadata: json('metadata').$type<Record<string, unknown>>(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mdm_devices_status_idx').on(table.status),
    index('mdm_devices_policy_id_idx').on(table.policyId),
    index('mdm_devices_last_heartbeat_idx').on(table.lastHeartbeat),
    index('mdm_devices_mac_address_idx').on(table.macAddress),
    index('mdm_devices_serial_number_idx').on(table.serialNumber),
  ]
);

// ============================================
// Policies Table
// ============================================

export const mdmPolicies = pgTable(
  'mdm_policies',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    settings: json('settings').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mdm_policies_name_idx').on(table.name),
    index('mdm_policies_is_default_idx').on(table.isDefault),
  ]
);

// ============================================
// Applications Table
// ============================================

export const mdmApplications = pgTable(
  'mdm_applications',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    packageName: varchar('package_name', { length: 255 }).notNull(),
    version: varchar('version', { length: 50 }).notNull(),
    versionCode: integer('version_code').notNull(),
    url: text('url').notNull(),
    hash: varchar('hash', { length: 64 }), // SHA-256
    size: bigint('size', { mode: 'number' }),
    minSdkVersion: integer('min_sdk_version'),

    // Deployment settings
    showIcon: boolean('show_icon').notNull().default(true),
    runAfterInstall: boolean('run_after_install').notNull().default(false),
    runAtBoot: boolean('run_at_boot').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),

    // State
    isActive: boolean('is_active').notNull().default(true),

    // Metadata
    metadata: json('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mdm_applications_package_name_idx').on(table.packageName),
    uniqueIndex('mdm_applications_package_version_idx').on(
      table.packageName,
      table.version
    ),
    index('mdm_applications_is_active_idx').on(table.isActive),
  ]
);

// ============================================
// Commands Table
// ============================================

export const mdmCommands = pgTable(
  'mdm_commands',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    deviceId: varchar('device_id', { length: 36 })
      .notNull()
      .references(() => mdmDevices.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    payload: json('payload').$type<Record<string, unknown>>(),
    status: commandStatusEnum('status').notNull().default('pending'),
    result: json('result').$type<{
      success: boolean;
      message?: string;
      data?: unknown;
    }>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('mdm_commands_device_id_idx').on(table.deviceId),
    index('mdm_commands_status_idx').on(table.status),
    index('mdm_commands_device_status_idx').on(table.deviceId, table.status),
    index('mdm_commands_created_at_idx').on(table.createdAt),
  ]
);

// ============================================
// Events Table
// ============================================

export const mdmEvents = pgTable(
  'mdm_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    deviceId: varchar('device_id', { length: 36 })
      .notNull()
      .references(() => mdmDevices.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 100 }).notNull(),
    payload: json('payload').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mdm_events_device_id_idx').on(table.deviceId),
    index('mdm_events_type_idx').on(table.type),
    index('mdm_events_device_type_idx').on(table.deviceId, table.type),
    index('mdm_events_created_at_idx').on(table.createdAt),
  ]
);

// ============================================
// Groups Table
// ============================================

export const mdmGroups = pgTable(
  'mdm_groups',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    policyId: varchar('policy_id', { length: 36 }).references(
      () => mdmPolicies.id,
      { onDelete: 'set null' }
    ),
    parentId: varchar('parent_id', { length: 36 }),
    metadata: json('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mdm_groups_name_idx').on(table.name),
    index('mdm_groups_policy_id_idx').on(table.policyId),
    index('mdm_groups_parent_id_idx').on(table.parentId),
  ]
);

// ============================================
// Device Groups (Many-to-Many)
// ============================================

export const mdmDeviceGroups = pgTable(
  'mdm_device_groups',
  {
    deviceId: varchar('device_id', { length: 36 })
      .notNull()
      .references(() => mdmDevices.id, { onDelete: 'cascade' }),
    groupId: varchar('group_id', { length: 36 })
      .notNull()
      .references(() => mdmGroups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.groupId] }),
    index('mdm_device_groups_group_id_idx').on(table.groupId),
  ]
);

// ============================================
// Push Tokens Table
// ============================================

export const mdmPushTokens = pgTable(
  'mdm_push_tokens',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    deviceId: varchar('device_id', { length: 36 })
      .notNull()
      .references(() => mdmDevices.id, { onDelete: 'cascade' }),
    provider: pushProviderEnum('provider').notNull(),
    token: text('token').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mdm_push_tokens_device_id_idx').on(table.deviceId),
    uniqueIndex('mdm_push_tokens_provider_token_idx').on(
      table.provider,
      table.token
    ),
    index('mdm_push_tokens_is_active_idx').on(table.isActive),
  ]
);

// ============================================
// App Deployments Table
// ============================================

export const mdmAppDeployments = pgTable(
  'mdm_app_deployments',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    applicationId: varchar('application_id', { length: 36 })
      .notNull()
      .references(() => mdmApplications.id, { onDelete: 'cascade' }),
    targetType: deployTargetTypeEnum('target_type').notNull(),
    targetId: varchar('target_id', { length: 36 }).notNull(),
    action: deployActionEnum('action').notNull().default('install'),
    isRequired: boolean('is_required').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mdm_app_deployments_application_id_idx').on(table.applicationId),
    index('mdm_app_deployments_target_idx').on(table.targetType, table.targetId),
  ]
);

// ============================================
// Relations
// ============================================

export const mdmDevicesRelations = relations(mdmDevices, ({ one, many }) => ({
  policy: one(mdmPolicies, {
    fields: [mdmDevices.policyId],
    references: [mdmPolicies.id],
  }),
  commands: many(mdmCommands),
  events: many(mdmEvents),
  pushTokens: many(mdmPushTokens),
  deviceGroups: many(mdmDeviceGroups),
}));

export const mdmPoliciesRelations = relations(mdmPolicies, ({ many }) => ({
  devices: many(mdmDevices),
  groups: many(mdmGroups),
}));

export const mdmCommandsRelations = relations(mdmCommands, ({ one }) => ({
  device: one(mdmDevices, {
    fields: [mdmCommands.deviceId],
    references: [mdmDevices.id],
  }),
}));

export const mdmEventsRelations = relations(mdmEvents, ({ one }) => ({
  device: one(mdmDevices, {
    fields: [mdmEvents.deviceId],
    references: [mdmDevices.id],
  }),
}));

export const mdmGroupsRelations = relations(mdmGroups, ({ one, many }) => ({
  policy: one(mdmPolicies, {
    fields: [mdmGroups.policyId],
    references: [mdmPolicies.id],
  }),
  parent: one(mdmGroups, {
    fields: [mdmGroups.parentId],
    references: [mdmGroups.id],
    relationName: 'parentChild',
  }),
  children: many(mdmGroups, { relationName: 'parentChild' }),
  deviceGroups: many(mdmDeviceGroups),
}));

export const mdmDeviceGroupsRelations = relations(
  mdmDeviceGroups,
  ({ one }) => ({
    device: one(mdmDevices, {
      fields: [mdmDeviceGroups.deviceId],
      references: [mdmDevices.id],
    }),
    group: one(mdmGroups, {
      fields: [mdmDeviceGroups.groupId],
      references: [mdmGroups.id],
    }),
  })
);

export const mdmPushTokensRelations = relations(mdmPushTokens, ({ one }) => ({
  device: one(mdmDevices, {
    fields: [mdmPushTokens.deviceId],
    references: [mdmDevices.id],
  }),
}));

export const mdmApplicationsRelations = relations(
  mdmApplications,
  ({ many }) => ({
    deployments: many(mdmAppDeployments),
  })
);

export const mdmAppDeploymentsRelations = relations(
  mdmAppDeployments,
  ({ one }) => ({
    application: one(mdmApplications, {
      fields: [mdmAppDeployments.applicationId],
      references: [mdmApplications.id],
    }),
  })
);

// ============================================
// Export all tables for easy schema setup
// ============================================

export const mdmSchema = {
  // Tables
  mdmDevices,
  mdmPolicies,
  mdmApplications,
  mdmCommands,
  mdmEvents,
  mdmGroups,
  mdmDeviceGroups,
  mdmPushTokens,
  mdmAppDeployments,
  // Enums
  deviceStatusEnum,
  commandStatusEnum,
  pushProviderEnum,
  deployTargetTypeEnum,
  deployActionEnum,
  // Relations
  mdmDevicesRelations,
  mdmPoliciesRelations,
  mdmCommandsRelations,
  mdmEventsRelations,
  mdmGroupsRelations,
  mdmDeviceGroupsRelations,
  mdmPushTokensRelations,
  mdmApplicationsRelations,
  mdmAppDeploymentsRelations,
};

export type MDMSchema = typeof mdmSchema;
