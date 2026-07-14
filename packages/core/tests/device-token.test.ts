/**
 * Device-token lifecycle: issuance, verification, renewal grace, and the
 * revocation semantics that renewal implies.
 *
 * Before this landed, tokens were issued once at enrollment with a 365-day
 * default lifetime and there was no way to rotate them — consumers forked
 * the JWT crypto to renew tokens themselves. `issueDeviceToken` makes
 * renewal a first-class operation, and refusing to renew for unenrolled or
 * blocked devices is what makes unenrolling an effective revocation.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createMDM, createSilentLogger, type MDMInstance } from '../src/index';

const DEVICE_SECRET = 'token-test-secret';

function createMemoryAdapter() {
  const devices = new Map<string, any>();
  let counter = 0;

  return {
    devices,
    async findDevice(id: string) {
      return devices.get(id) || null;
    },
    async findDeviceByEnrollmentId() {
      return null;
    },
    async listDevices() {
      const all = Array.from(devices.values());
      return { devices: all, total: all.length, limit: all.length, offset: 0 };
    },
    async createDevice(data: any) {
      const device = {
        id: `device-${++counter}`,
        status: 'enrolled',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      devices.set(device.id, device);
      return device;
    },
    async updateDevice(id: string, data: any) {
      const device = devices.get(id);
      const updated = { ...device, ...data, updatedAt: new Date() };
      devices.set(id, updated);
      return updated;
    },
    async deleteDevice(id: string) {
      devices.delete(id);
    },
    async countDevices() {
      return devices.size;
    },
    async findPolicy() {
      return null;
    },
    async findDefaultPolicy() {
      return null;
    },
    async listPolicies() {
      return [];
    },
    async createPolicy(d: any) {
      return d;
    },
    async updatePolicy(_id: string, d: any) {
      return d;
    },
    async deletePolicy() {},
    async findApplication() {
      return null;
    },
    async findApplicationByPackage() {
      return null;
    },
    async listApplications() {
      return [];
    },
    async createApplication(d: any) {
      return d;
    },
    async updateApplication(_id: string, d: any) {
      return d;
    },
    async deleteApplication() {},
    async findCommand() {
      return null;
    },
    async listCommands() {
      return [];
    },
    async createCommand(d: any) {
      return { id: 'cmd-1', status: 'pending', ...d, createdAt: new Date() };
    },
    async updateCommand(_id: string, d: any) {
      return d;
    },
    async getPendingCommands() {
      return [];
    },
    async createEvent(d: any) {
      return { id: `event-${++counter}`, ...d, createdAt: new Date() };
    },
    async listEvents() {
      return [];
    },
    async findGroup() {
      return null;
    },
    async listGroups() {
      return [];
    },
    async createGroup(d: any) {
      return d;
    },
    async updateGroup(_id: string, d: any) {
      return d;
    },
    async deleteGroup() {},
    async listDevicesInGroup() {
      return [];
    },
    async addDeviceToGroup() {},
    async removeDeviceFromGroup() {},
    async getDeviceGroups() {
      return [];
    },
    async findPushToken() {
      return null;
    },
    async upsertPushToken(d: any) {
      return d;
    },
    async deletePushToken() {},
  };
}

function buildMDM(authOverrides: Record<string, unknown> = {}): {
  mdm: MDMInstance;
  db: ReturnType<typeof createMemoryAdapter>;
} {
  const db = createMemoryAdapter();
  const mdm = createMDM({
    database: db as any,
    logger: createSilentLogger(),
    enrollment: { deviceSecret: DEVICE_SECRET, autoEnroll: true },
    auth: {
      getUser: async () => null,
      deviceTokenSecret: 'token-signing-secret',
      ...authOverrides,
    },
  });
  return { mdm, db };
}

describe('issueDeviceToken', () => {
  let mdm: MDMInstance;
  let db: ReturnType<typeof createMemoryAdapter>;

  beforeEach(() => {
    ({ mdm, db } = buildMDM());
  });

  it('issues a verifiable token for an enrolled device', async () => {
    const device = await db.createDevice({ model: 'Pixel', status: 'enrolled' });

    const { token, expiresAt } = await mdm.issueDeviceToken(device.id);

    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(mdm.verifyDeviceToken(token)).resolves.toEqual({ deviceId: device.id });
  });

  it('issues for a pending device (approval flow has not completed yet)', async () => {
    const device = await db.createDevice({ model: 'Pixel', status: 'pending' });

    await expect(mdm.issueDeviceToken(device.id)).resolves.toMatchObject({
      token: expect.any(String),
    });
  });

  it('throws for an unknown device', async () => {
    await expect(mdm.issueDeviceToken('nope')).rejects.toThrow();
  });

  it('refuses to renew for an unenrolled device — this is the revocation point', async () => {
    const device = await db.createDevice({ model: 'Pixel', status: 'enrolled' });
    await db.updateDevice(device.id, { status: 'unenrolled' });

    await expect(mdm.issueDeviceToken(device.id)).rejects.toThrow(/unenrolled/);
  });

  it('refuses to renew for a blocked device', async () => {
    const device = await db.createDevice({ model: 'Pixel', status: 'enrolled' });
    await db.updateDevice(device.id, { status: 'blocked' });

    await expect(mdm.issueDeviceToken(device.id)).rejects.toThrow(/blocked/);
  });
});

describe('verifyDeviceToken', () => {
  it('rejects a token signed with a different secret', async () => {
    const { mdm: a, db } = buildMDM();
    const { mdm: b } = buildMDM({ deviceTokenSecret: 'a-completely-different-secret' });

    const device = await db.createDevice({ model: 'Pixel', status: 'enrolled' });
    const { token } = await a.issueDeviceToken(device.id);

    await expect(b.verifyDeviceToken(token)).resolves.toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const { mdm, db } = buildMDM();
    const device = await db.createDevice({ model: 'Pixel', status: 'enrolled' });
    const { token } = await mdm.issueDeviceToken(device.id);

    const [header, _payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'someone-else', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');

    await expect(mdm.verifyDeviceToken(`${header}.${forged}.${signature}`)).resolves.toBeNull();
  });

  it('rejects malformed tokens without throwing', async () => {
    const { mdm } = buildMDM();

    await expect(mdm.verifyDeviceToken('')).resolves.toBeNull();
    await expect(mdm.verifyDeviceToken('not-a-jwt')).resolves.toBeNull();
    await expect(mdm.verifyDeviceToken('a.b')).resolves.toBeNull();
    await expect(mdm.verifyDeviceToken('a.b.c.d')).resolves.toBeNull();
    // A signature of a different length must not throw in the constant-time
    // comparison — timingSafeEqual requires equal-length buffers.
    await expect(mdm.verifyDeviceToken('a.b.short')).resolves.toBeNull();
  });

  it('rejects an expired token by default', async () => {
    const { mdm, db } = buildMDM({ deviceTokenExpiration: 1 });
    const device = await db.createDevice({ model: 'Pixel', status: 'enrolled' });
    const { token } = await mdm.issueDeviceToken(device.id);

    await new Promise((resolve) => setTimeout(resolve, 2200));

    await expect(mdm.verifyDeviceToken(token)).resolves.toBeNull();
  });

  it('accepts a recently-expired token when a renewal grace is passed', async () => {
    const { mdm, db } = buildMDM({ deviceTokenExpiration: 1 });
    const device = await db.createDevice({ model: 'Pixel', status: 'enrolled' });
    const { token } = await mdm.issueDeviceToken(device.id);

    await new Promise((resolve) => setTimeout(resolve, 2200));

    // Regular verification still refuses it...
    await expect(mdm.verifyDeviceToken(token)).resolves.toBeNull();
    // ...but the renewal path accepts it within the grace window. This is
    // what stops an agent that slept past expiry from self-unenrolling.
    await expect(
      mdm.verifyDeviceToken(token, { ignoreExpirationWithinSeconds: 3600 }),
    ).resolves.toEqual({ deviceId: device.id });
  });

  it('still rejects a token expired beyond the grace window', async () => {
    const { mdm, db } = buildMDM({ deviceTokenExpiration: 1 });
    const device = await db.createDevice({ model: 'Pixel', status: 'enrolled' });
    const { token } = await mdm.issueDeviceToken(device.id);

    await new Promise((resolve) => setTimeout(resolve, 2200));

    await expect(
      mdm.verifyDeviceToken(token, { ignoreExpirationWithinSeconds: 0 }),
    ).resolves.toBeNull();
  });
});
