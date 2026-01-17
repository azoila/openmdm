/**
 * OpenMDM Drizzle Schema for SQLite
 *
 * Ready-to-use Drizzle table definitions for SQLite databases.
 *
 * @example
 * ```typescript
 * import { mdmDevices, mdmPolicies } from '@openmdm/drizzle-adapter/sqlite';
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 *
 * const db = drizzle(sqlite, { schema: { mdmDevices, mdmPolicies, ... } });
 * ```
 */

// SQLite schema implementation
// TODO: Implement SQLite-specific schema
// For now, users should use the PostgreSQL schema as reference

export const placeholder = 'SQLite schema coming soon';

throw new Error(
  '@openmdm/drizzle-adapter/sqlite is not yet implemented. ' +
    'Please use @openmdm/drizzle-adapter/postgres for now, or contribute the SQLite schema!'
);
