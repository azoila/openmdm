/**
 * OpenMDM Example Server
 *
 * This example shows how to integrate OpenMDM into a Hono server.
 * Similar to how better-auth integrates, MDM becomes part of your app.
 */

import { Hono } from 'hono';
import { createMDM } from '@openmdm/core';
// import { drizzleAdapter } from '@openmdm/drizzle-adapter';
// import { honoPlugin } from '@openmdm/hono';
// import { kioskPlugin } from '@openmdm/plugins/kiosk';
// import { db } from './db';

// ============================================
// Mock Database Adapter (for example purposes)
// In production, use drizzleAdapter(db) or prismaAdapter(prisma)
// ============================================

const mockDb = {
  devices: new Map<string, any>(),
  policies: new Map<string, any>(),
  applications: new Map<string, any>(),
  commands: new Map<string, any>(),
  events: new Map<string, any>(),
  groups: new Map<string, any>(),
};

const mockDatabaseAdapter = {
  // Devices
  async findDevice(id: string) {
    return mockDb.devices.get(id) || null;
  },
  async findDeviceByEnrollmentId(enrollmentId: string) {
    for (const device of mockDb.devices.values()) {
      if (device.enrollmentId === enrollmentId) return device;
    }
    return null;
  },
  async listDevices(filter?: any) {
    const devices = Array.from(mockDb.devices.values());
    if (!filter) return devices;
    return devices.filter((d) => {
      if (filter.status && d.status !== filter.status) return false;
      if (filter.policyId && d.policyId !== filter.policyId) return false;
      if (filter.groupId && d.groupId !== filter.groupId) return false;
      return true;
    });
  },
  async createDevice(data: any) {
    const device = {
      id: crypto.randomUUID(),
      ...data,
      status: 'enrolled',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.devices.set(device.id, device);
    return device;
  },
  async updateDevice(id: string, data: any) {
    const device = mockDb.devices.get(id);
    if (!device) throw new Error(`Device ${id} not found`);
    const updated = { ...device, ...data, updatedAt: new Date() };
    mockDb.devices.set(id, updated);
    return updated;
  },
  async deleteDevice(id: string) {
    mockDb.devices.delete(id);
  },

  // Policies
  async findPolicy(id: string) {
    return mockDb.policies.get(id) || null;
  },
  async findDefaultPolicy() {
    for (const policy of mockDb.policies.values()) {
      if (policy.isDefault) return policy;
    }
    return null;
  },
  async listPolicies() {
    return Array.from(mockDb.policies.values());
  },
  async createPolicy(data: any) {
    const policy = {
      id: crypto.randomUUID(),
      ...data,
      isDefault: data.isDefault ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.policies.set(policy.id, policy);
    return policy;
  },
  async updatePolicy(id: string, data: any) {
    const policy = mockDb.policies.get(id);
    if (!policy) throw new Error(`Policy ${id} not found`);
    const updated = { ...policy, ...data, updatedAt: new Date() };
    mockDb.policies.set(id, updated);
    return updated;
  },
  async deletePolicy(id: string) {
    mockDb.policies.delete(id);
  },

  // Applications
  async findApplication(id: string) {
    return mockDb.applications.get(id) || null;
  },
  async findApplicationByPackage(packageName: string) {
    for (const app of mockDb.applications.values()) {
      if (app.packageName === packageName) return app;
    }
    return null;
  },
  async listApplications() {
    return Array.from(mockDb.applications.values());
  },
  async createApplication(data: any) {
    const app = {
      id: crypto.randomUUID(),
      ...data,
      isActive: true,
      showIcon: data.showIcon ?? true,
      runAfterInstall: data.runAfterInstall ?? false,
      runAtBoot: data.runAtBoot ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.applications.set(app.id, app);
    return app;
  },
  async updateApplication(id: string, data: any) {
    const app = mockDb.applications.get(id);
    if (!app) throw new Error(`Application ${id} not found`);
    const updated = { ...app, ...data, updatedAt: new Date() };
    mockDb.applications.set(id, updated);
    return updated;
  },
  async deleteApplication(id: string) {
    mockDb.applications.delete(id);
  },

  // Commands
  async findCommand(id: string) {
    return mockDb.commands.get(id) || null;
  },
  async listCommands(deviceId: string) {
    return Array.from(mockDb.commands.values()).filter(
      (c) => c.deviceId === deviceId
    );
  },
  async createCommand(data: any) {
    const command = {
      id: crypto.randomUUID(),
      ...data,
      status: 'pending',
      createdAt: new Date(),
    };
    mockDb.commands.set(command.id, command);
    return command;
  },
  async updateCommand(id: string, data: any) {
    const command = mockDb.commands.get(id);
    if (!command) throw new Error(`Command ${id} not found`);
    const updated = { ...command, ...data };
    mockDb.commands.set(id, updated);
    return updated;
  },

  // Events
  async createEvent(data: any) {
    const event = {
      id: crypto.randomUUID(),
      ...data,
      createdAt: new Date(),
    };
    mockDb.events.set(event.id, event);
    return event;
  },
  async listEvents(deviceId: string, limit = 100) {
    return Array.from(mockDb.events.values())
      .filter((e) => e.deviceId === deviceId)
      .slice(0, limit);
  },

  // Groups
  async findGroup(id: string) {
    return mockDb.groups.get(id) || null;
  },
  async listGroups() {
    return Array.from(mockDb.groups.values());
  },
  async createGroup(data: any) {
    const group = {
      id: crypto.randomUUID(),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.groups.set(group.id, group);
    return group;
  },
  async updateGroup(id: string, data: any) {
    const group = mockDb.groups.get(id);
    if (!group) throw new Error(`Group ${id} not found`);
    const updated = { ...group, ...data, updatedAt: new Date() };
    mockDb.groups.set(id, updated);
    return updated;
  },
  async deleteGroup(id: string) {
    mockDb.groups.delete(id);
  },
};

// ============================================
// Create MDM Instance
// ============================================

const mdm = createMDM({
  // Database adapter (use real adapter in production)
  database: mockDatabaseAdapter,

  // Push notifications (FCM, MQTT, or WebSocket)
  push: {
    provider: 'fcm',
    // fcmCredentials: JSON.parse(process.env.FCM_CREDENTIALS || '{}'),
  },

  // Enrollment settings
  enrollment: {
    deviceSecret: process.env.DEVICE_HMAC_SECRET || 'dev-secret-change-in-production',
    autoEnroll: true,
    // defaultPolicyId: 'default-policy-id',
  },

  // Event hooks
  onDeviceEnrolled: async (device) => {
    console.log(`[MDM] Device enrolled: ${device.model} (${device.enrollmentId})`);
  },

  onHeartbeat: async (device, heartbeat) => {
    console.log(
      `[MDM] Heartbeat from ${device.enrollmentId}: Battery ${heartbeat.batteryLevel}%`
    );
  },

  // Plugins
  plugins: [
    // kioskPlugin({ defaultPolicy: 'standard' }),
    // geofencePlugin(),
  ],
});

// Listen to events
mdm.on('device.enrolled', async (event) => {
  console.log('[Event] device.enrolled:', event.payload);
});

mdm.on('device.heartbeat', async (event) => {
  console.log('[Event] device.heartbeat:', event.deviceId);
});

// ============================================
// Create Hono App
// ============================================

const app = new Hono();

// Your existing routes
app.get('/', (c) => {
  return c.json({
    name: 'OpenMDM Example Server',
    version: '1.0.0',
    docs: '/mdm/docs',
  });
});

// ============================================
// MDM API Routes
// ============================================

const mdmApi = new Hono();

// Enrollment endpoint (called by Android agent)
mdmApi.post('/enroll', async (c) => {
  try {
    const body = await c.req.json();
    const result = await mdm.enroll({
      macAddress: body.macAddress,
      serialNumber: body.serialNumber,
      imei: body.imei,
      androidId: body.androidId,
      model: body.model,
      manufacturer: body.manufacturer,
      osVersion: body.osVersion,
      method: body.method || 'app-only',
      timestamp: body.timestamp,
      signature: body.signature,
    });
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
});

// Heartbeat endpoint (called by Android agent)
mdmApi.post('/heartbeat', async (c) => {
  try {
    const deviceId = c.req.header('X-Device-Id');
    if (!deviceId) {
      return c.json({ error: 'Missing X-Device-Id header' }, 400);
    }

    const body = await c.req.json();
    await mdm.processHeartbeat(deviceId, {
      deviceId,
      timestamp: new Date(),
      batteryLevel: body.batteryLevel,
      isCharging: body.isCharging,
      storageUsed: body.storageUsed,
      storageTotal: body.storageTotal,
      memoryUsed: body.memoryUsed,
      memoryTotal: body.memoryTotal,
      networkType: body.networkType,
      signalStrength: body.signalStrength,
      location: body.location,
      installedApps: body.installedApps,
    });
    return c.json({ status: 'ok' });
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
});

// Device routes
mdmApi.get('/devices', async (c) => {
  const status = c.req.query('status');
  const policyId = c.req.query('policyId');
  const devices = await mdm.devices.list({
    status: status as any,
    policyId,
  });
  return c.json({ devices });
});

mdmApi.get('/devices/:id', async (c) => {
  const device = await mdm.devices.get(c.req.param('id'));
  if (!device) {
    return c.json({ error: 'Device not found' }, 404);
  }
  return c.json(device);
});

mdmApi.post('/devices/:id/commands', async (c) => {
  const deviceId = c.req.param('id');
  const body = await c.req.json();
  const command = await mdm.devices.sendCommand(deviceId, {
    type: body.type,
    payload: body.payload,
  });
  return c.json(command);
});

mdmApi.post('/devices/:id/policy', async (c) => {
  const deviceId = c.req.param('id');
  const { policyId } = await c.req.json();
  const device = await mdm.devices.assignPolicy(deviceId, policyId);
  return c.json(device);
});

// Policy routes
mdmApi.get('/policies', async (c) => {
  const policies = await mdm.policies.list();
  return c.json({ policies });
});

mdmApi.post('/policies', async (c) => {
  const body = await c.req.json();
  const policy = await mdm.policies.create({
    name: body.name,
    description: body.description,
    isDefault: body.isDefault,
    settings: body.settings,
  });
  return c.json(policy);
});

mdmApi.get('/policies/:id', async (c) => {
  const policy = await mdm.policies.get(c.req.param('id'));
  if (!policy) {
    return c.json({ error: 'Policy not found' }, 404);
  }
  return c.json(policy);
});

mdmApi.put('/policies/:id', async (c) => {
  const body = await c.req.json();
  const policy = await mdm.policies.update(c.req.param('id'), body);
  return c.json(policy);
});

// Application routes
mdmApi.get('/applications', async (c) => {
  const apps = await mdm.apps.list();
  return c.json({ applications: apps });
});

mdmApi.post('/applications', async (c) => {
  const body = await c.req.json();
  const app = await mdm.apps.register({
    name: body.name,
    packageName: body.packageName,
    version: body.version,
    versionCode: body.versionCode,
    url: body.url,
    hash: body.hash,
    size: body.size,
  });
  return c.json(app);
});

mdmApi.post('/applications/:packageName/deploy', async (c) => {
  const packageName = c.req.param('packageName');
  const body = await c.req.json();
  await mdm.apps.deploy(packageName, {
    devices: body.devices,
    policies: body.policies,
    groups: body.groups,
  });
  return c.json({ status: 'ok', message: 'Deployment initiated' });
});

// Group routes
mdmApi.get('/groups', async (c) => {
  const groups = await mdm.groups.list();
  return c.json({ groups });
});

mdmApi.post('/groups', async (c) => {
  const body = await c.req.json();
  const group = await mdm.groups.create({
    name: body.name,
    description: body.description,
    policyId: body.policyId,
  });
  return c.json(group);
});

mdmApi.get('/groups/:id/devices', async (c) => {
  const devices = await mdm.groups.listDevices(c.req.param('id'));
  return c.json({ devices });
});

// Mount MDM routes
app.route('/mdm', mdmApi);

// ============================================
// Start Server
// ============================================

const port = parseInt(process.env.PORT || '3000');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    OpenMDM Example Server                     ║
╠══════════════════════════════════════════════════════════════╣
║  Server:     http://localhost:${port}                            ║
║  MDM API:    http://localhost:${port}/mdm                        ║
║                                                              ║
║  Endpoints:                                                  ║
║    POST   /mdm/enroll           - Device enrollment          ║
║    POST   /mdm/heartbeat        - Device heartbeat           ║
║    GET    /mdm/devices          - List devices               ║
║    GET    /mdm/devices/:id      - Get device                 ║
║    POST   /mdm/devices/:id/commands - Send command           ║
║    GET    /mdm/policies         - List policies              ║
║    POST   /mdm/policies         - Create policy              ║
║    GET    /mdm/applications     - List applications          ║
║    POST   /mdm/applications     - Register application       ║
║    GET    /mdm/groups           - List groups                ║
╚══════════════════════════════════════════════════════════════╝
`);

export default {
  port,
  fetch: app.fetch,
};