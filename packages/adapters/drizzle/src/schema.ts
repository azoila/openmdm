/**
 * OpenMDM Drizzle Schema
 *
 * This file exports the schema definition for use with schema generators.
 * For ready-to-use Drizzle tables, import from:
 * - @openmdm/drizzle-adapter/postgres
 *
 * MySQL and SQLite runtime schemas are not implemented yet — the adapter currently
 * supports PostgreSQL only. Use `openmdm generate --dialect mysql|sqlite` to scaffold
 * a schema, or contribute the runtime support.
 */

export { getColumnNames, getTableNames, mdmSchema } from '@openmdm/core/schema';

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
