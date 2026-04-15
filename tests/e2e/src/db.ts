import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { mdmPluginStorage } from '../../../packages/adapters/drizzle/src/postgres';

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://openmdm:openmdm@localhost:54329/openmdm_test';

export type TestDB = ReturnType<typeof drizzle>;

/**
 * Connect to the docker-compose Postgres and run a minimal schema
 * bootstrap. We intentionally do NOT run `drizzle-kit` or execute the
 * full monorepo schema — these tests only need the tables they
 * exercise, and pulling in drizzle-kit at test time would bind us to
 * a specific project layout the test suite should not care about.
 *
 * Each test file gets its own connection and a fresh truncate of the
 * tables it touches. See the `resetTables` helper below.
 */
export async function connect(): Promise<{
  db: TestDB;
  close: () => Promise<void>;
}> {
  const client = postgres(DATABASE_URL, { max: 4, prepare: false });
  const db = drizzle(client, { schema: { mdmPluginStorage } });

  await bootstrapPluginStorageTable(db);

  return {
    db,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

/**
 * Create the `mdm_plugin_storage` table if it does not exist. We do
 * this in raw SQL rather than through a migration because this test
 * harness has to run identically in CI (where no migration history
 * exists) and locally (where a developer might have partial state).
 *
 * The table shape here must stay in lockstep with `postgres.ts`'s
 * `mdmPluginStorage` table definition. If you add a column there, add
 * it here too — otherwise the e2e tests silently skip it.
 */
async function bootstrapPluginStorageTable(db: TestDB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mdm_plugin_storage (
      plugin_name VARCHAR(100) NOT NULL,
      key VARCHAR(255) NOT NULL,
      value JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (plugin_name, key)
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mdm_plugin_storage_plugin_idx
      ON mdm_plugin_storage (plugin_name)
  `);
}

/**
 * Wipe the plugin storage table between tests so each test starts
 * from a clean slate without reaching across test-file boundaries.
 */
export async function resetPluginStorage(db: TestDB): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE mdm_plugin_storage`);
}
