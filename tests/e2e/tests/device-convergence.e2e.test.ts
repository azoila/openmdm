import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzleAdapter } from '../../../packages/adapters/drizzle/src/index';
import {
  mdmCommands,
  mdmDeviceApps,
  mdmDevices,
  mdmEnrollmentChallenges,
  mdmPluginStorage,
  mdmPolicies,
  mdmPolicyVersions,
} from '../../../packages/adapters/drizzle/src/postgres';
import { createMDM, createSilentLogger } from '../../../packages/core/src/index';
import { connect, resetDevicesAndCommands, resetPolicies, type TestDB } from '../src/db';

/**
 * Desired state, canonical inventory, and update enforcement against real Postgres.
 *
 * The properties that matter here are database properties:
 *
 * - **Soft delete must filter in SQL.** An in-memory fake that forgets to apply
 *   `deleted_at IS NULL` and one that applies it look identical from the outside.
 * - **The reconcile query is SQL.** `observed != desired`, plus an exponential
 *   backoff computed with `make_interval` and `power` — none of that is
 *   TypeScript, so none of it is covered by a unit test.
 * - **The inventory upsert is `ON CONFLICT`,** which a Map cannot model.
 */

describe('device convergence (e2e, real Postgres)', () => {
  let db: TestDB;
  let close: () => Promise<void>;
  let mdm: ReturnType<typeof createMDM>;

  beforeAll(async () => {
    const connection = await connect();
    db = connection.db;
    close = connection.close;

    const adapter = drizzleAdapter(db as never, {
      tables: {
        devices: mdmDevices,
        deviceApps: mdmDeviceApps,
        commands: mdmCommands,
        policies: mdmPolicies,
        policyVersions: mdmPolicyVersions,
        applications: mdmPluginStorage as never,
        events: mdmPluginStorage as never,
        groups: mdmPluginStorage as never,
        deviceGroups: mdmPluginStorage as never,
        pushTokens: mdmPluginStorage as never,
        enrollmentChallenges: mdmEnrollmentChallenges,
      },
    });

    mdm = createMDM({
      database: adapter,
      logger: createSilentLogger(),
      enrollment: { deviceSecret: 'convergence-e2e', autoEnroll: true },
      updates: { retryBackoffSeconds: 60, maxAttempts: 3 },
    });
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDevicesAndCommands(db);
    await resetPolicies(db);
  });

  async function seedDevice(enrollmentId = 'd1') {
    return mdm.devices.create({ enrollmentId, model: 'Pixel' });
  }

  function beat(deviceId: string, data: Record<string, unknown>) {
    return mdm.processHeartbeat(deviceId, {
      deviceId,
      timestamp: new Date(),
      ...data,
    } as never);
  }

  describe('soft delete', () => {
    it('tombstones the row rather than erasing it', async () => {
      const device = await seedDevice();

      await mdm.devices.delete(device.id);

      // The row survives — a hard DELETE would have cascaded away the device's
      // entire command history along with it.
      const rows = (await db.execute(
        sql`SELECT status, deleted_at FROM mdm_devices WHERE id = ${device.id}`,
      )) as unknown as Array<{ status: string; deleted_at: Date }>;

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('unenrolled');
      expect(rows[0].deleted_at).toBeTruthy();
    });

    it('filters retired devices out of listings in SQL', async () => {
      await seedDevice('keep');
      const gone = await seedDevice('gone');
      await mdm.devices.delete(gone.id);

      const { total } = await mdm.devices.list();
      expect(total).toBe(1);

      // ...while the row is still there.
      const rows = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM mdm_devices`,
      )) as unknown as Array<{ count: number }>;
      expect(rows[0].count).toBe(2);
    });

    it('can list retired devices when explicitly asked', async () => {
      const gone = await seedDevice();
      await mdm.devices.delete(gone.id);

      const { total } = await mdm.devices.list({ includeDeleted: true });
      expect(total).toBe(1);
    });
  });

  describe('desired state', () => {
    it('persists to the jsonb column and bumps the version', async () => {
      const device = await seedDevice();

      await mdm.devices.setDesiredState(device.id, { maintenanceMode: true });

      const rows = (await db.execute(
        sql`SELECT desired_state, desired_state_version FROM mdm_devices WHERE id = ${device.id}`,
      )) as unknown as Array<{ desired_state: unknown; desired_state_version: number }>;

      expect(rows[0].desired_state).toEqual({ maintenanceMode: true });
      expect(rows[0].desired_state_version).toBe(1);
    });

    it('converges when the device reports the version', async () => {
      const device = await seedDevice();
      await mdm.devices.setDesiredState(device.id, { maintenanceMode: true });

      await beat(device.id, { desiredStateVersion: 1 });

      const convergence = await mdm.devices.getConvergence(device.id);
      expect(convergence.converged).toBe(true);
      expect(convergence.reportedStateVersion).toBe(1);
    });
  });

  describe('canonical inventory', () => {
    it('upserts what the device reports', async () => {
      const device = await seedDevice();

      await beat(device.id, {
        installedApps: [
          { packageName: 'com.player', version: '1.0.0', versionCode: 1 },
          { packageName: 'com.agent', version: '0.9.0', versionCode: 9 },
        ],
      });

      const apps = await mdm.devices.getApps(device.id);
      expect(apps).toHaveLength(2);

      // Re-reporting must update in place, not duplicate. The primary key on
      // (device_id, package_name) is what makes the ON CONFLICT upsert work.
      await beat(device.id, {
        installedApps: [{ packageName: 'com.player', version: '2.0.0', versionCode: 2 }],
      });

      const after = await mdm.devices.getApps(device.id);
      const player = after.find((app) => app.packageName === 'com.player');
      expect(player?.observedVersion).toBe('2.0.0');
      expect(after).toHaveLength(2);
    });

    it('makes "which devices run version X" a SQL query', async () => {
      const a = await seedDevice('a');
      const b = await seedDevice('b');

      await beat(a.id, { installedApps: [{ packageName: 'com.player', version: '1.0.0' }] });
      await beat(b.id, { installedApps: [{ packageName: 'com.player', version: '2.0.0' }] });

      // This is the whole point of promoting the inventory out of JSON: it used
      // to mean walking a JSON blob for every device in the fleet.
      const rows = (await db.execute(
        sql`SELECT device_id FROM mdm_device_apps
            WHERE package_name = 'com.player' AND observed_version = '1.0.0'`,
      )) as unknown as Array<{ device_id: string }>;

      expect(rows.map((row) => row.device_id)).toEqual([a.id]);
    });

    it('clears the observed version when an app is uninstalled', async () => {
      const device = await seedDevice();
      await beat(device.id, {
        installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
      });

      await beat(device.id, { installedApps: [] });

      const apps = await mdm.devices.getApps(device.id);
      // The row survives — it may still carry a *desired* version, which is how a
      // first install is expressed. Only the observation is cleared.
      expect(apps[0]?.observedVersion).toBeNull();
    });
  });

  describe('update reconcile (SQL)', () => {
    it('selects a device that is behind', async () => {
      const device = await seedDevice();
      await beat(device.id, {
        installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
      });
      await mdm.updates.setDesiredAppVersion({ packageName: 'com.player', version: '2.0.0' });

      const pending = await (
        mdm as never as {
          db: { listAppsNeedingUpdate: (o: unknown) => Promise<unknown[]> };
        }
      ).db.listAppsNeedingUpdate({ now: new Date(), backoffSeconds: 60, limit: 10 });

      expect(pending).toHaveLength(1);
    });

    it('selects a device that has never installed the app at all', async () => {
      const device = await seedDevice();
      await mdm.updates.setDesiredAppVersion({ packageName: 'com.player', version: '2.0.0' });

      const pending = await (
        mdm as never as {
          db: { listAppsNeedingUpdate: (o: unknown) => Promise<Array<{ deviceId: string }>> };
        }
      ).db.listAppsNeedingUpdate({ now: new Date(), backoffSeconds: 60, limit: 10 });

      // "Absent" must be selectable, or an app that was never installed can never
      // be installed through this path.
      expect(pending.map((p) => p.deviceId)).toEqual([device.id]);
    });

    it('does not select a converged device', async () => {
      const device = await seedDevice();
      await mdm.updates.setDesiredAppVersion({ packageName: 'com.player', version: '2.0.0' });
      await beat(device.id, {
        installedApps: [{ packageName: 'com.player', version: '2.0.0' }],
      });

      const pending = await (
        mdm as never as {
          db: { listAppsNeedingUpdate: (o: unknown) => Promise<unknown[]> };
        }
      ).db.listAppsNeedingUpdate({ now: new Date(), backoffSeconds: 60, limit: 10 });

      expect(pending).toHaveLength(0);
    });

    it('honours the exponential backoff computed in SQL', async () => {
      const device = await seedDevice();
      await beat(device.id, {
        installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
      });
      await mdm.updates.setDesiredAppVersion({ packageName: 'com.player', version: '2.0.0' });

      // Two attempts just now → must wait backoff * 2^(2-1) = 120s.
      await db.execute(sql`
        UPDATE mdm_device_apps
        SET update_attempts = 2, last_attempt_at = NOW()
        WHERE device_id = ${device.id}
      `);

      const dbApi = (
        mdm as never as {
          db: {
            listAppsNeedingUpdate: (o: {
              now: Date;
              backoffSeconds: number;
              limit: number;
            }) => Promise<unknown[]>;
          };
        }
      ).db;

      const tooEarly = await dbApi.listAppsNeedingUpdate({
        now: new Date(Date.now() + 60_000),
        backoffSeconds: 60,
        limit: 10,
      });
      expect(tooEarly).toHaveLength(0);

      const due = await dbApi.listAppsNeedingUpdate({
        now: new Date(Date.now() + 121_000),
        backoffSeconds: 60,
        limit: 10,
      });
      expect(due).toHaveLength(1);
    });

    it('escalates once and records when', async () => {
      const device = await seedDevice();
      await beat(device.id, {
        installedApps: [{ packageName: 'com.player', version: '1.0.0' }],
      });
      await mdm.updates.setDesiredAppVersion({ packageName: 'com.player', version: '2.0.0' });

      await db.execute(sql`
        UPDATE mdm_device_apps SET update_attempts = 5 WHERE device_id = ${device.id}
      `);

      await mdm.updates.reconcile();
      const escalated = await mdm.updates.listEscalated();
      expect(escalated).toHaveLength(1);

      const firstStamp = escalated[0].escalatedAt;

      // Re-stamping on every sweep would make "when did this device get stuck?"
      // unanswerable.
      await mdm.updates.reconcile();
      const again = await mdm.updates.listEscalated();
      expect(again[0].escalatedAt).toEqual(firstStamp);
    });
  });
});
