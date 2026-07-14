import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSqlSchema } from '../../../packages/cli/src/generators/sql';
import { connect, type TestDB } from '../src/db';

/**
 * The SQL `openmdm generate` emits must actually build a working database.
 *
 * Unit tests can only assert that the generated text *contains* the right table
 * names. They cannot tell you whether Postgres will accept it — and it did not:
 * the generator emitted tables in declaration order, so `mdm_devices` (declared
 * first, with a foreign key to `mdm_policies`) was created before the table it
 * referenced. Postgres rejected the very first statement with
 * `relation "mdm_policies" does not exist`.
 *
 * In other words, the SQL this generator produced had never run against a
 * database, and no test noticed, because no test ever ran it. This one does: it
 * pipes the generated schema into a real Postgres and then checks the result is
 * the schema the adapter expects.
 */

const SCHEMA_DB = 'openmdm_generated_schema_test';

describe('generated schema (e2e, real Postgres)', () => {
  let db: TestDB;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const connection = await connect();
    db = connection.db;
    close = connection.close;

    // Build the schema inside its own Postgres schema namespace, so it cannot
    // collide with the tables the other e2e suites bootstrap.
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA_DB} CASCADE`));
    await db.execute(sql.raw(`CREATE SCHEMA ${SCHEMA_DB}`));
  });

  afterAll(async () => {
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA_DB} CASCADE`));
    await close();
  });

  it('executes cleanly against Postgres', async () => {
    const schema = generateSqlSchema({ provider: 'pg' });

    // Run it in the isolated namespace. `search_path` makes the unqualified
    // CREATE TABLE statements land there; the enum DO-blocks are idempotent.
    await db.execute(sql.raw(`SET search_path TO ${SCHEMA_DB}, public`));

    // If the generator emits tables out of dependency order, or references a
    // column that does not exist, this throws.
    await expect(db.execute(sql.raw(schema))).resolves.toBeDefined();

    await db.execute(sql.raw('SET search_path TO public'));
  });

  it('creates every table the runtime adapter needs', async () => {
    const rows = (await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = ${SCHEMA_DB}`,
    )) as unknown as Array<{ table_name: string }>;

    const created = new Set(rows.map((row) => row.table_name));

    for (const table of [
      'mdm_devices',
      'mdm_policies',
      'mdm_policy_versions',
      'mdm_applications',
      'mdm_commands',
      'mdm_events',
      'mdm_groups',
      'mdm_device_groups',
      'mdm_push_tokens',
      'mdm_app_versions',
      'mdm_rollbacks',
      'mdm_plugin_storage',
      // The table whose absence from the schema declaration forced consumers to
      // hand-patch their generated files.
      'mdm_enrollment_challenges',
    ]) {
      expect(created, `generated schema did not create ${table}`).toContain(table);
    }
  });

  it('creates the columns the adapter queries', async () => {
    const rows = (await db.execute(
      sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = ${SCHEMA_DB}`,
    )) as unknown as Array<{ table_name: string; column_name: string }>;

    const has = (table: string, column: string) =>
      rows.some((row) => row.table_name === table && row.column_name === column);

    // Device-pinned-key enrollment (Phase 2b).
    expect(has('mdm_devices', 'public_key')).toBe(true);
    expect(has('mdm_devices', 'enrollment_method')).toBe(true);

    // Command durability.
    expect(has('mdm_commands', 'idempotency_key')).toBe(true);
    expect(has('mdm_commands', 'expires_at')).toBe(true);
    expect(has('mdm_commands', 'attempt_count')).toBe(true);
    expect(has('mdm_commands', 'max_attempts')).toBe(true);

    // Tenant scoping.
    expect(has('mdm_devices', 'tenant_id')).toBe(true);
    expect(has('mdm_commands', 'tenant_id')).toBe(true);

    // Policy versioning + compliance.
    expect(has('mdm_policies', 'version')).toBe(true);
    expect(has('mdm_devices', 'applied_policy_version')).toBe(true);
  });
});
