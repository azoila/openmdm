/**
 * OpenMDM Database Schema Definition
 *
 * This schema defines the structure for MDM data storage.
 * Database adapters implement this schema for their specific ORM/database.
 *
 * Tables:
 * - mdm_devices: Enrolled devices and their state
 * - mdm_policies: Device policies and configurations
 * - mdm_applications: Registered applications for deployment
 * - mdm_commands: Command queue for device operations
 * - mdm_events: Event log for device activities
 * - mdm_groups: Device grouping for bulk operations
 * - mdm_device_groups: Many-to-many device-group relationships
 * - mdm_push_tokens: FCM/MQTT push notification tokens
 * - mdm_app_deployments: App-to-policy/group deployment mappings
 * - mdm_app_versions: App version history for rollback support
 * - mdm_rollbacks: Rollback operation history and status
 * - mdm_webhook_endpoints: Outbound webhook configuration
 * - mdm_webhook_deliveries: Webhook delivery history
 */

// ============================================
// Schema Column Types
// ============================================

export type ColumnType =
  | 'string'
  | 'text'
  | 'integer'
  | 'bigint'
  | 'boolean'
  | 'datetime'
  | 'json'
  | 'enum';

export interface ColumnDefinition {
  type: ColumnType;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  default?: unknown;
  enumValues?: string[];
  references?: {
    table: string;
    column: string;
    onDelete?: 'cascade' | 'set null' | 'restrict';
  };
}

export interface IndexDefinition {
  columns: string[];
  unique?: boolean;
  name?: string;
}

export interface TableDefinition {
  columns: Record<string, ColumnDefinition>;
  indexes?: IndexDefinition[];
}

export interface SchemaDefinition {
  tables: Record<string, TableDefinition>;
}

// ============================================
// OpenMDM Schema
// ============================================

export const mdmSchema: SchemaDefinition = {
  tables: {
    // ----------------------------------------
    // Devices Table
    // ----------------------------------------
    mdm_devices: {
      columns: {
        id: { type: 'string', primaryKey: true },
        external_id: { type: 'string', nullable: true },
        enrollment_id: { type: 'string', unique: true },
        status: {
          type: 'enum',
          enumValues: ['pending', 'enrolled', 'unenrolled', 'blocked'],
          default: 'pending',
        },

        // Device Info
        model: { type: 'string', nullable: true },
        manufacturer: { type: 'string', nullable: true },
        os_version: { type: 'string', nullable: true },
        serial_number: { type: 'string', nullable: true },
        imei: { type: 'string', nullable: true },
        mac_address: { type: 'string', nullable: true },
        android_id: { type: 'string', nullable: true },

        // MDM State
        policy_id: {
          type: 'string',
          nullable: true,
          references: { table: 'mdm_policies', column: 'id', onDelete: 'set null' },
        },
        last_heartbeat: { type: 'datetime', nullable: true },
        last_sync: { type: 'datetime', nullable: true },

        // Telemetry (denormalized for quick access)
        battery_level: { type: 'integer', nullable: true },
        storage_used: { type: 'bigint', nullable: true },
        storage_total: { type: 'bigint', nullable: true },
        latitude: { type: 'string', nullable: true }, // Stored as string for precision
        longitude: { type: 'string', nullable: true },
        location_timestamp: { type: 'datetime', nullable: true },

        // JSON fields
        installed_apps: { type: 'json', nullable: true },
        tags: { type: 'json', nullable: true },
        metadata: { type: 'json', nullable: true },

        // Timestamps
        created_at: { type: 'datetime', default: 'now' },
        updated_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['enrollment_id'], unique: true },
        { columns: ['status'] },
        { columns: ['policy_id'] },
        { columns: ['last_heartbeat'] },
        { columns: ['mac_address'] },
        { columns: ['serial_number'] },
      ],
    },

    // ----------------------------------------
    // Policies Table
    // ----------------------------------------
    mdm_policies: {
      columns: {
        id: { type: 'string', primaryKey: true },
        name: { type: 'string' },
        description: { type: 'text', nullable: true },
        is_default: { type: 'boolean', default: false },
        settings: { type: 'json' },
        created_at: { type: 'datetime', default: 'now' },
        updated_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['name'] },
        { columns: ['is_default'] },
      ],
    },

    // ----------------------------------------
    // Applications Table
    // ----------------------------------------
    mdm_applications: {
      columns: {
        id: { type: 'string', primaryKey: true },
        name: { type: 'string' },
        package_name: { type: 'string' },
        version: { type: 'string' },
        version_code: { type: 'integer' },
        url: { type: 'string' },
        hash: { type: 'string', nullable: true }, // SHA-256
        size: { type: 'bigint', nullable: true },
        min_sdk_version: { type: 'integer', nullable: true },

        // Deployment settings
        show_icon: { type: 'boolean', default: true },
        run_after_install: { type: 'boolean', default: false },
        run_at_boot: { type: 'boolean', default: false },
        is_system: { type: 'boolean', default: false },

        // State
        is_active: { type: 'boolean', default: true },

        // Metadata
        metadata: { type: 'json', nullable: true },
        created_at: { type: 'datetime', default: 'now' },
        updated_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['package_name'] },
        { columns: ['package_name', 'version'], unique: true },
        { columns: ['is_active'] },
      ],
    },

    // ----------------------------------------
    // Commands Table
    // ----------------------------------------
    mdm_commands: {
      columns: {
        id: { type: 'string', primaryKey: true },
        device_id: {
          type: 'string',
          references: { table: 'mdm_devices', column: 'id', onDelete: 'cascade' },
        },
        type: { type: 'string' },
        payload: { type: 'json', nullable: true },
        status: {
          type: 'enum',
          enumValues: ['pending', 'sent', 'acknowledged', 'completed', 'failed', 'cancelled'],
          default: 'pending',
        },
        result: { type: 'json', nullable: true },
        error: { type: 'text', nullable: true },
        created_at: { type: 'datetime', default: 'now' },
        sent_at: { type: 'datetime', nullable: true },
        acknowledged_at: { type: 'datetime', nullable: true },
        completed_at: { type: 'datetime', nullable: true },
      },
      indexes: [
        { columns: ['device_id'] },
        { columns: ['status'] },
        { columns: ['device_id', 'status'] },
        { columns: ['created_at'] },
      ],
    },

    // ----------------------------------------
    // Events Table
    // ----------------------------------------
    mdm_events: {
      columns: {
        id: { type: 'string', primaryKey: true },
        device_id: {
          type: 'string',
          references: { table: 'mdm_devices', column: 'id', onDelete: 'cascade' },
        },
        type: { type: 'string' },
        payload: { type: 'json' },
        created_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['device_id'] },
        { columns: ['type'] },
        { columns: ['device_id', 'type'] },
        { columns: ['created_at'] },
      ],
    },

    // ----------------------------------------
    // Groups Table
    // ----------------------------------------
    mdm_groups: {
      columns: {
        id: { type: 'string', primaryKey: true },
        name: { type: 'string' },
        description: { type: 'text', nullable: true },
        policy_id: {
          type: 'string',
          nullable: true,
          references: { table: 'mdm_policies', column: 'id', onDelete: 'set null' },
        },
        parent_id: {
          type: 'string',
          nullable: true,
          references: { table: 'mdm_groups', column: 'id', onDelete: 'set null' },
        },
        metadata: { type: 'json', nullable: true },
        created_at: { type: 'datetime', default: 'now' },
        updated_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['name'] },
        { columns: ['policy_id'] },
        { columns: ['parent_id'] },
      ],
    },

    // ----------------------------------------
    // Device Groups (Many-to-Many)
    // ----------------------------------------
    mdm_device_groups: {
      columns: {
        device_id: {
          type: 'string',
          references: { table: 'mdm_devices', column: 'id', onDelete: 'cascade' },
        },
        group_id: {
          type: 'string',
          references: { table: 'mdm_groups', column: 'id', onDelete: 'cascade' },
        },
        created_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['device_id', 'group_id'], unique: true },
        { columns: ['group_id'] },
      ],
    },

    // ----------------------------------------
    // Push Tokens (for FCM/MQTT registration)
    // ----------------------------------------
    mdm_push_tokens: {
      columns: {
        id: { type: 'string', primaryKey: true },
        device_id: {
          type: 'string',
          references: { table: 'mdm_devices', column: 'id', onDelete: 'cascade' },
        },
        provider: {
          type: 'enum',
          enumValues: ['fcm', 'mqtt', 'websocket'],
        },
        token: { type: 'string' },
        is_active: { type: 'boolean', default: true },
        created_at: { type: 'datetime', default: 'now' },
        updated_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['device_id'] },
        { columns: ['provider', 'token'], unique: true },
        { columns: ['is_active'] },
      ],
    },

    // ----------------------------------------
    // Application Deployments (Which apps go to which policies/groups)
    // ----------------------------------------
    mdm_app_deployments: {
      columns: {
        id: { type: 'string', primaryKey: true },
        application_id: {
          type: 'string',
          references: { table: 'mdm_applications', column: 'id', onDelete: 'cascade' },
        },
        // Target can be policy or group
        target_type: {
          type: 'enum',
          enumValues: ['policy', 'group'],
        },
        target_id: { type: 'string' },
        action: {
          type: 'enum',
          enumValues: ['install', 'update', 'uninstall'],
          default: 'install',
        },
        is_required: { type: 'boolean', default: false },
        created_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['application_id'] },
        { columns: ['target_type', 'target_id'] },
      ],
    },

    // ----------------------------------------
    // App Versions (Version history for rollback support)
    // ----------------------------------------
    mdm_app_versions: {
      columns: {
        id: { type: 'string', primaryKey: true },
        application_id: {
          type: 'string',
          references: { table: 'mdm_applications', column: 'id', onDelete: 'cascade' },
        },
        package_name: { type: 'string' },
        version: { type: 'string' },
        version_code: { type: 'integer' },
        url: { type: 'string' },
        hash: { type: 'string', nullable: true },
        size: { type: 'bigint', nullable: true },
        release_notes: { type: 'text', nullable: true },
        is_minimum_version: { type: 'boolean', default: false },
        created_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['application_id'] },
        { columns: ['package_name'] },
        { columns: ['package_name', 'version_code'], unique: true },
        { columns: ['is_minimum_version'] },
      ],
    },

    // ----------------------------------------
    // App Rollbacks (Rollback history and status)
    // ----------------------------------------
    mdm_rollbacks: {
      columns: {
        id: { type: 'string', primaryKey: true },
        device_id: {
          type: 'string',
          references: { table: 'mdm_devices', column: 'id', onDelete: 'cascade' },
        },
        package_name: { type: 'string' },
        from_version: { type: 'string' },
        from_version_code: { type: 'integer' },
        to_version: { type: 'string' },
        to_version_code: { type: 'integer' },
        reason: { type: 'text', nullable: true },
        status: {
          type: 'enum',
          enumValues: ['pending', 'in_progress', 'completed', 'failed'],
          default: 'pending',
        },
        error: { type: 'text', nullable: true },
        initiated_by: { type: 'string', nullable: true },
        created_at: { type: 'datetime', default: 'now' },
        completed_at: { type: 'datetime', nullable: true },
      },
      indexes: [
        { columns: ['device_id'] },
        { columns: ['package_name'] },
        { columns: ['device_id', 'package_name'] },
        { columns: ['status'] },
        { columns: ['created_at'] },
      ],
    },

    // ----------------------------------------
    // Webhook Endpoints (For outbound webhook configuration storage)
    // ----------------------------------------
    mdm_webhook_endpoints: {
      columns: {
        id: { type: 'string', primaryKey: true },
        url: { type: 'string' },
        events: { type: 'json' }, // Array of event types or ['*']
        headers: { type: 'json', nullable: true },
        enabled: { type: 'boolean', default: true },
        description: { type: 'text', nullable: true },
        created_at: { type: 'datetime', default: 'now' },
        updated_at: { type: 'datetime', default: 'now' },
      },
      indexes: [
        { columns: ['enabled'] },
      ],
    },

    // ----------------------------------------
    // Webhook Deliveries (Delivery history and status)
    // ----------------------------------------
    mdm_webhook_deliveries: {
      columns: {
        id: { type: 'string', primaryKey: true },
        endpoint_id: {
          type: 'string',
          references: { table: 'mdm_webhook_endpoints', column: 'id', onDelete: 'cascade' },
        },
        event_id: { type: 'string' },
        event_type: { type: 'string' },
        payload: { type: 'json' },
        status: {
          type: 'enum',
          enumValues: ['pending', 'success', 'failed'],
          default: 'pending',
        },
        status_code: { type: 'integer', nullable: true },
        error: { type: 'text', nullable: true },
        retry_count: { type: 'integer', default: 0 },
        created_at: { type: 'datetime', default: 'now' },
        delivered_at: { type: 'datetime', nullable: true },
      },
      indexes: [
        { columns: ['endpoint_id'] },
        { columns: ['event_type'] },
        { columns: ['status'] },
        { columns: ['created_at'] },
      ],
    },
  },
};

// ============================================
// Schema Helper Functions
// ============================================

/**
 * Get all table names from the schema
 */
export function getTableNames(): string[] {
  return Object.keys(mdmSchema.tables);
}

/**
 * Get column names for a table
 */
export function getColumnNames(tableName: string): string[] {
  const table = mdmSchema.tables[tableName];
  if (!table) throw new Error(`Table ${tableName} not found in schema`);
  return Object.keys(table.columns);
}

/**
 * Get the primary key column for a table
 */
export function getPrimaryKey(tableName: string): string | null {
  const table = mdmSchema.tables[tableName];
  if (!table) throw new Error(`Table ${tableName} not found in schema`);

  for (const [name, def] of Object.entries(table.columns)) {
    if (def.primaryKey) return name;
  }
  return null;
}

/**
 * Convert snake_case column name to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase to snake_case
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Transform object keys from snake_case to camelCase
 */
export function transformToCamelCase<T extends Record<string, unknown>>(
  obj: T
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[snakeToCamel(key)] = value;
  }
  return result;
}

/**
 * Transform object keys from camelCase to snake_case
 */
export function transformToSnakeCase<T extends Record<string, unknown>>(
  obj: T
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[camelToSnake(key)] = value;
  }
  return result;
}
