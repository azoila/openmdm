/**
 * OpenMDM Drizzle Schema
 *
 * This file exports the schema definition for use with schema generators.
 * For ready-to-use Drizzle tables, import from:
 * - @openmdm/drizzle-adapter/postgres
 * - @openmdm/drizzle-adapter/mysql
 * - @openmdm/drizzle-adapter/sqlite
 */

export { mdmSchema, getTableNames, getColumnNames } from '@openmdm/core/schema';

/**
 * Table prefix for MDM tables.
 * Can be customized via the adapter options.
 */
export const DEFAULT_TABLE_PREFIX = 'mdm_';

/**
 * Schema options for customizing table generation
 */
export interface SchemaOptions {
  /** Prefix for all MDM tables (default: 'mdm_') */
  tablePrefix?: string;
  /** Custom schema name (PostgreSQL only) */
  schema?: string;
}
