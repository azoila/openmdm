import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzleAdapter } from '../../../packages/adapters/drizzle/src/index';
import {
  mdmCommands,
  mdmDevices,
  mdmEnrollmentChallenges,
  mdmPluginStorage,
} from '../../../packages/adapters/drizzle/src/postgres';
import { createMDM, createSilentLogger } from '../../../packages/core/src/index';
import { connect, resetDevicesAndCommands, type TestDB } from '../src/db';

/**
 * Tenant isolation against a real Postgres.
 *
 * The in-memory tests prove core builds the right filter. They cannot prove the
 * filter reaches SQL — a fake that ignores `tenantId` and a fake that honours it
 * are indistinguishable unless you look at the query. That is the whole failure
 * mode multi-tenancy has to rule out, so it gets tested against the real thing:
 * two tenants' rows in one table, and a scoped instance that must never see
 * across the line.
 */

const ACME = 'acme';
const GLOBEX = 'globex';

describe('tenant isolation (e2e, real Postgres)', () => {
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
        commands: mdmCommands,
        policies: mdmPluginStorage as never,
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
      enrollment: { deviceSecret: 'tenant-e2e-secret', autoEnroll: true },
    });
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDevicesAndCommands(db);
  });

  async function seed() {
    const acme = await mdm
      .withContext({ tenantId: ACME })
      .devices.create({ enrollmentId: 'acme-1', model: 'Pixel' });
    const globex = await mdm
      .withContext({ tenantId: GLOBEX })
      .devices.create({ enrollmentId: 'globex-1', model: 'Galaxy' });
    return { acme, globex };
  }

  it('persists tenant_id to the column, not just in memory', async () => {
    const { acme } = await seed();

    const rows = (await db.execute(
      sql`SELECT tenant_id FROM mdm_devices WHERE id = ${acme.id}`,
    )) as unknown as Array<{ tenant_id: string }>;

    expect(rows[0].tenant_id).toBe(ACME);
  });

  it('list is filtered in SQL — a scoped caller sees only its own tenant', async () => {
    await seed();

    const acmeView = await mdm.withContext({ tenantId: ACME }).devices.list();
    const globexView = await mdm.withContext({ tenantId: GLOBEX }).devices.list();

    expect(acmeView.total).toBe(1);
    expect(acmeView.devices[0]!.enrollmentId).toBe('acme-1');

    expect(globexView.total).toBe(1);
    expect(globexView.devices[0]!.enrollmentId).toBe('globex-1');

    // ...while the raw table holds both. If the filter were being dropped on the
    // way to SQL, the assertions above would both see 2.
    const all = await mdm.devices.list();
    expect(all.total).toBe(2);
  });

  it('a cross-tenant get returns null, not the row', async () => {
    const { globex } = await seed();

    const seen = await mdm.withContext({ tenantId: ACME }).devices.get(globex.id);

    expect(seen).toBeNull();
  });

  it('a cross-tenant delete is refused and the row survives', async () => {
    const { globex } = await seed();

    await expect(mdm.withContext({ tenantId: ACME }).devices.delete(globex.id)).rejects.toThrow();

    const rows = (await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM mdm_devices WHERE id = ${globex.id}`,
    )) as unknown as Array<{ count: number }>;
    expect(rows[0].count).toBe(1);
  });

  it('commands inherit the tenant and stay scoped', async () => {
    const { acme, globex } = await seed();

    await mdm.withContext({ tenantId: ACME }).devices.sendCommand(acme.id, { type: 'sync' });
    await mdm.withContext({ tenantId: GLOBEX }).devices.sendCommand(globex.id, { type: 'reboot' });

    const acmeCommands = await mdm.withContext({ tenantId: ACME }).commands.list();
    const globexCommands = await mdm.withContext({ tenantId: GLOBEX }).commands.list();

    expect(acmeCommands).toHaveLength(1);
    expect(acmeCommands[0]!.type).toBe('sync');
    expect(acmeCommands[0]!.tenantId).toBe(ACME);

    expect(globexCommands).toHaveLength(1);
    expect(globexCommands[0]!.type).toBe('reboot');
  });

  it('refuses to command another tenant’s device', async () => {
    const { globex } = await seed();

    await expect(
      mdm.withContext({ tenantId: ACME }).devices.sendCommand(globex.id, { type: 'wipe' }),
    ).rejects.toThrow();

    const rows = (await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM mdm_commands`,
    )) as unknown as Array<{ count: number }>;
    expect(rows[0].count).toBe(0);
  });
});
