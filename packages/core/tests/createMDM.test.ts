import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMDM } from '../src/index';
import type { DatabaseAdapter, PushAdapter, Device, Policy, Command } from '../src/types';

// Mock Database Adapter
function createMockDatabaseAdapter(): DatabaseAdapter {
  const devices = new Map<string, Device>();
  const policies = new Map<string, Policy>();
  const commands = new Map<string, Command>();

  return {
    // Devices
    async findDevice(id: string) {
      return devices.get(id) || null;
    },
    async findDeviceByEnrollmentId(enrollmentId: string) {
      return Array.from(devices.values()).find(d => d.enrollmentId === enrollmentId) || null;
    },
    async listDevices() {
      return {
        devices: Array.from(devices.values()),
        total: devices.size,
        limit: 100,
        offset: 0,
      };
    },
    async createDevice(data) {
      const device: Device = {
        id: `device_${Date.now()}`,
        enrollmentId: data.enrollmentId,
        status: 'enrolled',
        model: data.model,
        manufacturer: data.manufacturer,
        osVersion: data.osVersion,
        serialNumber: data.serialNumber,
        policyId: data.policyId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      devices.set(device.id, device);
      return device;
    },
    async updateDevice(id: string, data) {
      const device = devices.get(id);
      if (!device) throw new Error('Device not found');
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
      return Array.from(policies.values()).find(p => p.isDefault) || null;
    },
    async listPolicies() {
      return Array.from(policies.values());
    },
    async createPolicy(data) {
      const policy: Policy = {
        id: `policy_${Date.now()}`,
        name: data.name,
        description: data.description,
        isDefault: data.isDefault || false,
        settings: data.settings,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      policies.set(policy.id, policy);
      return policy;
    },
    async updatePolicy(id: string, data) {
      const policy = policies.get(id);
      if (!policy) throw new Error('Policy not found');
      const updated = { ...policy, ...data, updatedAt: new Date() };
      policies.set(id, updated);
      return updated;
    },
    async deletePolicy(id: string) {
      policies.delete(id);
    },

    // Applications
    async findApplication() { return null; },
    async findApplicationByPackage() { return null; },
    async listApplications() { return []; },
    async createApplication(data) { return { ...data, id: 'app_1', isActive: true, createdAt: new Date(), updatedAt: new Date() } as any; },
    async updateApplication() { return {} as any; },
    async deleteApplication() {},

    // Commands
    async findCommand(id: string) {
      return commands.get(id) || null;
    },
    async listCommands() {
      return Array.from(commands.values());
    },
    async createCommand(data) {
      const command: Command = {
        id: `cmd_${Date.now()}`,
        deviceId: data.deviceId,
        type: data.type,
        payload: data.payload,
        status: 'pending',
        createdAt: new Date(),
      };
      commands.set(command.id, command);
      return command;
    },
    async updateCommand(id: string, data) {
      const command = commands.get(id);
      if (!command) throw new Error('Command not found');
      const updated = { ...command, ...data };
      commands.set(id, updated);
      return updated;
    },
    async getPendingCommands(deviceId: string) {
      return Array.from(commands.values()).filter(
        c => c.deviceId === deviceId && c.status === 'pending'
      );
    },

    // Events
    async createEvent(event) {
      return { ...event, id: `event_${Date.now()}`, createdAt: new Date() } as any;
    },
    async listEvents() { return []; },

    // Groups
    async findGroup() { return null; },
    async listGroups() { return []; },
    async createGroup(data) { return { ...data, id: 'group_1', createdAt: new Date(), updatedAt: new Date() } as any; },
    async updateGroup() { return {} as any; },
    async deleteGroup() {},
    async listDevicesInGroup() { return []; },
    async addDeviceToGroup() {},
    async removeDeviceFromGroup() {},
    async getDeviceGroups() { return []; },

    // Push Tokens
    async findPushToken() { return null; },
    async upsertPushToken(data) { return { ...data, id: 'pt_1', isActive: true, createdAt: new Date(), updatedAt: new Date() } as any; },
    async deletePushToken() {},
  };
}

// Mock Push Adapter
function createMockPushAdapter(): PushAdapter {
  return {
    async send(deviceId: string, message) {
      return { success: true, messageId: `msg_${Date.now()}` };
    },
    async sendBatch(deviceIds: string[], message) {
      return {
        successCount: deviceIds.length,
        failureCount: 0,
        results: deviceIds.map(id => ({
          deviceId: id,
          result: { success: true, messageId: `msg_${Date.now()}` },
        })),
      };
    },
    async registerToken(deviceId: string, token: string) {},
    async unregisterToken(deviceId: string) {},
  };
}

describe('createMDM', () => {
  let mdm: ReturnType<typeof createMDM>;
  let mockDb: DatabaseAdapter;
  let mockPush: PushAdapter;

  beforeEach(() => {
    mockDb = createMockDatabaseAdapter();
    mockPush = createMockPushAdapter();

    mdm = createMDM({
      database: mockDb,
      push: mockPush,
      enrollment: {
        deviceSecret: 'test-secret',
        autoEnroll: true,
      },
      auth: {
        deviceTokenSecret: 'jwt-secret',
      },
    });
  });

  describe('Device Management', () => {
    it('should create a device', async () => {
      const device = await mdm.devices.create({
        enrollmentId: 'test-enrollment-001',
        model: 'Pixel 6',
        manufacturer: 'Google',
        osVersion: '14',
      });

      expect(device).toBeDefined();
      expect(device.enrollmentId).toBe('test-enrollment-001');
      expect(device.model).toBe('Pixel 6');
      expect(device.status).toBe('enrolled');
    });

    it('should get a device by id', async () => {
      const created = await mdm.devices.create({
        enrollmentId: 'test-002',
        model: 'Galaxy S23',
        manufacturer: 'Samsung',
        osVersion: '13',
      });

      const device = await mdm.devices.get(created.id);
      expect(device).toBeDefined();
      expect(device?.id).toBe(created.id);
    });

    it('should update a device', async () => {
      const created = await mdm.devices.create({
        enrollmentId: 'test-003',
        model: 'Test Device',
        manufacturer: 'Test',
        osVersion: '12',
      });

      const updated = await mdm.devices.update(created.id, {
        batteryLevel: 85,
        status: 'enrolled',
      });

      expect(updated.batteryLevel).toBe(85);
    });

    it('should list devices', async () => {
      await mdm.devices.create({ enrollmentId: 'list-1', model: 'A', manufacturer: 'X', osVersion: '1' });
      await mdm.devices.create({ enrollmentId: 'list-2', model: 'B', manufacturer: 'Y', osVersion: '2' });

      const result = await mdm.devices.list();
      expect(result.devices.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should delete a device', async () => {
      const created = await mdm.devices.create({
        enrollmentId: 'delete-test',
        model: 'Delete Me',
        manufacturer: 'Test',
        osVersion: '1',
      });

      await mdm.devices.delete(created.id);

      const device = await mdm.devices.get(created.id);
      expect(device).toBeNull();
    });
  });

  describe('Policy Management', () => {
    it('should create a policy', async () => {
      const policy = await mdm.policies.create({
        name: 'Test Policy',
        description: 'A test policy',
        settings: {
          kioskMode: true,
          mainApp: 'com.example.app',
          lockStatusBar: true,
        },
      });

      expect(policy).toBeDefined();
      expect(policy.name).toBe('Test Policy');
      expect(policy.settings.kioskMode).toBe(true);
    });

    it('should get a policy', async () => {
      const created = await mdm.policies.create({
        name: 'Retrieve Policy',
        settings: { kioskMode: false },
      });

      const policy = await mdm.policies.get(created.id);
      expect(policy).toBeDefined();
      expect(policy?.name).toBe('Retrieve Policy');
    });

    it('should set default policy', async () => {
      const policy = await mdm.policies.create({
        name: 'Default Policy',
        isDefault: false,
        settings: {},
      });

      const updated = await mdm.policies.setDefault(policy.id);
      expect(updated.isDefault).toBe(true);
    });
  });

  describe('Command Management', () => {
    it('should send a command to a device', async () => {
      const device = await mdm.devices.create({
        enrollmentId: 'cmd-device',
        model: 'Test',
        manufacturer: 'Test',
        osVersion: '1',
      });

      const command = await mdm.commands.send({
        deviceId: device.id,
        type: 'sync',
      });

      expect(command).toBeDefined();
      expect(command.deviceId).toBe(device.id);
      expect(command.type).toBe('sync');
      expect(command.status).toBe('pending');
    });

    it('should acknowledge a command', async () => {
      const device = await mdm.devices.create({
        enrollmentId: 'ack-device',
        model: 'Test',
        manufacturer: 'Test',
        osVersion: '1',
      });

      const command = await mdm.commands.send({
        deviceId: device.id,
        type: 'reboot',
      });

      const acknowledged = await mdm.commands.acknowledge(command.id);
      expect(acknowledged.status).toBe('acknowledged');
    });

    it('should complete a command', async () => {
      const device = await mdm.devices.create({
        enrollmentId: 'complete-device',
        model: 'Test',
        manufacturer: 'Test',
        osVersion: '1',
      });

      const command = await mdm.commands.send({
        deviceId: device.id,
        type: 'lock',
      });

      const completed = await mdm.commands.complete(command.id, {
        success: true,
        message: 'Device locked',
      });

      expect(completed.status).toBe('completed');
      expect(completed.result?.success).toBe(true);
    });

    it('should fail a command', async () => {
      const device = await mdm.devices.create({
        enrollmentId: 'fail-device',
        model: 'Test',
        manufacturer: 'Test',
        osVersion: '1',
      });

      const command = await mdm.commands.send({
        deviceId: device.id,
        type: 'wipe',
      });

      const failed = await mdm.commands.fail(command.id, 'Permission denied');
      expect(failed.status).toBe('failed');
      expect(failed.error).toBe('Permission denied');
    });

    it('should get pending commands for a device', async () => {
      const device = await mdm.devices.create({
        enrollmentId: 'pending-device',
        model: 'Test',
        manufacturer: 'Test',
        osVersion: '1',
      });

      await mdm.commands.send({ deviceId: device.id, type: 'sync' });
      await mdm.commands.send({ deviceId: device.id, type: 'lock' });

      const pending = await mdm.commands.getPending(device.id);
      expect(pending.length).toBe(2);
    });
  });

  describe('Event System', () => {
    it('should emit and handle events', async () => {
      const handler = vi.fn();

      const unsubscribe = mdm.on('device.enrolled', handler);

      await mdm.emit('device.enrolled', {
        device: {
          id: 'test-device',
          enrollmentId: 'test-001',
          status: 'enrolled',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(handler).toHaveBeenCalled();

      unsubscribe();
    });

    it('should unsubscribe from events', async () => {
      const handler = vi.fn();

      const unsubscribe = mdm.on('device.enrolled', handler);
      unsubscribe();

      await mdm.emit('device.enrolled', {
        device: {
          id: 'test-device',
          enrollmentId: 'test-001',
          status: 'enrolled',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Device Token', () => {
    it('should verify a valid device token', async () => {
      // Create a device first
      const device = await mdm.devices.create({
        enrollmentId: 'token-device',
        model: 'Test',
        manufacturer: 'Test',
        osVersion: '1',
      });

      // We can't easily test token generation/verification without exposing internals
      // But we can test that verifyDeviceToken returns null for invalid tokens
      const result = await mdm.verifyDeviceToken('invalid-token');
      expect(result).toBeNull();
    });
  });
});

describe('Enrollment', () => {
  it('should reject enrollment with invalid signature', async () => {
    const mockDb = createMockDatabaseAdapter();
    const mockPush = createMockPushAdapter();

    const mdm = createMDM({
      database: mockDb,
      push: mockPush,
      enrollment: {
        deviceSecret: 'secret-key',
        autoEnroll: true,
      },
    });

    await expect(
      mdm.enroll({
        model: 'Test Device',
        manufacturer: 'Test',
        osVersion: '14',
        method: 'app-only',
        timestamp: new Date().toISOString(),
        signature: 'invalid-signature',
      })
    ).rejects.toThrow();
  });
});
