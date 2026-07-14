import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  mdmCommands,
  mdmDevices,
  mdmEnrollmentChallenges,
  mdmPluginStorage,
} from '../../../packages/adapters/drizzle/src/postgres';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://openmdm:openmdm@localhost:54329/openmdm_test';

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
  const client = postgres(DATABASE_URL, { max: 8, prepare: false });
  const db = drizzle(client, {
    schema: { mdmPluginStorage, mdmEnrollmentChallenges, mdmDevices, mdmCommands },
  });

  await bootstrapPluginStorageTable(db);
  await bootstrapEnrollmentChallengesTable(db);
  await bootstrapCommandTables(db);

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

/**
 * Create the `mdm_enrollment_challenges` table if it does not
 * exist. Must stay in lockstep with `postgres.ts`'s
 * `mdmEnrollmentChallenges` table definition.
 */
async function bootstrapEnrollmentChallengesTable(db: TestDB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mdm_enrollment_challenges (
      challenge VARCHAR(255) PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mdm_enrollment_challenges_expires_at_idx
      ON mdm_enrollment_challenges (expires_at)
  `);
}

/**
 * Wipe the enrollment challenges table between tests.
 */
export async function resetEnrollmentChallenges(db: TestDB): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE mdm_enrollment_challenges`);
}

/**
 * Create the device + command tables used by the command-durability tests.
 * Must stay in lockstep with `postgres.ts`.
 *
 * The partial unique index on `(device_id, idempotency_key)` is the load-
 * bearing piece: it is what makes `INSERT ... ON CONFLICT DO NOTHING` an
 * atomic dedup rather than an optimistic guess. Partial, so that commands
 * sent without a key are unconstrained.
 */
async function bootstrapCommandTables(db: TestDB): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE mdm_command_status AS ENUM (
        'pending', 'sent', 'acknowledged', 'completed', 'failed', 'cancelled', 'expired'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  // The enum may predate the 'expired' value if the database was bootstrapped
  // by an older revision of this harness.
  await db.execute(sql`
    ALTER TYPE mdm_command_status ADD VALUE IF NOT EXISTS 'expired'
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mdm_devices (
      id VARCHAR(36) PRIMARY KEY,
      enrollment_id VARCHAR(100) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      model VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mdm_commands (
      id VARCHAR(36) PRIMARY KEY,
      device_id VARCHAR(36) NOT NULL REFERENCES mdm_devices(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      payload JSON,
      status mdm_command_status NOT NULL DEFAULT 'pending',
      result JSON,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      acknowledged_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      idempotency_key VARCHAR(255),
      expires_at TIMESTAMPTZ,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_attempt_at TIMESTAMPTZ
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mdm_commands_device_idempotency_key_idx
      ON mdm_commands (device_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mdm_commands_retry_idx
      ON mdm_commands (status, last_attempt_at)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mdm_commands_expires_at_idx
      ON mdm_commands (expires_at)
  `);
}

/**
 * Wipe devices (and, by cascade, commands) between tests.
 */
export async function resetDevicesAndCommands(db: TestDB): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE mdm_devices CASCADE`);
}
