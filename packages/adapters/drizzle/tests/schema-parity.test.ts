/**
 * The declared schema must match the runtime schema.
 *
 * `@openmdm/core`'s `mdmSchema` is a *declaration* — the CLI generates Drizzle
 * schema files and raw SQL from it (`openmdm generate`). `postgres.ts` in this
 * package is the *runtime* schema the adapter actually queries against.
 *
 * When they drift, `openmdm generate` emits a schema the adapter cannot run
 * against, and the failure is silent until a query hits a column that does not
 * exist. That is not hypothetical: the declaration was missing
 * `mdm_enrollment_challenges` entirely, along with `public_key` and
 * `enrollment_method` on devices, so consumers of the CLI hand-patched the
 * generated file and carried a "do not regenerate" warning in their repo.
 *
 * These tests make drift a test failure instead of a support ticket. If you add
 * a column or a table to `postgres.ts`, add it to `core/src/schema.ts` too —
 * that is the point.
 */

import { getTableNames, mdmSchema } from '@openmdm/core';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as runtime from '../src/postgres';

/** Every pgTable exported by the runtime schema, keyed by its SQL table name. */
function runtimeTables(): Map<string, Record<string, unknown>> {
  const tables = new Map<string, Record<string, unknown>>();

  for (const value of Object.values(runtime)) {
    // Drizzle tables are the only exports we can call getTableName on.
    if (!value || typeof value !== 'object') continue;
    let name: string;
    try {
      name = getTableName(value as never);
    } catch {
      continue;
    }
    if (typeof name !== 'string') continue;
    tables.set(name, getTableColumns(value as never) as Record<string, unknown>);
  }

  return tables;
}

/** The SQL column names of a runtime table. */
function runtimeColumnNames(columns: Record<string, unknown>): string[] {
  return Object.values(columns)
    .map((column) => (column as { name?: string }).name)
    .filter((name): name is string => typeof name === 'string');
}

describe('declared schema ↔ runtime schema parity', () => {
  const runtimeByName = runtimeTables();

  it('every runtime table is declared in core’s mdmSchema', () => {
    const declared = new Set(getTableNames());
    const missing = [...runtimeByName.keys()].filter((table) => !declared.has(table));

    // A runtime table the declaration does not know about is a table
    // `openmdm generate` will never emit — so a consumer who follows the
    // documented setup ends up with a database the adapter cannot use.
    expect(missing).toEqual([]);
  });

  describe.each([...runtimeByName.keys()])('%s', (tableName) => {
    it('every runtime column is declared', () => {
      const declaredTable = mdmSchema.tables[tableName];
      expect(declaredTable, `${tableName} is not declared in mdmSchema`).toBeDefined();

      const declaredColumns = new Set(Object.keys(declaredTable.columns));
      const runtimeColumns = runtimeColumnNames(runtimeByName.get(tableName)!);

      const missing = runtimeColumns.filter((column) => !declaredColumns.has(column));
      expect(missing).toEqual([]);
    });
  });
});

describe('regressions the parity check exists to catch', () => {
  it('declares mdm_enrollment_challenges (pinned-key enrollment)', () => {
    // The adapter has always required this table. Its absence from the
    // declaration is what forced consumers to hand-patch generated schema files.
    expect(mdmSchema.tables.mdm_enrollment_challenges).toBeDefined();
  });

  it('declares the device-pinned-key columns on devices', () => {
    const devices = mdmSchema.tables.mdm_devices.columns;
    expect(devices.public_key).toBeDefined();
    expect(devices.enrollment_method).toBeDefined();
  });

  it('declares the command durability columns', () => {
    const commands = mdmSchema.tables.mdm_commands.columns;
    expect(commands.idempotency_key).toBeDefined();
    expect(commands.expires_at).toBeDefined();
    expect(commands.attempt_count).toBeDefined();
    expect(commands.max_attempts).toBeDefined();
    expect(commands.last_attempt_at).toBeDefined();
  });

  it('declares `expired` as a command status', () => {
    const status = mdmSchema.tables.mdm_commands.columns.status;
    expect(status.enumValues).toContain('expired');
  });

  it('declares the tenant column on every tenant-scoped table', () => {
    for (const table of [
      'mdm_devices',
      'mdm_policies',
      'mdm_applications',
      'mdm_groups',
      'mdm_commands',
    ]) {
      expect(
        mdmSchema.tables[table].columns.tenant_id,
        `${table} is missing tenant_id`,
      ).toBeDefined();
    }
  });

  it('declares policy versioning', () => {
    expect(mdmSchema.tables.mdm_policies.columns.version).toBeDefined();
    expect(mdmSchema.tables.mdm_policy_versions).toBeDefined();
    expect(mdmSchema.tables.mdm_devices.columns.applied_policy_version).toBeDefined();
  });
});
