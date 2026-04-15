import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
// Import from source so the suite runs without a prior `pnpm build`.
// Every other test file in this repo does the same — it matches the
// monorepo's "tests live next to the source, not the dist" convention.
import { drizzleAdapter } from '../../../packages/adapters/drizzle/src/index';
import { mdmPluginStorage } from '../../../packages/adapters/drizzle/src/postgres';
import type { DatabaseAdapter } from '../../../packages/core/src/types';
import { connect, resetPluginStorage, type TestDB } from '../src/db';

/**
 * End-to-end tests for the plugin-storage surface against a real
 * Postgres from docker-compose.test.yml.
 *
 * These cover the exact code paths the kiosk plugin depends on:
 * get / set / delete / list / clear, with emphasis on the Postgres-
 * specific behaviors that unit tests with an in-memory fake cannot
 * validate:
 *
 *  - `onConflictDoUpdate` idempotency on `setPluginValue`
 *  - JSONB round-trip with nested Date strings
 *  - Prefix filter via SQL LIKE
 *  - Isolation between plugin namespaces
 *
 * A regression in any of these silently reintroduces the kiosk
 * lockout-loss class of bug that the parent PR exists to fix.
 */

// Type helper so TS knows the optional plugin-storage methods exist on
// the adapter returned from `drizzleAdapter` when the table is wired.
// The plugin-storage methods are only attached when `tables.pluginStorage`
// is passed, which is always true in this suite.
type AdapterWithPluginStorage = Required<
  Pick<
    DatabaseAdapter,
    | 'getPluginValue'
    | 'setPluginValue'
    | 'deletePluginValue'
    | 'listPluginKeys'
    | 'clearPluginData'
  >
>;

function assertHasPluginStorage(
  adapter: DatabaseAdapter,
): asserts adapter is DatabaseAdapter & AdapterWithPluginStorage {
  if (!adapter.getPluginValue || !adapter.setPluginValue) {
    throw new Error(
      'drizzleAdapter did not expose plugin-storage methods. Did you pass tables.pluginStorage?',
    );
  }
}

describe('drizzleAdapter plugin-storage (e2e, real Postgres)', () => {
  let db: TestDB;
  let close: () => Promise<void>;
  let adapter: DatabaseAdapter & AdapterWithPluginStorage;

  beforeAll(async () => {
    const connection = await connect();
    db = connection.db;
    close = connection.close;

    // Only wire the table the plugin-storage path actually touches.
    // Drizzle adapter's tables option is permissive about missing
    // entries for paths this test does not exercise, so we stub them
    // with the plugin-storage table to satisfy the type and avoid
    // loading the rest of the schema.
    const adapterUntyped = drizzleAdapter(db as never, {
      tables: {
        devices: mdmPluginStorage as never,
        policies: mdmPluginStorage as never,
        applications: mdmPluginStorage as never,
        commands: mdmPluginStorage as never,
        events: mdmPluginStorage as never,
        groups: mdmPluginStorage as never,
        deviceGroups: mdmPluginStorage as never,
        pushTokens: mdmPluginStorage as never,
        pluginStorage: mdmPluginStorage,
      },
    });
    assertHasPluginStorage(adapterUntyped);
    adapter = adapterUntyped;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetPluginStorage(db);
  });

  it('setPluginValue writes and getPluginValue reads the value back', async () => {
    await adapter.setPluginValue('kiosk', 'device-1', {
      enabled: true,
      mainApp: 'com.example.pos',
      exitAttempts: 0,
    });

    const value = await adapter.getPluginValue('kiosk', 'device-1');
    expect(value).toEqual({
      enabled: true,
      mainApp: 'com.example.pos',
      exitAttempts: 0,
    });
  });

  it('returns null for a missing key', async () => {
    expect(await adapter.getPluginValue('kiosk', 'never-written')).toBeNull();
  });

  it('setPluginValue is idempotent on conflict — last write wins', async () => {
    await adapter.setPluginValue('kiosk', 'device-1', { exitAttempts: 1 });
    await adapter.setPluginValue('kiosk', 'device-1', { exitAttempts: 2 });
    await adapter.setPluginValue('kiosk', 'device-1', { exitAttempts: 3 });

    const value = await adapter.getPluginValue('kiosk', 'device-1');
    expect(value).toEqual({ exitAttempts: 3 });
  });

  it('JSONB round-trips Date fields as ISO strings', async () => {
    // The kiosk plugin explicitly rehydrates Date fields after a read
    // because Postgres JSONB serializes them as strings. This test
    // locks that behavior in — if Drizzle ever changes JSONB handling
    // and starts returning real Date objects, the kiosk rehydrate()
    // path silently doubles up and we want to know.
    const now = new Date('2026-04-15T12:00:00.000Z');
    await adapter.setPluginValue('kiosk', 'device-1', {
      lockedSince: now,
      lockoutUntil: now,
    });

    const value = (await adapter.getPluginValue('kiosk', 'device-1')) as {
      lockedSince: string;
      lockoutUntil: string;
    };

    expect(typeof value.lockedSince).toBe('string');
    expect(value.lockedSince).toBe('2026-04-15T12:00:00.000Z');
    expect(value.lockoutUntil).toBe('2026-04-15T12:00:00.000Z');
  });

  it('deletePluginValue removes the key', async () => {
    await adapter.setPluginValue('kiosk', 'device-1', { enabled: true });
    await adapter.deletePluginValue('kiosk', 'device-1');
    expect(await adapter.getPluginValue('kiosk', 'device-1')).toBeNull();
  });

  it('deletePluginValue on a missing key is a no-op', async () => {
    await expect(
      adapter.deletePluginValue('kiosk', 'never-existed'),
    ).resolves.not.toThrow();
  });

  it('listPluginKeys returns every key under a plugin namespace', async () => {
    await adapter.setPluginValue('kiosk', 'device-1', {});
    await adapter.setPluginValue('kiosk', 'device-2', {});
    await adapter.setPluginValue('kiosk', 'device-10', {});

    const keys = (await adapter.listPluginKeys('kiosk')).sort();
    expect(keys).toEqual(['device-1', 'device-10', 'device-2']);
  });

  it('listPluginKeys filters by prefix', async () => {
    await adapter.setPluginValue('kiosk', 'device-1', {});
    await adapter.setPluginValue('kiosk', 'device-2', {});
    await adapter.setPluginValue('kiosk', 'other-key', {});

    const keys = (await adapter.listPluginKeys('kiosk', 'device-')).sort();
    expect(keys).toEqual(['device-1', 'device-2']);
    expect(keys).not.toContain('other-key');
  });

  it('namespaces are isolated — kiosk writes do not leak into geofence', async () => {
    await adapter.setPluginValue('kiosk', 'device-1', { source: 'kiosk' });
    await adapter.setPluginValue('geofence', 'device-1', { source: 'geofence' });

    expect(await adapter.getPluginValue('kiosk', 'device-1')).toEqual({
      source: 'kiosk',
    });
    expect(await adapter.getPluginValue('geofence', 'device-1')).toEqual({
      source: 'geofence',
    });

    const kioskKeys = await adapter.listPluginKeys('kiosk');
    expect(kioskKeys).toEqual(['device-1']);
    expect(kioskKeys).toHaveLength(1);
  });

  it('clearPluginData removes every key in one namespace without touching others', async () => {
    await adapter.setPluginValue('kiosk', 'device-1', { a: 1 });
    await adapter.setPluginValue('kiosk', 'device-2', { a: 2 });
    await adapter.setPluginValue('geofence', 'device-1', { b: 1 });

    await adapter.clearPluginData('kiosk');

    expect(await adapter.listPluginKeys('kiosk')).toEqual([]);
    expect(await adapter.getPluginValue('geofence', 'device-1')).toEqual({
      b: 1,
    });
  });

  it('updated_at is refreshed on conflict update', async () => {
    // This guards against a subtle bug where onConflictDoUpdate would
    // leave updated_at stale, which would break any query that sorts
    // or filters by recency. We verify by reading the underlying
    // timestamp directly — not through the DatabaseAdapter interface,
    // because the interface intentionally hides these columns.
    await adapter.setPluginValue('kiosk', 'device-1', { exitAttempts: 1 });
    const [first] = await db.select().from(mdmPluginStorage);
    const firstUpdatedAt = new Date(first.updatedAt as unknown as string);

    // Wait 10ms so the timestamp can actually differ at ms resolution.
    await new Promise((r) => setTimeout(r, 10));

    await adapter.setPluginValue('kiosk', 'device-1', { exitAttempts: 2 });
    const [second] = await db.select().from(mdmPluginStorage);
    const secondUpdatedAt = new Date(second.updatedAt as unknown as string);

    expect(secondUpdatedAt.getTime()).toBeGreaterThan(firstUpdatedAt.getTime());
  });
});
