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

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// ============================================
// Enums
// ============================================

export const deviceStatusEnum = pgEnum('mdm_device_status', [
  'pending',
  'enrolled',
  'unenrolled',
  'blocked',
  // Armed for unenroll: the server told the device to go, and is waiting for it
  // to confirm. See DEVICE_STATUS_TRANSITIONS in @openmdm/core.
  'unenrolling',
]);

export const commandStatusEnum = pgEnum('mdm_command_status', [
  'pending',
  'sent',
  'acknowledged',
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

export const pushProviderEnum = pgEnum('mdm_push_provider', ['fcm', 'mqtt', 'websocket']);

export const deployTargetTypeEnum = pgEnum('mdm_deploy_target_type', ['policy', 'group']);

export const deployActionEnum = pgEnum('mdm_deploy_action', ['install', 'update', 'uninstall']);

export const rollbackStatusEnum = pgEnum('mdm_rollback_status', [
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

// ============================================
// Devices Table
// ============================================

export const mdmDevices = pgTable(
  'mdm_devices',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // Owning tenant. Nullable: single-tenant deployments leave it NULL.
    tenantId: varchar('tenant_id', { length: 36 }),
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
    policyId: varchar('policy_id', { length: 36 }).references(() => mdmPolicies.id, {
      onDelete: 'set null',
    }),
    // The policy version this device last reported applying. Compared against
    // mdm_policies.version to detect drift.
    appliedPolicyVersion: integer('applied_policy_version'),
    policyAppliedAt: timestamp('policy_applied_at', { withTimezone: true }),

    // Declarative state the agent reconciles toward. jsonb (not json) so it can
    // be indexed into.
    desiredState: jsonb('desired_state').$type<Record<string, unknown>>(),
    desiredStateVersion: integer('desired_state_version').notNull().default(0),
    reportedStateVersion: integer('reported_state_version'),
    stateReportedAt: timestamp('state_reported_at', { withTimezone: true }),

    // Soft-delete tombstone. Retiring a device must not take its command and
    // audit history with it.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // 255, not 50: Android versionName is a free-form string with no platform
    // length limit — Google's TTS app ships a 53-char versionName in the wild.
    // Same rationale for every *version varchar below.
    agentVersion: varchar('agent_version', { length: 255 }), // MDM agent version
    lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
    lastSync: timestamp('last_sync', { withTimezone: true }),

    // Device identity (Phase 2b — device-pinned-key enrollment).
    // publicKey is the base64-encoded SPKI EC P-256 public key the
    // device registered on first enrollment. TEXT rather than BYTEA
    // because we always work with the base64 on the wire and
    // comparing base64 strings is cheaper than re-encoding.
    publicKey: text('public_key'),
    enrollmentMethod: varchar('enrollment_method', { length: 20 }),

    // Telemetry
    batteryLevel: integer('battery_level'),
    storageUsed: bigint('storage_used', { mode: 'number' }),
    storageTotal: bigint('storage_total', { mode: 'number' }),
    latitude: varchar('latitude', { length: 50 }),
    longitude: varchar('longitude', { length: 50 }),
    locationTimestamp: timestamp('location_timestamp', { withTimezone: true }),

    // JSON fields
    installedApps:
      json('installed_apps').$type<
        Array<{ packageName: string; version: string; versionCode?: number }>
      >(),
    tags: json('tags').$type<Record<string, string>>(),
    metadata: json('metadata').$type<Record<string, unknown>>(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mdm_devices_tenant_id_idx').on(table.tenantId),
    index('mdm_devices_status_idx').on(table.status),
    index('mdm_devices_policy_id_idx').on(table.policyId),
    index('mdm_devices_last_heartbeat_idx').on(table.lastHeartbeat),
    index('mdm_devices_mac_address_idx').on(table.macAddress),
    index('mdm_devices_serial_number_idx').on(table.serialNumber),
  ],
);

// ============================================
// Policies Table
// ============================================

export const mdmPolicies = pgTable(
  'mdm_policies',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // Owning tenant. Nullable: single-tenant deployments leave it NULL.
    tenantId: varchar('tenant_id', { length: 36 }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    settings: json('settings').notNull().$type<Record<string, unknown>>(),
    // Monotonic; bumped only when `settings` changes. See @openmdm/core's
    // Policy type.
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mdm_policies_name_idx').on(table.name),
    index('mdm_policies_is_default_idx').on(table.isDefault),
  ],
);

// ============================================
// Applications Table
// ============================================

export const mdmApplications = pgTable(
  'mdm_applications',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // Owning tenant. Nullable: single-tenant deployments leave it NULL.
    tenantId: varchar('tenant_id', { length: 36 }),
    name: varchar('name', { length: 255 }).notNull(),
    packageName: varchar('package_name', { length: 255 }).notNull(),
    version: varchar('version', { length: 255 }).notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mdm_applications_package_name_idx').on(table.packageName),
    uniqueIndex('mdm_applications_package_version_idx').on(table.packageName, table.version),
    index('mdm_applications_is_active_idx').on(table.isActive),
  ],
);

// ============================================
// Commands Table
// ============================================

export const mdmCommands = pgTable(
  'mdm_commands',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // Owning tenant. Nullable: single-tenant deployments leave it NULL.
    tenantId: varchar('tenant_id', { length: 36 }),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Durability. See @openmdm/core's Command type for the semantics.
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  },
  (table) => [
    index('mdm_commands_tenant_id_idx').on(table.tenantId),
    index('mdm_commands_device_id_idx').on(table.deviceId),
    index('mdm_commands_status_idx').on(table.status),
    index('mdm_commands_device_status_idx').on(table.deviceId, table.status),
    index('mdm_commands_created_at_idx').on(table.createdAt),
    // Partial unique index: the dedup guarantee only applies to rows that
    // actually carry a key, so commands sent without one are unconstrained.
    // This is what makes the ON CONFLICT DO NOTHING insert path atomic.
    uniqueIndex('mdm_commands_device_idempotency_key_idx')
      .on(table.deviceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    // Drives the retry sweep: pending commands whose backoff has elapsed.
    index('mdm_commands_retry_idx').on(table.status, table.lastAttemptAt),
    // Drives the expiry reaper.
    index('mdm_commands_expires_at_idx').on(table.expiresAt),
  ],
);

// ============================================
// Policy Versions Table
// ============================================

/**
 * Immutable snapshots of a policy's settings, one row per version. Written on
 * every settings change, so history is replayable and any prior version can be
 * restored.
 */
export const mdmPolicyVersions = pgTable(
  'mdm_policy_versions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    policyId: varchar('policy_id', { length: 36 })
      .notNull()
      .references(() => mdmPolicies.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    settings: json('settings').notNull().$type<Record<string, unknown>>(),
    createdBy: varchar('created_by', { length: 36 }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mdm_policy_versions_policy_id_idx').on(table.policyId),
    // One row per (policy, version): a snapshot is written once and never
    // rewritten, so a duplicate is a bug, not a race to tolerate.
    uniqueIndex('mdm_policy_versions_policy_version_idx').on(table.policyId, table.version),
  ],
);

// ============================================
// Device Apps Table (canonical inventory)
// ============================================

/**
 * One row per (device, package): what is installed, and what should be.
 *
 * App inventory used to live only inside `mdm_devices.installed_apps` JSON, so
 * "which devices run player < 2.0?" meant walking JSON for every device in the
 * fleet — and the update reconcile loop could not express its central question
 * in SQL at all. The JSON blob remains the full inventory; this is the
 * queryable, canonical form of the facts we act on.
 */
export const mdmDeviceApps = pgTable(
  'mdm_device_apps',
  {
    deviceId: varchar('device_id', { length: 36 })
      .notNull()
      .references(() => mdmDevices.id, { onDelete: 'cascade' }),
    packageName: varchar('package_name', { length: 255 }).notNull(),

    // Observed: what the device reports. One oversized versionName must not
    // reject the entire heartbeat, so this matches the generator's 255.
    observedVersion: varchar('observed_version', { length: 255 }),
    observedVersionCode: integer('observed_version_code'),
    observedAt: timestamp('observed_at', { withTimezone: true }),

    // Desired: what the server wants.
    desiredVersion: varchar('desired_version', { length: 255 }),
    desiredVersionCode: integer('desired_version_code'),

    // Enforcement state.
    updateAttempts: integer('update_attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.packageName] }),
    index('mdm_device_apps_package_idx').on(table.packageName),
    // Drives the reconcile sweep.
    index('mdm_device_apps_observed_version_idx').on(table.packageName, table.observedVersion),
    index('mdm_device_apps_escalated_idx').on(table.escalatedAt),
  ],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mdm_events_device_id_idx').on(table.deviceId),
    index('mdm_events_type_idx').on(table.type),
    index('mdm_events_device_type_idx').on(table.deviceId, table.type),
    index('mdm_events_created_at_idx').on(table.createdAt),
  ],
);

// ============================================
// Groups Table
// ============================================

export const mdmGroups = pgTable(
  'mdm_groups',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // Owning tenant. Nullable: single-tenant deployments leave it NULL.
    tenantId: varchar('tenant_id', { length: 36 }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    policyId: varchar('policy_id', { length: 36 }).references(() => mdmPolicies.id, {
      onDelete: 'set null',
    }),
    parentId: varchar('parent_id', { length: 36 }),
    metadata: json('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mdm_groups_name_idx').on(table.name),
    index('mdm_groups_policy_id_idx').on(table.policyId),
    index('mdm_groups_parent_id_idx').on(table.parentId),
  ],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.groupId] }),
    index('mdm_device_groups_group_id_idx').on(table.groupId),
  ],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mdm_push_tokens_device_id_idx').on(table.deviceId),
    uniqueIndex('mdm_push_tokens_provider_token_idx').on(table.provider, table.token),
    index('mdm_push_tokens_is_active_idx').on(table.isActive),
  ],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mdm_app_deployments_application_id_idx').on(table.applicationId),
    index('mdm_app_deployments_target_idx').on(table.targetType, table.targetId),
  ],
);

// ============================================
// App Versions Table (Version history for rollback support)
// ============================================

export const mdmAppVersions = pgTable(
  'mdm_app_versions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    applicationId: varchar('application_id', { length: 36 })
      .notNull()
      .references(() => mdmApplications.id, { onDelete: 'cascade' }),
    packageName: varchar('package_name', { length: 255 }).notNull(),
    version: varchar('version', { length: 255 }).notNull(),
    versionCode: integer('version_code').notNull(),
    url: text('url').notNull(),
    hash: varchar('hash', { length: 64 }), // SHA-256
    size: bigint('size', { mode: 'number' }),
    releaseNotes: text('release_notes'),
    isMinimumVersion: boolean('is_minimum_version').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mdm_app_versions_application_id_idx').on(table.applicationId),
    index('mdm_app_versions_package_name_idx').on(table.packageName),
    uniqueIndex('mdm_app_versions_package_version_code_idx').on(
      table.packageName,
      table.versionCode,
    ),
    index('mdm_app_versions_is_minimum_version_idx').on(table.isMinimumVersion),
  ],
);

// ============================================
// App Rollbacks Table (Rollback history and status)
// ============================================

export const mdmRollbacks = pgTable(
  'mdm_rollbacks',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    deviceId: varchar('device_id', { length: 36 })
      .notNull()
      .references(() => mdmDevices.id, { onDelete: 'cascade' }),
    packageName: varchar('package_name', { length: 255 }).notNull(),
    fromVersion: varchar('from_version', { length: 255 }).notNull(),
    fromVersionCode: integer('from_version_code').notNull(),
    toVersion: varchar('to_version', { length: 255 }).notNull(),
    toVersionCode: integer('to_version_code').notNull(),
    reason: text('reason'),
    status: rollbackStatusEnum('status').notNull().default('pending'),
    error: text('error'),
    initiatedBy: varchar('initiated_by', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('mdm_rollbacks_device_id_idx').on(table.deviceId),
    index('mdm_rollbacks_package_name_idx').on(table.packageName),
    index('mdm_rollbacks_device_package_idx').on(table.deviceId, table.packageName),
    index('mdm_rollbacks_status_idx').on(table.status),
    index('mdm_rollbacks_created_at_idx').on(table.createdAt),
  ],
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

// ============================================
// Plugin Storage Table
// ============================================
//
// Generic key-value store scoped by plugin name. Plugins use this to
// persist state that must survive process restarts and work across
// horizontally-scaled instances (the kiosk plugin's lockout counters
// are the canonical example).
//
// The JSONB `value` column is intentionally schemaless — each plugin
// owns the shape of its own values. Consumers should treat writes as
// last-write-wins; if you need ordering guarantees, do it in the
// plugin above this table.

export const mdmPluginStorage = pgTable(
  'mdm_plugin_storage',
  {
    pluginName: varchar('plugin_name', { length: 100 }).notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    value: json('value').notNull().$type<unknown>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.pluginName, table.key] }),
    index('mdm_plugin_storage_plugin_idx').on(table.pluginName),
  ],
);

// ============================================
// Enrollment Challenges Table (Phase 2b)
// ============================================
//
// Single-use nonces issued by the challenge endpoint and consumed
// by the device-pinned-key enrollment path. The atomic consume is
// the critical property — two concurrent enroll attempts with the
// same challenge must not both succeed. That's enforced in the
// adapter via a conditional `UPDATE ... WHERE consumed_at IS NULL
// RETURNING *`.
//
// Expired, unconsumed rows are pruned periodically via
// `pruneExpiredEnrollmentChallenges`; we don't rely on a TTL index.

export const mdmEnrollmentChallenges = pgTable(
  'mdm_enrollment_challenges',
  {
    challenge: varchar('challenge', { length: 255 }).primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mdm_enrollment_challenges_expires_at_idx').on(table.expiresAt)],
);

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

export const mdmDeviceGroupsRelations = relations(mdmDeviceGroups, ({ one }) => ({
  device: one(mdmDevices, {
    fields: [mdmDeviceGroups.deviceId],
    references: [mdmDevices.id],
  }),
  group: one(mdmGroups, {
    fields: [mdmDeviceGroups.groupId],
    references: [mdmGroups.id],
  }),
}));

export const mdmPushTokensRelations = relations(mdmPushTokens, ({ one }) => ({
  device: one(mdmDevices, {
    fields: [mdmPushTokens.deviceId],
    references: [mdmDevices.id],
  }),
}));

export const mdmApplicationsRelations = relations(mdmApplications, ({ many }) => ({
  deployments: many(mdmAppDeployments),
  versions: many(mdmAppVersions),
}));

export const mdmAppDeploymentsRelations = relations(mdmAppDeployments, ({ one }) => ({
  application: one(mdmApplications, {
    fields: [mdmAppDeployments.applicationId],
    references: [mdmApplications.id],
  }),
}));

export const mdmAppVersionsRelations = relations(mdmAppVersions, ({ one }) => ({
  application: one(mdmApplications, {
    fields: [mdmAppVersions.applicationId],
    references: [mdmApplications.id],
  }),
}));

export const mdmRollbacksRelations = relations(mdmRollbacks, ({ one }) => ({
  device: one(mdmDevices, {
    fields: [mdmRollbacks.deviceId],
    references: [mdmDevices.id],
  }),
}));

// ============================================
// Export all tables for easy schema setup
// ============================================

export const mdmSchema = {
  // Tables
  mdmDevices,
  mdmDeviceApps,
  mdmPolicies,
  mdmPolicyVersions,
  mdmApplications,
  mdmCommands,
  mdmEvents,
  mdmGroups,
  mdmDeviceGroups,
  mdmPushTokens,
  mdmAppDeployments,
  mdmAppVersions,
  mdmRollbacks,
  mdmPluginStorage,
  mdmEnrollmentChallenges,
  // Enums
  deviceStatusEnum,
  commandStatusEnum,
  pushProviderEnum,
  deployTargetTypeEnum,
  deployActionEnum,
  rollbackStatusEnum,
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
  mdmAppVersionsRelations,
  mdmRollbacksRelations,
};

export type MDMSchema = typeof mdmSchema;
