import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzleAdapter } from '../../../packages/adapters/drizzle/src/index';
import {
  mdmCommands,
  mdmDevices,
  mdmEnrollmentChallenges,
  mdmPluginStorage,
  mdmPolicies,
  mdmPolicyVersions,
} from '../../../packages/adapters/drizzle/src/postgres';
import { createMDM, createSilentLogger } from '../../../packages/core/src/index';
import { connect, resetDevicesAndCommands, resetPolicies, type TestDB } from '../src/db';

/**
 * Policy versioning, history, and rollback against a real Postgres.
 *
 * Two properties here are database properties, not application ones:
 *
 * - **Version history is append-only and unique per (policy, version).** The
 *   unique index is what makes a duplicate snapshot a hard error rather than a
 *   silently-tolerated race, and only a real database enforces it.
 * - **Rollback rolls forward.** The restored settings land as a *new* version.
 *   Rewinding the counter would make the rollback invisible to a device that
 *   had already applied the version being restored.
 */

describe('policy versioning (e2e, real Postgres)', () => {
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
        policies: mdmPolicies,
        policyVersions: mdmPolicyVersions,
        commands: mdmCommands,
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
      enrollment: { deviceSecret: 'policy-e2e', autoEnroll: true },
    });
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDevicesAndCommands(db);
    await resetPolicies(db);
  });

  const KIOSK = { kioskMode: true, mainApp: 'com.example.kiosk' } as never;
  const RELAXED = { kioskMode: false } as never;

  it('persists version to the column', async () => {
    const policy = await mdm.policies.create({ name: 'Kiosk', settings: KIOSK });

    const rows = (await db.execute(
      sql`SELECT version FROM mdm_policies WHERE id = ${policy.id}`,
    )) as unknown as Array<{ version: number }>;

    expect(rows[0].version).toBe(1);
  });

  it('writes a snapshot row per version', async () => {
    const policy = await mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    await mdm.policies.update(policy.id, { settings: RELAXED });

    const rows = (await db.execute(
      sql`SELECT version FROM mdm_policy_versions WHERE policy_id = ${policy.id} ORDER BY version`,
    )) as unknown as Array<{ version: number }>;

    expect(rows.map((r) => r.version)).toEqual([1, 2]);
  });

  it('history returns snapshots newest-first with their original settings', async () => {
    const policy = await mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    await mdm.policies.update(policy.id, { settings: RELAXED });

    const history = await mdm.policies.history(policy.id);

    expect(history).toHaveLength(2);
    expect(history[0]!.version).toBe(2);
    expect(history[0]!.settings).toMatchObject({ kioskMode: false });
    expect(history[1]!.settings).toMatchObject({ kioskMode: true });
  });

  it('rejects a duplicate snapshot at the database level', async () => {
    const policy = await mdm.policies.create({ name: 'Kiosk', settings: KIOSK });

    // The unique index on (policy_id, version) is the guarantee; this asserts it
    // is really there rather than assumed.
    await expect(
      db.execute(sql`
        INSERT INTO mdm_policy_versions (id, policy_id, version, settings)
        VALUES ('dupe', ${policy.id}, 1, '{}'::json)
      `),
    ).rejects.toThrow();
  });

  it('rolls forward on rollback — the restored settings become a new version', async () => {
    const policy = await mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    await mdm.policies.update(policy.id, { settings: RELAXED }); // v2

    const rolled = await mdm.policies.rollback(policy.id, 1);

    expect(rolled.version).toBe(3);
    expect(rolled.settings).toMatchObject({ kioskMode: true });

    const rows = (await db.execute(
      sql`SELECT version FROM mdm_policy_versions WHERE policy_id = ${policy.id} ORDER BY version`,
    )) as unknown as Array<{ version: number }>;
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
  });

  it('tracks compliance across the fleet', async () => {
    const policy = await mdm.policies.create({ name: 'Kiosk', settings: KIOSK });

    const applied = await mdm.devices.create({ enrollmentId: 'a', policyId: policy.id });
    const lagging = await mdm.devices.create({ enrollmentId: 'b', policyId: policy.id });
    await mdm.devices.create({ enrollmentId: 'c', policyId: policy.id });

    const beat = (deviceId: string, policyVersion: number) =>
      mdm.processHeartbeat(deviceId, {
        deviceId,
        timestamp: new Date(),
        policyVersion: String(policyVersion),
      } as never);

    await beat(applied.id, 1);
    await beat(lagging.id, 1);

    await mdm.policies.update(policy.id, { settings: RELAXED }); // v2
    await beat(applied.id, 2);

    const compliance = await mdm.policies.getCompliance(policy.id);

    expect(compliance).toMatchObject({
      version: 2,
      total: 3,
      compliant: 1,
      pending: 1,
      unknown: 1,
    });
    expect(compliance.laggingDeviceIds).toContain(lagging.id);
  });

  it('persists the applied policy version reported on heartbeat', async () => {
    const policy = await mdm.policies.create({ name: 'Kiosk', settings: KIOSK });
    const device = await mdm.devices.create({ enrollmentId: 'd', policyId: policy.id });

    await mdm.processHeartbeat(device.id, {
      deviceId: device.id,
      timestamp: new Date(),
      policyVersion: '1',
    } as never);

    const rows = (await db.execute(
      sql`SELECT applied_policy_version FROM mdm_devices WHERE id = ${device.id}`,
    )) as unknown as Array<{ applied_policy_version: number }>;

    expect(rows[0].applied_policy_version).toBe(1);

    const compliance = await mdm.devices.getPolicyCompliance(device.id);
    expect(compliance.status).toBe('compliant');
  });
});
