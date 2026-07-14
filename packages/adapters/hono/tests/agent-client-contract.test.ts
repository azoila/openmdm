/**
 * Client ↔ server wire-contract tests.
 *
 * Drives the real `@openmdm/client` against the real `honoAdapter` mounted
 * on a real `createMDM` instance backed by an in-memory database adapter.
 * No mocks on either side of the HTTP boundary — the client's fetch is
 * wired straight into `app.request`.
 *
 * This suite exists because the client SDK and the adapter have diverged
 * before: the client called `/agent/refresh-token`, `/agent/commands/pending`,
 * `/agent/events` and `DELETE /agent/push-token` while the adapter served
 * none of them. Every client method that talks to the server must have a
 * test here, so a route removal or path change on either side fails CI.
 */

import { createMDMClient } from '@openmdm/client';
import { createMDM, createSilentLogger, type MDMInstance } from '@openmdm/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { honoAdapter } from '../src/index';

const DEVICE_SECRET = 'contract-test-secret';

// ============================================
// In-memory DatabaseAdapter
// ============================================

function createMemoryAdapter() {
  const devices = new Map<string, any>();
  const policies = new Map<string, any>();
  const applications = new Map<string, any>();
  const commands = new Map<string, any>();
  const events = new Map<string, any>();
  const groups = new Map<string, any>();
  const deviceGroups: { deviceId: string; groupId: string }[] = [];
  const pushTokens = new Map<string, any>();

  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  return {
    // Devices
    async findDevice(id: string) {
      return devices.get(id) || null;
    },
    async findDeviceByEnrollmentId(enrollmentId: string) {
      for (const device of devices.values()) {
        if (device.enrollmentId === enrollmentId) return device;
      }
      return null;
    },
    async listDevices(filter?: any) {
      const all = Array.from(devices.values());
      const offset = filter?.offset ?? 0;
      const limit = filter?.limit ?? all.length;
      return {
        devices: all.slice(offset, offset + limit),
        total: all.length,
        limit,
        offset,
      };
    },
    async createDevice(data: any) {
      const device = {
        id: nextId('device'),
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
      if (!device) throw new Error(`Device ${id} not found`);
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

    // Policies
    async findPolicy(id: string) {
      return policies.get(id) || null;
    },
    async findDefaultPolicy() {
      for (const policy of policies.values()) {
        if (policy.isDefault) return policy;
      }
      return null;
    },
    async listPolicies() {
      return Array.from(policies.values());
    },
    async createPolicy(data: any) {
      const policy = {
        id: nextId('policy'),
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      policies.set(policy.id, policy);
      return policy;
    },
    async updatePolicy(id: string, data: any) {
      const policy = policies.get(id);
      if (!policy) throw new Error(`Policy ${id} not found`);
      const updated = { ...policy, ...data, updatedAt: new Date() };
      policies.set(id, updated);
      return updated;
    },
    async deletePolicy(id: string) {
      policies.delete(id);
    },

    // Applications
    async findApplication(id: string) {
      return applications.get(id) || null;
    },
    async findApplicationByPackage(packageName: string) {
      for (const app of applications.values()) {
        if (app.packageName === packageName) return app;
      }
      return null;
    },
    async listApplications() {
      return Array.from(applications.values());
    },
    async createApplication(data: any) {
      const app = { id: nextId('app'), ...data, createdAt: new Date(), updatedAt: new Date() };
      applications.set(app.id, app);
      return app;
    },
    async updateApplication(id: string, data: any) {
      const app = applications.get(id);
      if (!app) throw new Error(`Application ${id} not found`);
      const updated = { ...app, ...data, updatedAt: new Date() };
      applications.set(id, updated);
      return updated;
    },
    async deleteApplication(id: string) {
      applications.delete(id);
    },

    // Commands
    async findCommand(id: string) {
      return commands.get(id) || null;
    },
    async listCommands(filter?: any) {
      return Array.from(commands.values()).filter((c) => {
        if (filter?.deviceId && c.deviceId !== filter.deviceId) return false;
        if (filter?.status && c.status !== filter.status) return false;
        return true;
      });
    },
    async createCommand(data: any) {
      const command = { id: nextId('command'), status: 'pending', ...data, createdAt: new Date() };
      commands.set(command.id, command);
      return command;
    },
    async updateCommand(id: string, data: any) {
      const command = commands.get(id);
      if (!command) return null;
      const updated = { ...command, ...data };
      commands.set(id, updated);
      return updated;
    },
    async getPendingCommands(deviceId: string) {
      return Array.from(commands.values()).filter(
        (c) => c.deviceId === deviceId && (c.status === 'pending' || c.status === 'sent'),
      );
    },

    // Events
    async createEvent(data: any) {
      const event = { id: nextId('event'), ...data, createdAt: new Date() };
      events.set(event.id, event);
      return event;
    },
    async listEvents(filter?: any) {
      return Array.from(events.values()).filter(
        (e) => !filter?.deviceId || e.deviceId === filter.deviceId,
      );
    },

    // Groups
    async findGroup(id: string) {
      return groups.get(id) || null;
    },
    async listGroups() {
      return Array.from(groups.values());
    },
    async createGroup(data: any) {
      const group = { id: nextId('group'), ...data, createdAt: new Date(), updatedAt: new Date() };
      groups.set(group.id, group);
      return group;
    },
    async updateGroup(id: string, data: any) {
      const group = groups.get(id);
      if (!group) throw new Error(`Group ${id} not found`);
      const updated = { ...group, ...data, updatedAt: new Date() };
      groups.set(id, updated);
      return updated;
    },
    async deleteGroup(id: string) {
      groups.delete(id);
    },
    async listDevicesInGroup(groupId: string) {
      return deviceGroups
        .filter((dg) => dg.groupId === groupId)
        .map((dg) => devices.get(dg.deviceId))
        .filter(Boolean);
    },
    async addDeviceToGroup(deviceId: string, groupId: string) {
      deviceGroups.push({ deviceId, groupId });
    },
    async removeDeviceFromGroup(deviceId: string, groupId: string) {
      const idx = deviceGroups.findIndex(
        (dg) => dg.deviceId === deviceId && dg.groupId === groupId,
      );
      if (idx >= 0) deviceGroups.splice(idx, 1);
    },
    async getDeviceGroups(deviceId: string) {
      return deviceGroups
        .filter((dg) => dg.deviceId === deviceId)
        .map((dg) => groups.get(dg.groupId))
        .filter(Boolean);
    },

    // Push tokens
    async findPushToken(deviceId: string, provider: string) {
      return pushTokens.get(`${deviceId}:${provider}`) || null;
    },
    async upsertPushToken(data: any) {
      const token = { ...data, updatedAt: new Date() };
      pushTokens.set(`${data.deviceId}:${data.provider}`, token);
      return token;
    },
    async deletePushToken(deviceId: string, provider?: string) {
      for (const key of pushTokens.keys()) {
        if (key.startsWith(`${deviceId}:`) && (!provider || key === `${deviceId}:${provider}`)) {
          pushTokens.delete(key);
        }
      }
    },

    // Test hooks
    _pushTokens: pushTokens,
    _events: events,
  };
}

// ============================================
// Harness
// ============================================

function buildStack(config?: {
  deviceTokenExpiration?: number;
  deviceTokenRenewalGraceSeconds?: number;
  timestampToleranceSeconds?: number;
  rateLimit?: false | { windowSeconds?: number; max?: number };
}) {
  const db = createMemoryAdapter();

  const mdm = createMDM({
    database: db as any,
    logger: createSilentLogger(),
    enrollment: {
      deviceSecret: DEVICE_SECRET,
      autoEnroll: true,
      ...(config?.timestampToleranceSeconds !== undefined
        ? { timestampToleranceSeconds: config.timestampToleranceSeconds }
        : {}),
    },
    auth: {
      getUser: async () => null,
      deviceTokenSecret: 'contract-test-token-secret',
      ...(config?.deviceTokenExpiration !== undefined
        ? { deviceTokenExpiration: config.deviceTokenExpiration }
        : {}),
      ...(config?.deviceTokenRenewalGraceSeconds !== undefined
        ? { deviceTokenRenewalGraceSeconds: config.deviceTokenRenewalGraceSeconds }
        : {}),
    },
  });

  const app = honoAdapter(mdm, {
    // Admin auth is exercised elsewhere; this suite is about the agent
    // surface, so getUser returning null must not block agent routes.
    enableAuth: false,
    rateLimit: config?.rateLimit ?? false,
  });

  const client = createMDMClient({
    serverUrl: 'http://contract.test',
    deviceSecret: DEVICE_SECRET,
    // No network retries in tests — a failed request should fail fast.
    retry: { maxRetries: 0, retryDelay: 0 },
    fetch: ((input: any, init?: any) => app.request(input, init)) as typeof fetch,
  });

  return { db, mdm: mdm as MDMInstance, app, client };
}

function enrollmentRequest() {
  return {
    model: 'Pixel 8',
    manufacturer: 'Google',
    osVersion: '15',
    serialNumber: 'SN-CONTRACT-1',
    method: 'qr' as const,
  };
}

// ============================================
// Tests
// ============================================

describe('client ↔ server agent contract', () => {
  let stack: ReturnType<typeof buildStack>;

  beforeEach(() => {
    stack = buildStack();
  });

  it('enrolls via the HMAC path and receives a working token', async () => {
    const response = await stack.client.enroll(enrollmentRequest());

    expect(response.deviceId).toBeTruthy();
    expect(response.token).toBeTruthy();
    expect(stack.client.isEnrolled()).toBe(true);

    const device = await stack.mdm.devices.get(response.deviceId);
    expect(device?.status).toBe('enrolled');
  });

  it('sends heartbeats after enrollment', async () => {
    await stack.client.enroll(enrollmentRequest());

    const response = await stack.client.heartbeat({ batteryLevel: 80 });
    expect(response).toBeTruthy();
  });

  it('fetches device config', async () => {
    await stack.client.enroll(enrollmentRequest());

    const config = await stack.client.getConfig();
    expect(config.device.status).toBe('enrolled');
  });

  it('polls pending commands and drives the ack/complete lifecycle', async () => {
    const { deviceId } = await stack.client.enroll(enrollmentRequest());

    await stack.mdm.devices.sendCommand(deviceId, { type: 'sync' });

    const pending = await stack.client.getPendingCommands();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.type).toBe('sync');

    await stack.client.acknowledgeCommand(pending[0]!.id);
    await stack.client.completeCommand(pending[0]!.id, { success: true });

    const after = await stack.client.getPendingCommands();
    expect(after).toHaveLength(0);
  });

  it('reports agent events and persists them', async () => {
    const { deviceId } = await stack.client.enroll(enrollmentRequest());

    await stack.client.reportEvent('app.crashed', { packageName: 'com.example.app' });

    // The store also holds the `device.enrolled` event core emitted during
    // enrollment; select the agent-reported one.
    const stored = Array.from(stack.db._events.values()).filter(
      (e: any) => e.type === 'app.crashed',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].deviceId).toBe(deviceId);
    expect(stored[0].payload).toEqual({ packageName: 'com.example.app' });
  });

  it('rejects oversized event types', async () => {
    await stack.client.enroll(enrollmentRequest());

    await expect(stack.client.reportEvent('x'.repeat(101))).rejects.toThrow();
  });

  it('registers and unregisters push tokens', async () => {
    const { deviceId } = await stack.client.enroll(enrollmentRequest());

    await stack.client.registerPushToken('fcm', 'fcm-token-123');
    expect(stack.db._pushTokens.get(`${deviceId}:fcm`)?.token).toBe('fcm-token-123');

    await stack.client.unregisterPushToken('fcm');
    expect(stack.db._pushTokens.get(`${deviceId}:fcm`)).toBeUndefined();
  });

  it('proactively refreshes the device token', async () => {
    await stack.client.enroll(enrollmentRequest());
    const before = stack.client.state.token;

    // Token payloads carry second-granularity iat/exp; a fresh token within
    // the same second would be identical. Nudge the clock boundary.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await stack.client.refreshToken();

    const after = stack.client.state.token;
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);

    // The renewed token must authenticate follow-up requests.
    const pending = await stack.client.getPendingCommands();
    expect(pending).toEqual([]);
  });

  it('recovers from an expired token via the renewal grace window', async () => {
    const shortLived = buildStack({
      deviceTokenExpiration: 1,
      deviceTokenRenewalGraceSeconds: 3600,
    });

    await shortLived.client.enroll(enrollmentRequest());

    // Let the token expire.
    await new Promise((resolve) => setTimeout(resolve, 2200));

    // The request 401s, the client exchanges the expired token within the
    // grace window, and the retry succeeds — no self-unenroll.
    const pending = await shortLived.client.getPendingCommands();
    expect(pending).toEqual([]);
    expect(shortLived.client.isEnrolled()).toBe(true);
  });

  it('refuses token renewal for unenrolled devices', async () => {
    const { deviceId } = await stack.client.enroll(enrollmentRequest());

    await stack.mdm.devices.update(deviceId, { status: 'unenrolled' });

    await expect(stack.client.refreshToken()).rejects.toThrow();
  });
});

describe('enrollment hardening', () => {
  it('rejects enrollment requests with stale timestamps', async () => {
    const stack = buildStack({ timestampToleranceSeconds: 60 });

    // Freeze a stale timestamp into the signed request by monkey-patching
    // the clock the client reads. Simpler: enroll through raw fetch with a
    // stale-but-correctly-signed body is covered in core unit tests; here
    // we only need the HTTP surface to propagate the rejection.
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { generateEnrollmentSignature } = await import('@openmdm/client');
    const requestBody = enrollmentRequest();
    const signature = await generateEnrollmentSignature(
      requestBody as any,
      staleTimestamp,
      DEVICE_SECRET,
    );

    const res = await stack.app.request('http://contract.test/agent/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, timestamp: staleTimestamp, signature }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('rate limits the enrollment routes when enabled', async () => {
    const stack = buildStack({ rateLimit: { windowSeconds: 60, max: 2 } });

    const hit = () =>
      stack.app.request('http://contract.test/agent/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
        body: JSON.stringify({}),
      });

    const first = await hit();
    const second = await hit();
    const third = await hit();

    // The first two get through the limiter (and fail validation with 400,
    // which is fine — the limiter sits in front). The third is throttled.
    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);
    expect(third.status).toBe(429);
  });
});
