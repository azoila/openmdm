import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzleAdapter } from '../../../packages/adapters/drizzle/src/index';
import {
  mdmCommands,
  mdmDevices,
  mdmEnrollmentChallenges,
  mdmPluginStorage,
} from '../../../packages/adapters/drizzle/src/postgres';
import type { DatabaseAdapter } from '../../../packages/core/src/types';
import { connect, resetDevicesAndCommands, type TestDB } from '../src/db';

/**
 * E2E tests for command delivery durability against a real Postgres.
 *
 * The properties that matter here cannot be proven with an in-memory fake:
 *
 * - **Atomic idempotent insert.** Two concurrent `sendCommand` calls carrying
 *   the same idempotency key must produce exactly one row. An in-memory fake
 *   "proves" this only because JS is single-threaded; the real guarantee comes
 *   from `INSERT ... ON CONFLICT DO NOTHING` against the partial unique index.
 *
 * - **The retry sweep's backoff arithmetic**, which is computed in SQL
 *   (`make_interval` + `power`), not in TypeScript.
 *
 * - **`transaction()` actually rolling back.** The adapter used to open a
 *   transaction and then run the callback against the *outer* connection, so
 *   nothing inside it was transactional and a partial failure left half-written
 *   state committed. That bug is invisible to a fake.
 */

describe('command durability (e2e, real Postgres)', () => {
  let db: TestDB;
  let close: () => Promise<void>;
  let adapter: DatabaseAdapter;

  beforeAll(async () => {
    const connection = await connect();
    db = connection.db;
    close = connection.close;

    adapter = drizzleAdapter(db as never, {
      tables: {
        devices: mdmDevices,
        commands: mdmCommands,
        // Unused by these tests; any valid table reference satisfies the shape.
        policies: mdmPluginStorage as never,
        applications: mdmPluginStorage as never,
        events: mdmPluginStorage as never,
        groups: mdmPluginStorage as never,
        deviceGroups: mdmPluginStorage as never,
        pushTokens: mdmPluginStorage as never,
        enrollmentChallenges: mdmEnrollmentChallenges,
      },
    });
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDevicesAndCommands(db);
    await db.execute(sql`
      INSERT INTO mdm_devices (id, enrollment_id, status, model)
      VALUES ('device-1', 'enroll-1', 'enrolled', 'Pixel 8')
    `);
  });

  async function countCommands(): Promise<number> {
    const rows = (await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM mdm_commands`,
    )) as unknown as Array<{ count: number }>;
    return rows[0].count;
  }

  describe('atomic idempotent insert', () => {
    it('inserts once and reports created=true', async () => {
      const result = await adapter.createCommandIdempotent!({
        deviceId: 'device-1',
        type: 'wipe',
        idempotencyKey: 'key-1',
      });

      expect(result.created).toBe(true);
      expect(result.command.idempotencyKey).toBe('key-1');
      expect(await countCommands()).toBe(1);
    });

    it('returns the existing command on a repeat, without inserting', async () => {
      const first = await adapter.createCommandIdempotent!({
        deviceId: 'device-1',
        type: 'wipe',
        idempotencyKey: 'key-1',
      });
      const second = await adapter.createCommandIdempotent!({
        deviceId: 'device-1',
        type: 'wipe',
        idempotencyKey: 'key-1',
      });

      expect(second.created).toBe(false);
      expect(second.command.id).toBe(first.command.id);
      expect(await countCommands()).toBe(1);
    });

    it('yields exactly one row under concurrent inserts of the same key', async () => {
      // The real test: 8 senders race for the same key. Exactly one may win.
      const attempts = Array.from({ length: 8 }, () =>
        adapter.createCommandIdempotent!({
          deviceId: 'device-1',
          type: 'factoryReset',
          idempotencyKey: 'concurrent-key',
        }),
      );

      const results = await Promise.all(attempts);

      const created = results.filter((r) => r.created);
      expect(created).toHaveLength(1);

      // Every caller — winner and losers alike — sees the same command.
      const ids = new Set(results.map((r) => r.command.id));
      expect(ids.size).toBe(1);

      expect(await countCommands()).toBe(1);
    });

    it('does not constrain commands sent without a key', async () => {
      await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });
      await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });

      // The unique index is partial — NULL keys don't collide.
      expect(await countCommands()).toBe(2);
    });
  });

  describe('expiry reaper', () => {
    it('expires undelivered commands past their expiresAt', async () => {
      const past = new Date(Date.now() - 60_000);
      await adapter.createCommand({
        deviceId: 'device-1',
        type: 'factoryReset',
        expiresAt: past,
      });

      const reaped = await adapter.expireCommands!(new Date());

      expect(reaped).toBe(1);
      const command = (await adapter.listCommands({ deviceId: 'device-1' }))[0];
      expect(command.status).toBe('expired');
    });

    it('leaves commands with a future expiry alone', async () => {
      await adapter.createCommand({
        deviceId: 'device-1',
        type: 'sync',
        expiresAt: new Date(Date.now() + 60_000),
      });

      expect(await adapter.expireCommands!(new Date())).toBe(0);
    });

    it('does not touch terminal commands', async () => {
      const command = await adapter.createCommand({
        deviceId: 'device-1',
        type: 'sync',
        expiresAt: new Date(Date.now() - 60_000),
      });
      await adapter.updateCommand(command.id, { status: 'completed' });

      expect(await adapter.expireCommands!(new Date())).toBe(0);

      const after = await adapter.findCommand(command.id);
      expect(after?.status).toBe('completed');
    });
  });

  describe('retry sweep', () => {
    it('returns a never-attempted pending command immediately', async () => {
      await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });

      const retryable = await adapter.listRetryableCommands!({
        now: new Date(),
        backoffSeconds: 60,
        limit: 10,
      });

      expect(retryable).toHaveLength(1);
    });

    it('withholds a command still inside its backoff window', async () => {
      const command = await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });
      // One attempt just now → must wait backoffSeconds * 2^0 = 60s.
      await adapter.updateCommand(command.id, { attemptCount: 1 });

      const retryable = await adapter.listRetryableCommands!({
        now: new Date(),
        backoffSeconds: 60,
        limit: 10,
      });

      expect(retryable).toHaveLength(0);
    });

    it('returns the command once its backoff has elapsed', async () => {
      const command = await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });
      await adapter.updateCommand(command.id, { attemptCount: 1 });

      // 61s in the future clears a 60s window.
      const retryable = await adapter.listRetryableCommands!({
        now: new Date(Date.now() + 61_000),
        backoffSeconds: 60,
        limit: 10,
      });

      expect(retryable).toHaveLength(1);
    });

    it('backs off exponentially — attempt 3 waits 4x the base', async () => {
      const command = await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });
      await adapter.updateCommand(command.id, { attemptCount: 3 });

      // Wait = 10 * 2^(3-1) = 40s. At +30s it is still too early...
      const tooEarly = await adapter.listRetryableCommands!({
        now: new Date(Date.now() + 30_000),
        backoffSeconds: 10,
        limit: 10,
      });
      expect(tooEarly).toHaveLength(0);

      // ...and at +41s it is due.
      const due = await adapter.listRetryableCommands!({
        now: new Date(Date.now() + 41_000),
        backoffSeconds: 10,
        limit: 10,
      });
      expect(due).toHaveLength(1);
    });

    it('excludes commands that exhausted their attempts', async () => {
      const command = await adapter.createCommand({
        deviceId: 'device-1',
        type: 'sync',
        maxAttempts: 2,
      });
      await adapter.updateCommand(command.id, { attemptCount: 2 });

      const retryable = await adapter.listRetryableCommands!({
        now: new Date(Date.now() + 3_600_000),
        backoffSeconds: 1,
        limit: 10,
      });

      expect(retryable).toHaveLength(0);
    });

    it('excludes expired commands', async () => {
      await adapter.createCommand({
        deviceId: 'device-1',
        type: 'factoryReset',
        expiresAt: new Date(Date.now() - 1000),
      });

      const retryable = await adapter.listRetryableCommands!({
        now: new Date(),
        backoffSeconds: 0,
        limit: 10,
      });

      expect(retryable).toHaveLength(0);
    });

    it('excludes commands that are no longer pending', async () => {
      const command = await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });
      await adapter.updateCommand(command.id, { status: 'sent' });

      const retryable = await adapter.listRetryableCommands!({
        now: new Date(),
        backoffSeconds: 0,
        limit: 10,
      });

      expect(retryable).toHaveLength(0);
    });
  });

  describe('acknowledged-command watchdog', () => {
    /** Insert a command already acknowledged `secondsAgo` seconds in the past. */
    async function seedAcked(secondsAgo: number, overrides = '') {
      const command = await adapter.createCommand({ deviceId: 'device-1', type: 'installApp' });
      await db.execute(sql`
        UPDATE mdm_commands
        SET status = 'acknowledged',
            acknowledged_at = NOW() - make_interval(secs => ${secondsAgo})
            ${sql.raw(overrides)}
        WHERE id = ${command.id}
      `);
      return command;
    }

    it('finds a command acked longer ago than the timeout', async () => {
      await seedAcked(120);

      const stuck = await adapter.listStuckAcknowledgedCommands!({
        now: new Date(),
        ackTimeoutSeconds: 60,
        limit: 10,
      });

      expect(stuck).toHaveLength(1);
    });

    it('leaves a freshly-acked command alone', async () => {
      await seedAcked(5);

      const stuck = await adapter.listStuckAcknowledgedCommands!({
        now: new Date(),
        ackTimeoutSeconds: 60,
        limit: 10,
      });

      expect(stuck).toHaveLength(0);
    });

    it('ignores commands that are not acknowledged', async () => {
      await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });

      const stuck = await adapter.listStuckAcknowledgedCommands!({
        now: new Date(),
        ackTimeoutSeconds: 0,
        limit: 10,
      });

      expect(stuck).toHaveLength(0);
    });

    it('ignores expired commands — those belong to the reaper', async () => {
      await seedAcked(120, ", expires_at = NOW() - INTERVAL '1 minute'");

      const stuck = await adapter.listStuckAcknowledgedCommands!({
        now: new Date(),
        ackTimeoutSeconds: 60,
        limit: 10,
      });

      expect(stuck).toHaveLength(0);
    });
  });

  describe('transaction()', () => {
    it('commits work done through adapter methods inside the callback', async () => {
      await adapter.transaction!(async () => {
        await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });
        await adapter.createCommand({ deviceId: 'device-1', type: 'reboot' });
      });

      expect(await countCommands()).toBe(2);
    });

    it('rolls back every write in the callback when it throws', async () => {
      // The regression this guards: transaction() used to run the callback
      // against the outer connection, so the first insert committed even
      // though the transaction "rolled back" — leaving a half-applied state.
      await expect(
        adapter.transaction!(async () => {
          await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(await countCommands()).toBe(0);
    });

    it('rolls back a partially-applied multi-write operation', async () => {
      await expect(
        adapter.transaction!(async () => {
          await adapter.createCommand({ deviceId: 'device-1', type: 'sync' });
          await adapter.createCommand({ deviceId: 'device-1', type: 'reboot' });
          await adapter.createCommand({ deviceId: 'nonexistent-device', type: 'wipe' });
        }),
      ).rejects.toThrow();

      // All three, including the two that individually succeeded, are gone.
      expect(await countCommands()).toBe(0);
    });
  });
});
