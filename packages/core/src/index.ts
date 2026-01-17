/**
 * OpenMDM Core
 *
 * A flexible, embeddable MDM (Mobile Device Management) SDK.
 * Inspired by better-auth's design philosophy.
 *
 * @example
 * ```typescript
 * import { createMDM } from '@openmdm/core';
 * import { drizzleAdapter } from '@openmdm/drizzle-adapter';
 *
 * const mdm = createMDM({
 *   database: drizzleAdapter(db),
 *   enrollment: {
 *     deviceSecret: process.env.DEVICE_HMAC_SECRET!,
 *     autoEnroll: true,
 *   },
 * });
 *
 * // Use in your routes
 * const devices = await mdm.devices.list();
 * ```
 */

import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import type {
  MDMConfig,
  MDMInstance,
  Device,
  Policy,
  Application,
  Command,
  Group,
  Heartbeat,
  EnrollmentRequest,
  EnrollmentResponse,
  DeviceFilter,
  DeviceListResult,
  CreateDeviceInput,
  UpdateDeviceInput,
  CreatePolicyInput,
  UpdatePolicyInput,
  CreateApplicationInput,
  UpdateApplicationInput,
  SendCommandInput,
  CommandFilter,
  CreateGroupInput,
  UpdateGroupInput,
  DeployTarget,
  DeviceManager,
  PolicyManager,
  ApplicationManager,
  CommandManager,
  GroupManager,
  PushAdapter,
  PushResult,
  PushBatchResult,
  PushMessage,
  EventType,
  EventHandler,
  EventPayloadMap,
  MDMEvent,
  MDMPlugin,
  CommandResult,
  InstalledApp,
  WebhookManager,
} from './types';
import {
  DeviceNotFoundError,
  ApplicationNotFoundError,
  EnrollmentError,
} from './types';
import { createWebhookManager } from './webhooks';

// Re-export all types
export * from './types';
export * from './schema';
export { createWebhookManager, verifyWebhookSignature } from './webhooks';
export type { WebhookPayload } from './webhooks';

/**
 * Create an MDM instance with the given configuration.
 */
export function createMDM(config: MDMConfig): MDMInstance {
  const { database, push, enrollment, webhooks: webhooksConfig, plugins = [] } = config;

  // Event handlers registry
  const eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();

  // Create push adapter
  const pushAdapter: PushAdapter = push
    ? createPushAdapter(push, database)
    : createStubPushAdapter();

  // Create webhook manager if configured
  const webhookManager: WebhookManager | undefined = webhooksConfig
    ? createWebhookManager(webhooksConfig)
    : undefined;

  // Event subscription
  const on = <T extends EventType>(
    event: T,
    handler: EventHandler<T>
  ): (() => void) => {
    if (!eventHandlers.has(event)) {
      eventHandlers.set(event, new Set());
    }
    const handlers = eventHandlers.get(event)!;
    handlers.add(handler as EventHandler<EventType>);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler<EventType>);
    };
  };

  // Event emission
  const emit = async <T extends EventType>(
    event: T,
    data: EventPayloadMap[T]
  ): Promise<void> => {
    const handlers = eventHandlers.get(event);

    // Create event record
    const eventRecord: MDMEvent<EventPayloadMap[T]> = {
      id: randomUUID(),
      deviceId: (data as any).device?.id || (data as any).deviceId || '',
      type: event,
      payload: data,
      createdAt: new Date(),
    };

    // Persist event
    try {
      await database.createEvent({
        deviceId: eventRecord.deviceId,
        type: eventRecord.type,
        payload: eventRecord.payload as Record<string, unknown>,
      });
    } catch (error) {
      console.error('[OpenMDM] Failed to persist event:', error);
    }

    // Deliver webhooks (async, don't wait)
    if (webhookManager) {
      webhookManager.deliver(eventRecord).catch((error) => {
        console.error('[OpenMDM] Webhook delivery error:', error);
      });
    }

    // Call handlers
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(eventRecord);
        } catch (error) {
          console.error(`[OpenMDM] Event handler error for ${event}:`, error);
        }
      }
    }

    // Call config hook if defined
    if (config.onEvent) {
      try {
        await config.onEvent(eventRecord);
      } catch (error) {
        console.error('[OpenMDM] onEvent hook error:', error);
      }
    }
  };

  // ============================================
  // Device Manager
  // ============================================

  const devices: DeviceManager = {
    async get(id: string): Promise<Device | null> {
      return database.findDevice(id);
    },

    async getByEnrollmentId(enrollmentId: string): Promise<Device | null> {
      return database.findDeviceByEnrollmentId(enrollmentId);
    },

    async list(filter?: DeviceFilter): Promise<DeviceListResult> {
      return database.listDevices(filter);
    },

    async create(data: CreateDeviceInput): Promise<Device> {
      const device = await database.createDevice(data);

      await emit('device.enrolled', { device });

      if (config.onDeviceEnrolled) {
        await config.onDeviceEnrolled(device);
      }

      return device;
    },

    async update(id: string, data: UpdateDeviceInput): Promise<Device> {
      const oldDevice = await database.findDevice(id);
      if (!oldDevice) {
        throw new DeviceNotFoundError(id);
      }

      const device = await database.updateDevice(id, data);

      // Emit status change event if status changed
      if (data.status && data.status !== oldDevice.status) {
        await emit('device.statusChanged', {
          device,
          oldStatus: oldDevice.status,
          newStatus: data.status,
        });
      }

      // Emit policy change event if policy changed
      if (data.policyId !== undefined && data.policyId !== oldDevice.policyId) {
        await emit('device.policyChanged', {
          device,
          oldPolicyId: oldDevice.policyId || undefined,
          newPolicyId: data.policyId || undefined,
        });
      }

      return device;
    },

    async delete(id: string): Promise<void> {
      const device = await database.findDevice(id);
      if (device) {
        await database.deleteDevice(id);
        await emit('device.unenrolled', { device });

        if (config.onDeviceUnenrolled) {
          await config.onDeviceUnenrolled(device);
        }
      }
    },

    async assignPolicy(
      deviceId: string,
      policyId: string | null
    ): Promise<Device> {
      const device = await this.update(deviceId, { policyId });

      // Notify device of policy change
      await pushAdapter.send(deviceId, {
        type: 'policy.updated',
        payload: { policyId },
        priority: 'high',
      });

      return device;
    },

    async addToGroup(deviceId: string, groupId: string): Promise<void> {
      await database.addDeviceToGroup(deviceId, groupId);
    },

    async removeFromGroup(deviceId: string, groupId: string): Promise<void> {
      await database.removeDeviceFromGroup(deviceId, groupId);
    },

    async getGroups(deviceId: string): Promise<Group[]> {
      return database.getDeviceGroups(deviceId);
    },

    async sendCommand(
      deviceId: string,
      input: Omit<SendCommandInput, 'deviceId'>
    ): Promise<Command> {
      const command = await database.createCommand({
        ...input,
        deviceId,
      });

      // Send via push
      const pushResult = await pushAdapter.send(deviceId, {
        type: `command.${input.type}`,
        payload: {
          commandId: command.id,
          type: input.type,
          ...input.payload,
        },
        priority: 'high',
      });

      // Update command status
      if (pushResult.success) {
        await database.updateCommand(command.id, {
          status: 'sent',
          sentAt: new Date(),
        });
      }

      if (config.onCommand) {
        await config.onCommand(command);
      }

      return database.findCommand(command.id) as Promise<Command>;
    },

    async sync(deviceId: string): Promise<Command> {
      return this.sendCommand(deviceId, { type: 'sync' });
    },

    async reboot(deviceId: string): Promise<Command> {
      return this.sendCommand(deviceId, { type: 'reboot' });
    },

    async lock(deviceId: string, message?: string): Promise<Command> {
      return this.sendCommand(deviceId, {
        type: 'lock',
        payload: message ? { message } : undefined,
      });
    },

    async wipe(deviceId: string, preserveData?: boolean): Promise<Command> {
      return this.sendCommand(deviceId, {
        type: preserveData ? 'wipe' : 'factoryReset',
        payload: { preserveData },
      });
    },
  };

  // ============================================
  // Policy Manager
  // ============================================

  const policies: PolicyManager = {
    async get(id: string): Promise<Policy | null> {
      return database.findPolicy(id);
    },

    async getDefault(): Promise<Policy | null> {
      return database.findDefaultPolicy();
    },

    async list(): Promise<Policy[]> {
      return database.listPolicies();
    },

    async create(data: CreatePolicyInput): Promise<Policy> {
      // If this is being set as default, clear other defaults first
      if (data.isDefault) {
        const existingPolicies = await database.listPolicies();
        for (const policy of existingPolicies) {
          if (policy.isDefault) {
            await database.updatePolicy(policy.id, { isDefault: false });
          }
        }
      }

      return database.createPolicy(data);
    },

    async update(id: string, data: UpdatePolicyInput): Promise<Policy> {
      // If setting as default, clear other defaults first
      if (data.isDefault) {
        const existingPolicies = await database.listPolicies();
        for (const policy of existingPolicies) {
          if (policy.isDefault && policy.id !== id) {
            await database.updatePolicy(policy.id, { isDefault: false });
          }
        }
      }

      const policy = await database.updatePolicy(id, data);

      // Notify all devices with this policy
      const devicesResult = await database.listDevices({ policyId: id });
      if (devicesResult.devices.length > 0) {
        const deviceIds = devicesResult.devices.map((d) => d.id);
        await pushAdapter.sendBatch(deviceIds, {
          type: 'policy.updated',
          payload: { policyId: id },
          priority: 'high',
        });
      }

      return policy;
    },

    async delete(id: string): Promise<void> {
      // Check if any devices use this policy
      const devicesResult = await database.listDevices({ policyId: id });
      if (devicesResult.devices.length > 0) {
        // Remove policy from devices first
        for (const device of devicesResult.devices) {
          await database.updateDevice(device.id, { policyId: null });
        }
      }

      await database.deletePolicy(id);
    },

    async setDefault(id: string): Promise<Policy> {
      return this.update(id, { isDefault: true });
    },

    async getDevices(policyId: string): Promise<Device[]> {
      const result = await database.listDevices({ policyId });
      return result.devices;
    },

    async applyToDevice(policyId: string, deviceId: string): Promise<void> {
      await devices.assignPolicy(deviceId, policyId);
    },
  };

  // ============================================
  // Application Manager
  // ============================================

  const apps: ApplicationManager = {
    async get(id: string): Promise<Application | null> {
      return database.findApplication(id);
    },

    async getByPackage(
      packageName: string,
      version?: string
    ): Promise<Application | null> {
      return database.findApplicationByPackage(packageName, version);
    },

    async list(activeOnly?: boolean): Promise<Application[]> {
      return database.listApplications(activeOnly);
    },

    async register(data: CreateApplicationInput): Promise<Application> {
      return database.createApplication(data);
    },

    async update(id: string, data: UpdateApplicationInput): Promise<Application> {
      return database.updateApplication(id, data);
    },

    async delete(id: string): Promise<void> {
      await database.deleteApplication(id);
    },

    async activate(id: string): Promise<Application> {
      return database.updateApplication(id, { isActive: true });
    },

    async deactivate(id: string): Promise<Application> {
      return database.updateApplication(id, { isActive: false });
    },

    async deploy(packageName: string, target: DeployTarget): Promise<void> {
      const app = await database.findApplicationByPackage(packageName);
      if (!app) {
        throw new ApplicationNotFoundError(packageName);
      }

      const deviceIds: string[] = [];

      // Collect target devices
      if (target.devices) {
        deviceIds.push(...target.devices);
      }

      if (target.groups) {
        for (const groupId of target.groups) {
          const groupDevices = await database.listDevicesInGroup(groupId);
          deviceIds.push(...groupDevices.map((d) => d.id));
        }
      }

      if (target.policies) {
        for (const policyId of target.policies) {
          const result = await database.listDevices({ policyId });
          deviceIds.push(...result.devices.map((d) => d.id));
        }
      }

      // Deduplicate
      const uniqueDeviceIds = [...new Set(deviceIds)];

      // Send install command to all devices
      if (uniqueDeviceIds.length > 0) {
        await pushAdapter.sendBatch(uniqueDeviceIds, {
          type: 'command.installApp',
          payload: {
            packageName: app.packageName,
            version: app.version,
            versionCode: app.versionCode,
            url: app.url,
            hash: app.hash,
          },
          priority: 'high',
        });

        // Create command records for each device
        for (const deviceId of uniqueDeviceIds) {
          await database.createCommand({
            deviceId,
            type: 'installApp',
            payload: {
              packageName: app.packageName,
              version: app.version,
              url: app.url,
            },
          });
        }
      }
    },

    async installOnDevice(
      packageName: string,
      deviceId: string,
      version?: string
    ): Promise<Command> {
      const app = await database.findApplicationByPackage(packageName, version);
      if (!app) {
        throw new ApplicationNotFoundError(packageName);
      }

      return devices.sendCommand(deviceId, {
        type: 'installApp',
        payload: {
          packageName: app.packageName,
          version: app.version,
          versionCode: app.versionCode,
          url: app.url,
          hash: app.hash,
        },
      });
    },

    async uninstallFromDevice(
      packageName: string,
      deviceId: string
    ): Promise<Command> {
      return devices.sendCommand(deviceId, {
        type: 'uninstallApp',
        payload: { packageName },
      });
    },
  };

  // ============================================
  // Command Manager
  // ============================================

  const commands: CommandManager = {
    async get(id: string): Promise<Command | null> {
      return database.findCommand(id);
    },

    async list(filter?: CommandFilter): Promise<Command[]> {
      return database.listCommands(filter);
    },

    async send(input: SendCommandInput): Promise<Command> {
      return devices.sendCommand(input.deviceId, {
        type: input.type,
        payload: input.payload,
      });
    },

    async cancel(id: string): Promise<Command> {
      return database.updateCommand(id, { status: 'cancelled' });
    },

    async acknowledge(id: string): Promise<Command> {
      const command = await database.updateCommand(id, {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
      });

      const device = await database.findDevice(command.deviceId);
      if (device) {
        await emit('command.acknowledged', { device, command });
      }

      return command;
    },

    async complete(id: string, result: CommandResult): Promise<Command> {
      const command = await database.updateCommand(id, {
        status: 'completed',
        result,
        completedAt: new Date(),
      });

      const device = await database.findDevice(command.deviceId);
      if (device) {
        await emit('command.completed', { device, command, result });
      }

      return command;
    },

    async fail(id: string, error: string): Promise<Command> {
      const command = await database.updateCommand(id, {
        status: 'failed',
        error,
        completedAt: new Date(),
      });

      const device = await database.findDevice(command.deviceId);
      if (device) {
        await emit('command.failed', { device, command, error });
      }

      return command;
    },

    async getPending(deviceId: string): Promise<Command[]> {
      return database.getPendingCommands(deviceId);
    },
  };

  // ============================================
  // Group Manager
  // ============================================

  const groups: GroupManager = {
    async get(id: string): Promise<Group | null> {
      return database.findGroup(id);
    },

    async list(): Promise<Group[]> {
      return database.listGroups();
    },

    async create(data: CreateGroupInput): Promise<Group> {
      return database.createGroup(data);
    },

    async update(id: string, data: UpdateGroupInput): Promise<Group> {
      return database.updateGroup(id, data);
    },

    async delete(id: string): Promise<void> {
      await database.deleteGroup(id);
    },

    async getDevices(groupId: string): Promise<Device[]> {
      return database.listDevicesInGroup(groupId);
    },

    async addDevice(groupId: string, deviceId: string): Promise<void> {
      await database.addDeviceToGroup(deviceId, groupId);
    },

    async removeDevice(groupId: string, deviceId: string): Promise<void> {
      await database.removeDeviceFromGroup(deviceId, groupId);
    },

    async getChildren(groupId: string): Promise<Group[]> {
      const allGroups = await database.listGroups();
      return allGroups.filter((g) => g.parentId === groupId);
    },
  };

  // ============================================
  // Enrollment
  // ============================================

  const enroll = async (
    request: EnrollmentRequest
  ): Promise<EnrollmentResponse> => {
    // Validate method if restricted
    if (
      enrollment?.allowedMethods &&
      !enrollment.allowedMethods.includes(request.method)
    ) {
      throw new EnrollmentError(
        `Enrollment method '${request.method}' is not allowed`
      );
    }

    // Verify signature if secret is configured
    if (enrollment?.deviceSecret) {
      const isValid = verifyEnrollmentSignature(
        request,
        enrollment.deviceSecret
      );
      if (!isValid) {
        throw new EnrollmentError('Invalid enrollment signature');
      }
    }

    // Custom validation
    if (enrollment?.validate) {
      const isValid = await enrollment.validate(request);
      if (!isValid) {
        throw new EnrollmentError('Enrollment validation failed');
      }
    }

    // Determine enrollment ID
    const enrollmentId =
      request.macAddress ||
      request.serialNumber ||
      request.imei ||
      request.androidId;

    if (!enrollmentId) {
      throw new EnrollmentError(
        'Device must provide at least one identifier (macAddress, serialNumber, imei, or androidId)'
      );
    }

    // Check if device already exists
    let device = await database.findDeviceByEnrollmentId(enrollmentId);

    if (device) {
      // Device re-enrolling
      device = await database.updateDevice(device.id, {
        status: 'enrolled',
        model: request.model,
        manufacturer: request.manufacturer,
        osVersion: request.osVersion,
        lastSync: new Date(),
      });
    } else if (enrollment?.autoEnroll) {
      // Auto-create device
      device = await database.createDevice({
        enrollmentId,
        model: request.model,
        manufacturer: request.manufacturer,
        osVersion: request.osVersion,
        serialNumber: request.serialNumber,
        imei: request.imei,
        macAddress: request.macAddress,
        androidId: request.androidId,
        policyId: request.policyId || enrollment.defaultPolicyId,
      });

      // Add to default group if configured
      if (enrollment.defaultGroupId) {
        await database.addDeviceToGroup(device.id, enrollment.defaultGroupId);
      }
    } else if (enrollment?.requireApproval) {
      // Create pending device
      device = await database.createDevice({
        enrollmentId,
        model: request.model,
        manufacturer: request.manufacturer,
        osVersion: request.osVersion,
        serialNumber: request.serialNumber,
        imei: request.imei,
        macAddress: request.macAddress,
        androidId: request.androidId,
      });
      // Status remains 'pending'
    } else {
      throw new EnrollmentError(
        'Device not registered and auto-enroll is disabled'
      );
    }

    // Get policy
    let policy: Policy | null = null;
    if (device.policyId) {
      policy = await database.findPolicy(device.policyId);
    }
    if (!policy) {
      policy = await database.findDefaultPolicy();
    }

    // Generate JWT token for device auth
    const tokenSecret =
      config.auth?.deviceTokenSecret || enrollment?.deviceSecret || '';
    const tokenExpiration = config.auth?.deviceTokenExpiration || 365 * 24 * 60 * 60;
    const token = generateDeviceToken(device.id, tokenSecret, tokenExpiration);

    // Emit enrollment event
    await emit('device.enrolled', { device });

    // Call config hook if defined
    if (config.onDeviceEnrolled) {
      await config.onDeviceEnrolled(device);
    }

    // Call plugin hooks
    for (const plugin of plugins) {
      if (plugin.onEnroll) {
        await plugin.onEnroll(device, request);
      }
      if (plugin.onDeviceEnrolled) {
        await plugin.onDeviceEnrolled(device);
      }
    }

    return {
      deviceId: device.id,
      enrollmentId: device.enrollmentId,
      policyId: policy?.id,
      policy: policy || undefined,
      serverUrl: config.serverUrl || '',
      pushConfig: {
        provider: push?.provider || 'polling',
        fcmSenderId: (push?.fcmCredentials as any)?.project_id,
        mqttUrl: push?.mqttUrl,
        mqttTopic: push?.mqttTopicPrefix
          ? `${push.mqttTopicPrefix}/${device.id}`
          : `openmdm/devices/${device.id}`,
        pollingInterval: push?.pollingInterval || 60,
      },
      token,
      tokenExpiresAt: new Date(Date.now() + tokenExpiration * 1000),
    };
  };

  // ============================================
  // Heartbeat Processing
  // ============================================

  const processHeartbeat = async (
    deviceId: string,
    heartbeat: Heartbeat
  ): Promise<void> => {
    const device = await database.findDevice(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }

    // Update device with heartbeat data
    const updateData: UpdateDeviceInput = {
      lastHeartbeat: heartbeat.timestamp,
      batteryLevel: heartbeat.batteryLevel,
      storageUsed: heartbeat.storageUsed,
      storageTotal: heartbeat.storageTotal,
      installedApps: heartbeat.installedApps,
    };

    if (heartbeat.location) {
      updateData.location = heartbeat.location;
    }

    const updatedDevice = await database.updateDevice(deviceId, updateData);

    // Emit heartbeat event
    await emit('device.heartbeat', { device: updatedDevice, heartbeat });

    // Emit location event if location changed
    if (heartbeat.location) {
      await emit('device.locationUpdated', {
        device: updatedDevice,
        location: heartbeat.location,
      });
    }

    // Check for app changes
    if (device.installedApps && heartbeat.installedApps) {
      const oldApps = new Map(
        device.installedApps.map((a) => [a.packageName, a])
      );
      const newApps = new Map(
        heartbeat.installedApps.map((a) => [a.packageName, a])
      );

      // Check for new installs
      for (const [pkg, app] of newApps) {
        const oldApp = oldApps.get(pkg);
        if (!oldApp) {
          await emit('app.installed', { device: updatedDevice, app });
        } else if (oldApp.version !== app.version) {
          await emit('app.updated', {
            device: updatedDevice,
            app,
            oldVersion: oldApp.version,
          });
        }
      }

      // Check for uninstalls
      for (const [pkg] of oldApps) {
        if (!newApps.has(pkg)) {
          await emit('app.uninstalled', {
            device: updatedDevice,
            packageName: pkg,
          });
        }
      }
    }

    // Call config hook if defined
    if (config.onHeartbeat) {
      await config.onHeartbeat(updatedDevice, heartbeat);
    }

    // Call plugin hooks
    for (const plugin of plugins) {
      if (plugin.onHeartbeat) {
        await plugin.onHeartbeat(updatedDevice, heartbeat);
      }
    }
  };

  // ============================================
  // Token Verification
  // ============================================

  const verifyDeviceToken = async (
    token: string
  ): Promise<{ deviceId: string } | null> => {
    try {
      const tokenSecret =
        config.auth?.deviceTokenSecret || enrollment?.deviceSecret || '';

      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const [header, payload, signature] = parts;

      // Verify signature
      const expectedSignature = createHmac('sha256', tokenSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      if (signature !== expectedSignature) {
        return null;
      }

      // Decode payload
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf-8')
      );

      // Check expiration
      if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return { deviceId: decoded.sub };
    } catch {
      return null;
    }
  };

  // ============================================
  // Plugin Management
  // ============================================

  const getPlugins = (): MDMPlugin[] => plugins;

  const getPlugin = (name: string): MDMPlugin | undefined => {
    return plugins.find((p) => p.name === name);
  };

  // ============================================
  // Create Instance
  // ============================================

  const instance: MDMInstance = {
    devices,
    policies,
    apps,
    commands,
    groups,
    push: pushAdapter,
    webhooks: webhookManager,
    db: database,
    config,
    on,
    emit,
    enroll,
    processHeartbeat,
    verifyDeviceToken,
    getPlugins,
    getPlugin,
  };

  // Initialize plugins
  (async () => {
    for (const plugin of plugins) {
      if (plugin.onInit) {
        try {
          await plugin.onInit(instance);
          console.log(`[OpenMDM] Plugin initialized: ${plugin.name}`);
        } catch (error) {
          console.error(
            `[OpenMDM] Failed to initialize plugin ${plugin.name}:`,
            error
          );
        }
      }
    }
  })();

  return instance;
}

// ============================================
// Push Adapter Factory
// ============================================

function createPushAdapter(
  config: MDMConfig['push'],
  database: MDMConfig['database']
): PushAdapter {
  if (!config) {
    return createStubPushAdapter();
  }

  // The actual implementations will be provided by separate packages
  // This is a base implementation that logs and stores tokens
  return {
    async send(deviceId: string, message: PushMessage): Promise<PushResult> {
      console.log(
        `[OpenMDM] Push to ${deviceId}: ${message.type}`,
        message.payload
      );

      // In production, this would be replaced by FCM/MQTT adapter
      return { success: true, messageId: randomUUID() };
    },

    async sendBatch(
      deviceIds: string[],
      message: PushMessage
    ): Promise<PushBatchResult> {
      console.log(
        `[OpenMDM] Push to ${deviceIds.length} devices: ${message.type}`
      );

      const results = deviceIds.map((deviceId) => ({
        deviceId,
        result: { success: true, messageId: randomUUID() },
      }));

      return {
        successCount: deviceIds.length,
        failureCount: 0,
        results,
      };
    },

    async registerToken(deviceId: string, token: string): Promise<void> {
      // Polling doesn't use push tokens
      if (config.provider === 'polling') {
        return;
      }
      await database.upsertPushToken({
        deviceId,
        provider: config.provider,
        token,
      });
    },

    async unregisterToken(deviceId: string): Promise<void> {
      // Polling doesn't use push tokens
      if (config.provider === 'polling') {
        return;
      }
      await database.deletePushToken(deviceId, config.provider);
    },
  };
}

function createStubPushAdapter(): PushAdapter {
  return {
    async send(deviceId: string, message: PushMessage): Promise<PushResult> {
      console.log(`[OpenMDM] Push (stub): ${deviceId} <- ${message.type}`);
      return { success: true, messageId: 'stub' };
    },

    async sendBatch(
      deviceIds: string[],
      message: PushMessage
    ): Promise<PushBatchResult> {
      console.log(
        `[OpenMDM] Push (stub): ${deviceIds.length} devices <- ${message.type}`
      );
      return {
        successCount: deviceIds.length,
        failureCount: 0,
        results: deviceIds.map((deviceId) => ({
          deviceId,
          result: { success: true, messageId: 'stub' },
        })),
      };
    },
  };
}

// ============================================
// Utility Functions
// ============================================

function verifyEnrollmentSignature(
  request: EnrollmentRequest,
  secret: string
): boolean {
  const { signature, ...data } = request;

  if (!signature) {
    return false;
  }

  // Reconstruct the message that was signed
  // Format: identifier:timestamp
  const identifier =
    data.macAddress || data.serialNumber || data.imei || data.androidId || '';
  const message = `${identifier}:${data.timestamp}`;

  const expectedSignature = createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

function generateDeviceToken(
  deviceId: string,
  secret: string,
  expirationSeconds: number
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: deviceId,
      iat: now,
      exp: now + expirationSeconds,
      iss: 'openmdm',
    })
  ).toString('base64url');

  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}
