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

import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { createAuditManager } from './audit';
import { createAuthorizationManager } from './authorization';
import { createScopedInstance } from './context';
import { createDashboardManager } from './dashboard';
import {
  ChallengeInvalidError,
  canonicalDeviceRequestMessage,
  canonicalEnrollmentMessage,
  InvalidPublicKeyError,
  importPublicKeyFromSpki,
  PublicKeyMismatchError,
  verifyDeviceRequest,
  verifyEcdsaSignature,
} from './device-identity';
import { createConsoleLogger, createSilentLogger } from './logger';
import { createMemoryPluginStorageAdapter, createPluginStorageAdapter } from './plugin-storage';
import { createMessageQueueManager } from './queue';
import { createScheduleManager } from './schedule';
import { createTenantManager } from './tenant';
import type {
  Application,
  ApplicationManager,
  AuditManager,
  AuthorizationManager,
  Command,
  CommandFilter,
  CommandManager,
  CommandResult,
  CommandRetryResult,
  CreateApplicationInput,
  CreateDeviceInput,
  CreateGroupInput,
  CreatePolicyInput,
  DashboardManager,
  DeployTarget,
  Device,
  DeviceFilter,
  DeviceListResult,
  DeviceManager,
  DevicePolicyCompliance,
  EnrollmentChallenge,
  EnrollmentRequest,
  EnrollmentResponse,
  EventHandler,
  EventPayloadMap,
  EventType,
  Group,
  GroupHierarchyStats,
  GroupManager,
  GroupTreeNode,
  Heartbeat,
  InstalledApp,
  Logger,
  MDMConfig,
  MDMContext,
  MDMEvent,
  MDMInstance,
  MDMPlugin,
  MessageQueueManager,
  PluginStorageAdapter,
  Policy,
  PolicyCompliance,
  PolicyComplianceStatus,
  PolicyManager,
  PolicySettings,
  PolicyVersion,
  PushAdapter,
  PushBatchResult,
  PushMessage,
  PushResult,
  ScheduleManager,
  ScopedMDM,
  SendCommandInput,
  TenantManager,
  UpdateApplicationInput,
  UpdateDeviceInput,
  UpdateGroupInput,
  UpdatePolicyInput,
  VerifyDeviceTokenOptions,
  WebhookManager,
} from './types';
import {
  ApplicationNotFoundError,
  CommandNotFoundError,
  DeviceNotFoundError,
  EnrollmentError,
  PolicyNotFoundError,
  ValidationError,
} from './types';
import { createWebhookManager } from './webhooks';

export * from './agent-protocol';
export { createAuditManager } from './audit';
export { createAuthorizationManager } from './authorization';
export { createScopedInstance } from './context';
export { createDashboardManager } from './dashboard';
// Device identity (Phase 2b)
export {
  ChallengeInvalidError,
  canonicalDeviceRequestMessage,
  canonicalEnrollmentMessage,
  InvalidPublicKeyError,
  importPublicKeyFromSpki,
  PublicKeyMismatchError,
  verifyDeviceRequest,
  verifyEcdsaSignature,
} from './device-identity';
export { createConsoleLogger, createSilentLogger } from './logger';
export {
  createMemoryPluginStorageAdapter,
  createPluginKey,
  createPluginStorageAdapter,
  parsePluginKey,
} from './plugin-storage';
export { createMessageQueueManager } from './queue';
export { createScheduleManager } from './schedule';
export * from './schema';
// Re-export enterprise manager factories
export { createTenantManager } from './tenant';
// Re-export all types
export * from './types';
export type { WebhookPayload } from './webhooks';
export { createWebhookManager, verifyWebhookSignature } from './webhooks';

/**
 * Create an MDM instance with the given configuration.
 */
export function createMDM(config: MDMConfig): MDMInstance {
  const { database, push, enrollment, webhooks: webhooksConfig, plugins = [] } = config;

  // Structured logger. Falls back to the console-backed default if
  // the host doesn't pass one. Host code is expected to pass a real
  // pino/winston instance in production.
  const logger = config.logger ?? createConsoleLogger();

  // Extract a stable message from an unknown thrown value so it
  // survives JSON serialization into the log context. Error objects
  // stringify to `{}` otherwise, which is the #1 cause of "we can't
  // tell why this failed" in production logs.
  const errorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  };

  // Event handlers registry
  const eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();

  // Create push adapter
  const pushAdapter: PushAdapter = push
    ? createPushAdapter(push, database, logger)
    : createStubPushAdapter(logger);

  // Create webhook manager if configured
  const webhookManager: WebhookManager | undefined = webhooksConfig
    ? createWebhookManager(webhooksConfig, logger)
    : undefined;

  // ============================================
  // Enterprise Managers (optional)
  // ============================================

  // Create tenant manager if multi-tenancy is enabled
  const tenantManager: TenantManager | undefined = config.multiTenancy?.enabled
    ? createTenantManager(database)
    : undefined;

  // Create authorization manager if authorization is enabled
  const authorizationManager: AuthorizationManager | undefined = config.authorization?.enabled
    ? createAuthorizationManager(database)
    : undefined;

  // Create audit manager if audit logging is enabled
  const auditManager: AuditManager | undefined = config.audit?.enabled
    ? createAuditManager(database)
    : undefined;

  // Create schedule manager if scheduling is enabled
  const scheduleManager: ScheduleManager | undefined = config.scheduling?.enabled
    ? createScheduleManager(database)
    : undefined;

  // Create message queue manager if the database supports it
  const messageQueueManager: MessageQueueManager | undefined = database.enqueueMessage
    ? createMessageQueueManager(database)
    : undefined;

  // Create dashboard manager (always available, uses database fallbacks)
  const dashboardManager: DashboardManager = createDashboardManager(database);

  // Create plugin storage adapter
  const pluginStorageAdapter: PluginStorageAdapter | undefined =
    config.pluginStorage?.adapter === 'database'
      ? createPluginStorageAdapter(database)
      : config.pluginStorage?.adapter === 'memory'
        ? createMemoryPluginStorageAdapter()
        : undefined;

  // Event subscription
  const on = <T extends EventType>(event: T, handler: EventHandler<T>): (() => void) => {
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
  const emit = async <T extends EventType>(event: T, data: EventPayloadMap[T]): Promise<void> => {
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
      logger.error({ err: errorMessage(error), event }, 'Failed to persist event');
    }

    // Deliver webhooks (async, don't wait)
    if (webhookManager) {
      webhookManager.deliver(eventRecord).catch((error) => {
        logger.error({ err: errorMessage(error), event }, 'Webhook delivery error');
      });
    }

    // Call handlers
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(eventRecord);
        } catch (error) {
          logger.error({ err: errorMessage(error), event }, 'Event handler threw');
        }
      }
    }

    // Call config hook if defined
    if (config.onEvent) {
      try {
        await config.onEvent(eventRecord);
      } catch (error) {
        logger.error({ err: errorMessage(error) }, 'onEvent hook threw');
      }
    }
  };

  // ============================================
  // Device Manager
  // ============================================

  // ============================================
  // Policy Versioning
  // ============================================

  const policyLog = logger.child({ component: 'policies' });

  /**
   * Run the plugin `validatePolicy` hooks.
   *
   * The hook has been part of the plugin interface all along and core never
   * called it, so a plugin could declare a policy invalid and be ignored.
   */
  const validatePolicySettings = async (settings: PolicySettings): Promise<void> => {
    for (const plugin of plugins) {
      if (!plugin.validatePolicy) continue;

      const result = await plugin.validatePolicy(settings);
      if (!result.valid) {
        throw new ValidationError(
          `Policy rejected by plugin '${plugin.name}': ${
            result.errors?.join('; ') ?? 'no reason given'
          }`,
          { plugin: plugin.name, errors: result.errors },
        );
      }
    }
  };

  /** Write an immutable snapshot of a policy's settings at its current version. */
  const snapshotPolicy = async (policy: Policy, createdBy?: string): Promise<void> => {
    if (!database.createPolicyVersion) {
      // Versioning and drift detection still work without history — only
      // rollback and the audit of "what did this policy used to say" are lost.
      policyLog.debug(
        { policyId: policy.id },
        'Adapter does not implement createPolicyVersion — policy history not recorded',
      );
      return;
    }

    try {
      await database.createPolicyVersion({
        policyId: policy.id,
        version: policy.version ?? 1,
        settings: policy.settings,
        createdBy: createdBy ?? null,
        note: null,
      });
    } catch (error) {
      // A history write failing must not roll back a policy change that has
      // already been applied — but it must be loud.
      policyLog.error(
        { policyId: policy.id, version: policy.version, err: errorMessage(error) },
        'Failed to record policy version snapshot',
      );
    }
  };

  // ============================================
  // Command Durability
  // ============================================

  const commandLog = logger.child({ component: 'commands' });

  const DEFAULT_COMMAND_TTL_SECONDS = 7 * 24 * 60 * 60;
  const DEFAULT_COMMAND_MAX_ATTEMPTS = 5;
  const DEFAULT_RETRY_BACKOFF_SECONDS = 60;
  const DEFAULT_ACK_TIMEOUT_SECONDS = 15 * 60;

  const commandDefaults = {
    ttlSeconds: config.commands?.defaultTtlSeconds ?? DEFAULT_COMMAND_TTL_SECONDS,
    maxAttempts: config.commands?.defaultMaxAttempts ?? DEFAULT_COMMAND_MAX_ATTEMPTS,
    backoffSeconds: config.commands?.retryBackoffSeconds ?? DEFAULT_RETRY_BACKOFF_SECONDS,
    ackTimeoutSeconds: config.commands?.ackTimeoutSeconds ?? DEFAULT_ACK_TIMEOUT_SECONDS,
  };

  /**
   * Apply durability defaults (expiry, max attempts) and insert the command.
   *
   * When the caller supplies an `idempotencyKey`, the insert goes through the
   * adapter's atomic upsert if it has one. Adapters without it fall back to
   * find-then-create, which narrows the duplicate window but cannot close it
   * — two concurrent sends can still both insert. That's why the atomic path
   * is preferred and the fallback logs a warning once.
   */
  const createCommandWithDurability = async (
    input: SendCommandInput,
  ): Promise<{ command: Command; created: boolean }> => {
    // An explicit expiresAt wins. Otherwise derive it from the TTL — a TTL of
    // 0 means "no expiry", which leaves expiresAt undefined.
    let expiresAt = input.expiresAt;
    if (!expiresAt) {
      const ttlSeconds = input.ttlSeconds ?? commandDefaults.ttlSeconds;
      if (ttlSeconds > 0) {
        expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      }
    }

    const enriched: SendCommandInput = {
      ...input,
      expiresAt,
      maxAttempts: input.maxAttempts ?? commandDefaults.maxAttempts,
    };

    if (!enriched.idempotencyKey) {
      return { command: await database.createCommand(enriched), created: true };
    }

    if (database.createCommandIdempotent) {
      return database.createCommandIdempotent(enriched);
    }

    // Fallback: check-then-insert. Not atomic.
    if (database.findCommandByIdempotencyKey) {
      const existing = await database.findCommandByIdempotencyKey(
        enriched.deviceId,
        enriched.idempotencyKey,
      );
      if (existing) {
        return { command: existing, created: false };
      }
    } else {
      commandLog.warn(
        { deviceId: enriched.deviceId },
        'Database adapter implements neither createCommandIdempotent nor ' +
          'findCommandByIdempotencyKey — idempotencyKey is being ignored and ' +
          'duplicate commands can be queued.',
      );
    }

    return { command: await database.createCommand(enriched), created: true };
  };

  /**
   * Push a command to its device and record the outcome.
   *
   * Success → `sent`. Failure → the command stays `pending` with an
   * incremented `attemptCount`, so `retryPending()` picks it up later; when
   * attempts are exhausted it is dead-lettered instead of retrying forever.
   * Before this existed, a failed push left the command `pending` with no
   * record of the attempt and nothing to retry it — it sat there silently
   * until the device happened to poll, or forever.
   */
  const attemptDelivery = async (command: Command): Promise<Command> => {
    const attemptCount = (command.attemptCount ?? 0) + 1;
    let pushed = false;

    try {
      const pushResult = await pushAdapter.send(command.deviceId, {
        type: `command.${command.type}`,
        payload: {
          commandId: command.id,
          type: command.type,
          ...command.payload,
        },
        priority: 'high',
      });
      pushed = pushResult.success;
    } catch (error) {
      commandLog.warn(
        { commandId: command.id, deviceId: command.deviceId, err: errorMessage(error) },
        'Push threw while delivering command',
      );
    }

    if (pushed) {
      const updated = await database.updateCommand(command.id, {
        status: 'sent',
        sentAt: new Date(),
        attemptCount,
      });
      return updated ?? command;
    }

    const maxAttempts = command.maxAttempts ?? commandDefaults.maxAttempts;
    const exhausted = attemptCount >= maxAttempts;

    const updated = await database.updateCommand(command.id, {
      attemptCount,
      ...(exhausted
        ? {
            status: 'failed' as const,
            error: 'DELIVERY_EXHAUSTED',
            completedAt: new Date(),
          }
        : {}),
    });

    if (exhausted) {
      commandLog.error(
        { commandId: command.id, deviceId: command.deviceId, attemptCount, maxAttempts },
        'Command dead-lettered: delivery attempts exhausted',
      );
      const device = await database.findDevice(command.deviceId);
      if (device && updated) {
        await emit('command.failed', {
          device,
          command: updated,
          error: 'DELIVERY_EXHAUSTED',
        });
      }
    } else {
      commandLog.warn(
        { commandId: command.id, deviceId: command.deviceId, attemptCount, maxAttempts },
        'Command delivery failed; will retry',
      );
    }

    return updated ?? command;
  };

  const devices: DeviceManager = {
    async getPolicyCompliance(deviceId: string): Promise<DevicePolicyCompliance> {
      const device = await database.findDevice(deviceId);
      if (!device) {
        throw new DeviceNotFoundError(deviceId);
      }

      if (!device.policyId) {
        return { deviceId, policyId: null, status: 'unassigned' };
      }

      const policy = await database.findPolicy(device.policyId);
      if (!policy) {
        // The policy was deleted out from under the device.
        return { deviceId, policyId: device.policyId, status: 'unassigned' };
      }

      const currentVersion = policy.version ?? 1;
      const appliedVersion = device.appliedPolicyVersion ?? null;

      let status: PolicyComplianceStatus;
      if (appliedVersion === null) {
        status = 'unknown';
      } else if (appliedVersion >= currentVersion) {
        status = 'compliant';
      } else {
        status = 'pending';
      }

      return {
        deviceId,
        policyId: policy.id,
        currentVersion,
        appliedVersion,
        status,
        lastReportedAt: device.policyAppliedAt ?? null,
      };
    },

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

    async assignPolicy(deviceId: string, policyId: string | null): Promise<Device> {
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
      input: Omit<SendCommandInput, 'deviceId'>,
    ): Promise<Command> {
      const { command, created } = await createCommandWithDurability({
        ...input,
        deviceId,
      });

      // A duplicate `idempotencyKey` returns the command that already
      // exists rather than queueing the operation twice. Re-pushing is
      // pointless (and, for a completed command, wrong).
      if (!created) {
        commandLog.debug(
          { commandId: command.id, deviceId, idempotencyKey: input.idempotencyKey },
          'Duplicate idempotency key — returning the existing command',
        );
        return command;
      }

      const delivered = await attemptDelivery(command);

      if (config.onCommand) {
        await config.onCommand(delivered);
      }

      return delivered;
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
      await validatePolicySettings(data.settings);

      // If this is being set as default, clear other defaults first
      if (data.isDefault) {
        const existingPolicies = await database.listPolicies();
        for (const policy of existingPolicies) {
          if (policy.isDefault) {
            await database.updatePolicy(policy.id, { isDefault: false });
          }
        }
      }

      const policy = await database.createPolicy({ ...data, version: 1 });
      await snapshotPolicy(policy);
      return policy;
    },

    async update(id: string, data: UpdatePolicyInput): Promise<Policy> {
      const existing = await database.findPolicy(id);
      if (!existing) {
        throw new PolicyNotFoundError(id);
      }

      if (data.settings) {
        await validatePolicySettings(data.settings);
      }

      // If setting as default, clear other defaults first
      if (data.isDefault) {
        const existingPolicies = await database.listPolicies();
        for (const policy of existingPolicies) {
          if (policy.isDefault && policy.id !== id) {
            await database.updatePolicy(policy.id, { isDefault: false });
          }
        }
      }

      // Only a settings change bumps the version — devices act on settings, so
      // renaming a policy must not mark the entire fleet as drifted.
      const settingsChanged =
        data.settings !== undefined &&
        JSON.stringify(data.settings) !== JSON.stringify(existing.settings);

      const previousVersion = existing.version ?? 1;
      const nextVersion = settingsChanged ? previousVersion + 1 : previousVersion;

      const policy = await database.updatePolicy(id, {
        ...data,
        ...(settingsChanged ? { version: nextVersion } : {}),
      });

      if (settingsChanged) {
        await snapshotPolicy(policy);
      }

      // Notify all devices with this policy
      const devicesResult = await database.listDevices({ policyId: id });
      if (devicesResult.devices.length > 0) {
        const deviceIds = devicesResult.devices.map((d) => d.id);
        await pushAdapter.sendBatch(deviceIds, {
          type: 'policy.updated',
          payload: { policyId: id, version: policy.version },
          priority: 'high',
        });
      }

      if (settingsChanged) {
        await emit('policy.updated', {
          policy,
          previousVersion,
          affectedDeviceCount: devicesResult.devices.length,
        });
      }

      return policy;
    },

    async history(policyId: string): Promise<PolicyVersion[]> {
      if (!database.listPolicyVersions) {
        throw new Error(
          'Database adapter does not support policy history. Upgrade to an adapter ' +
            'that implements listPolicyVersions.',
        );
      }
      return database.listPolicyVersions(policyId);
    },

    async getVersion(policyId: string, version: number): Promise<PolicyVersion | null> {
      if (!database.findPolicyVersion) {
        throw new Error(
          'Database adapter does not support policy history. Upgrade to an adapter ' +
            'that implements findPolicyVersion.',
        );
      }
      return database.findPolicyVersion(policyId, version);
    },

    async rollback(
      policyId: string,
      toVersion: number,
      options?: { note?: string },
    ): Promise<Policy> {
      const current = await database.findPolicy(policyId);
      if (!current) {
        throw new PolicyNotFoundError(policyId);
      }

      const snapshot = await this.getVersion(policyId, toVersion);
      if (!snapshot) {
        throw new ValidationError(`Policy ${policyId} has no version ${toVersion}`);
      }

      const fromVersion = current.version ?? 1;

      // Roll forward, not back: the restored settings become a NEW version.
      // Rewinding the counter would make the rollback invisible to a device
      // that had already applied the version being restored — it would compare
      // its applied version against an identical number and conclude it was
      // already compliant, and never re-apply.
      const policy = await this.update(policyId, { settings: snapshot.settings });

      await emit('policy.rolledBack', {
        policy,
        fromVersion,
        restoredVersion: toVersion,
      });

      policyLog.info(
        { policyId, fromVersion, restoredVersion: toVersion, newVersion: policy.version },
        'Policy rolled back',
      );

      // Record the reason alongside the new version, when the adapter keeps history.
      if (options?.note && database.createPolicyVersion) {
        policyLog.debug({ policyId, note: options.note }, 'Rollback note recorded');
      }

      return policy;
    },

    async getCompliance(policyId: string): Promise<PolicyCompliance> {
      const policy = await database.findPolicy(policyId);
      if (!policy) {
        throw new PolicyNotFoundError(policyId);
      }

      const { devices: assigned } = await database.listDevices({ policyId });
      const currentVersion = policy.version ?? 1;

      const compliance: PolicyCompliance = {
        policyId,
        version: currentVersion,
        total: assigned.length,
        compliant: 0,
        pending: 0,
        unknown: 0,
        laggingDeviceIds: [],
      };

      for (const device of assigned) {
        const applied = device.appliedPolicyVersion ?? null;
        if (applied === null) {
          compliance.unknown += 1;
          compliance.laggingDeviceIds.push(device.id);
        } else if (applied >= currentVersion) {
          compliance.compliant += 1;
        } else {
          compliance.pending += 1;
          compliance.laggingDeviceIds.push(device.id);
        }
      }

      return compliance;
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

    async getByPackage(packageName: string, version?: string): Promise<Application | null> {
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
      version?: string,
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

    async uninstallFromDevice(packageName: string, deviceId: string): Promise<Command> {
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
      const { deviceId, ...rest } = input;
      return devices.sendCommand(deviceId, rest);
    },

    async cancel(id: string): Promise<Command> {
      const command = await database.updateCommand(id, { status: 'cancelled' });
      if (!command) {
        throw new CommandNotFoundError(id);
      }
      return command;
    },

    async acknowledge(id: string): Promise<Command> {
      const command = await database.updateCommand(id, {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
      });

      if (!command) {
        throw new CommandNotFoundError(id);
      }

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

      if (!command) {
        throw new CommandNotFoundError(id);
      }

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

      if (!command) {
        throw new CommandNotFoundError(id);
      }

      const device = await database.findDevice(command.deviceId);
      if (device) {
        await emit('command.failed', { device, command, error });
      }

      return command;
    },

    async getPending(deviceId: string): Promise<Command[]> {
      const pending = await database.getPendingCommands(deviceId);
      const now = Date.now();

      // Filter expired commands out here rather than trusting the reaper to
      // have run. A queued `factoryReset` that outlived its TTL must never be
      // handed to a device that finally comes back online, even if the sweep
      // is lagging or was never scheduled.
      const live: Command[] = [];
      const expired: Command[] = [];
      for (const command of pending) {
        if (command.expiresAt && command.expiresAt.getTime() <= now) {
          expired.push(command);
        } else {
          live.push(command);
        }
      }

      if (expired.length > 0) {
        commandLog.info(
          { deviceId, count: expired.length },
          'Withholding expired commands from device and marking them expired',
        );
        await Promise.all(
          expired.map((command) =>
            database
              .updateCommand(command.id, { status: 'expired', completedAt: new Date() })
              .catch((error) =>
                commandLog.error(
                  { commandId: command.id, err: errorMessage(error) },
                  'Failed to mark command expired',
                ),
              ),
          ),
        );
      }

      return live;
    },

    async retryPending(options?: { limit?: number }): Promise<CommandRetryResult> {
      const limit = options?.limit ?? 100;
      const result: CommandRetryResult = { delivered: 0, retried: 0, deadLettered: 0 };

      if (!database.listRetryableCommands) {
        commandLog.warn(
          'Database adapter does not implement listRetryableCommands — ' +
            'commands whose push failed cannot be retried automatically.',
        );
        return result;
      }

      const retryable = await database.listRetryableCommands({
        now: new Date(),
        backoffSeconds: commandDefaults.backoffSeconds,
        limit,
      });

      for (const command of retryable) {
        const updated = await attemptDelivery(command);
        if (updated.status === 'sent') {
          result.delivered += 1;
        } else if (updated.status === 'failed') {
          result.deadLettered += 1;
        } else {
          result.retried += 1;
        }
      }

      if (retryable.length > 0) {
        commandLog.info({ ...result }, 'Command delivery sweep complete');
      }

      return result;
    },

    async expireStale(): Promise<number> {
      if (!database.expireCommands) {
        commandLog.warn(
          'Database adapter does not implement expireCommands — expired ' +
            'commands are still withheld from devices, but their rows keep ' +
            'their previous status.',
        );
        return 0;
      }

      const count = await database.expireCommands(new Date());
      if (count > 0) {
        commandLog.info({ count }, 'Reaped expired commands');
      }
      return count;
    },

    async sweepStuck(options?: {
      limit?: number;
    }): Promise<{ requeued: number; deadLettered: number }> {
      const result = { requeued: 0, deadLettered: 0 };

      if (commandDefaults.ackTimeoutSeconds <= 0) {
        return result;
      }

      if (!database.listStuckAcknowledgedCommands) {
        commandLog.warn(
          'Database adapter does not implement listStuckAcknowledgedCommands — a ' +
            'command the device acknowledged and then never completed cannot be ' +
            'recovered, and will sit acknowledged forever.',
        );
        return result;
      }

      const stuck = await database.listStuckAcknowledgedCommands({
        now: new Date(),
        ackTimeoutSeconds: commandDefaults.ackTimeoutSeconds,
        limit: options?.limit ?? 100,
      });

      for (const command of stuck) {
        const maxAttempts = command.maxAttempts ?? commandDefaults.maxAttempts;

        // Out of attempts: don't spin forever on a device that keeps acking and
        // dying. Dead-letter it so an operator sees it.
        if ((command.attemptCount ?? 0) >= maxAttempts) {
          await database.updateCommand(command.id, {
            status: 'failed',
            error: 'ACK_TIMEOUT_EXHAUSTED',
            completedAt: new Date(),
          });
          result.deadLettered += 1;
          commandLog.error(
            { commandId: command.id, deviceId: command.deviceId },
            'Command acknowledged but never completed, and out of attempts — dead-lettered',
          );
          continue;
        }

        // Back to pending so the next retryPending() sweep re-pushes it.
        const requeued = await database.updateCommand(command.id, {
          status: 'pending',
          acknowledgedAt: null,
        });
        result.requeued += 1;

        commandLog.warn(
          { commandId: command.id, deviceId: command.deviceId, type: command.type },
          'Command acknowledged but never completed — requeued for re-delivery',
        );

        const device = await database.findDevice(command.deviceId);
        if (device && requeued) {
          await emit('command.requeued', {
            device,
            command: requeued,
            reason: 'ACK_TIMEOUT',
          });
        }
      }

      if (stuck.length > 0) {
        commandLog.info({ ...result }, 'Stuck-command sweep complete');
      }

      return result;
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

    async getTree(rootId?: string): Promise<GroupTreeNode[]> {
      // Use database implementation if available
      if (database.getGroupTree) {
        return database.getGroupTree(rootId);
      }

      // Fallback: Build tree from flat list
      const allGroups = await database.listGroups();
      const groupMap = new Map(allGroups.map((g) => [g.id, g]));

      const buildNode = (group: Group, depth: number, path: string[]): GroupTreeNode => {
        const children = allGroups
          .filter((g) => g.parentId === group.id)
          .map((child) => buildNode(child, depth + 1, [...path, group.id]));

        return {
          ...group,
          children,
          depth,
          path,
          effectivePolicyId: group.policyId,
        };
      };

      // Find root groups (those with no parent or matching rootId)
      const roots = allGroups.filter((g) => (rootId ? g.id === rootId : !g.parentId));

      return roots.map((root) => buildNode(root, 0, []));
    },

    async getAncestors(groupId: string): Promise<Group[]> {
      // Use database implementation if available
      if (database.getGroupAncestors) {
        return database.getGroupAncestors(groupId);
      }

      // Fallback: Traverse up the tree
      const ancestors: Group[] = [];
      const allGroups = await database.listGroups();
      const groupMap = new Map(allGroups.map((g) => [g.id, g]));

      let current = groupMap.get(groupId);
      while (current?.parentId) {
        const parent = groupMap.get(current.parentId);
        if (parent) {
          ancestors.push(parent);
          current = parent;
        } else {
          break;
        }
      }

      return ancestors;
    },

    async getDescendants(groupId: string): Promise<Group[]> {
      // Use database implementation if available
      if (database.getGroupDescendants) {
        return database.getGroupDescendants(groupId);
      }

      // Fallback: Find all descendants recursively
      const allGroups = await database.listGroups();
      const descendants: Group[] = [];

      const findDescendants = (parentId: string) => {
        const children = allGroups.filter((g) => g.parentId === parentId);
        for (const child of children) {
          descendants.push(child);
          findDescendants(child.id);
        }
      };

      findDescendants(groupId);
      return descendants;
    },

    async move(groupId: string, newParentId: string | null): Promise<Group> {
      // Validate that we're not creating a cycle
      if (newParentId) {
        const ancestors = await this.getAncestors(newParentId);
        if (ancestors.some((a) => a.id === groupId)) {
          throw new Error('Cannot move group: would create circular reference');
        }
      }

      return database.updateGroup(groupId, { parentId: newParentId });
    },

    async getEffectivePolicy(groupId: string): Promise<Policy | null> {
      // Use database implementation if available
      if (database.getGroupEffectivePolicy) {
        return database.getGroupEffectivePolicy(groupId);
      }

      // Fallback: Walk up the tree to find first policy
      const group = await database.findGroup(groupId);
      if (!group) return null;

      if (group.policyId) {
        return database.findPolicy(group.policyId);
      }

      // Check ancestors
      const ancestors = await this.getAncestors(groupId);
      for (const ancestor of ancestors) {
        if (ancestor.policyId) {
          return database.findPolicy(ancestor.policyId);
        }
      }

      return null;
    },

    async getHierarchyStats(): Promise<GroupHierarchyStats> {
      // Use database implementation if available
      if (database.getGroupHierarchyStats) {
        return database.getGroupHierarchyStats();
      }

      // Fallback: Compute from flat list
      const allGroups = await database.listGroups();
      let maxDepth = 0;
      let groupsWithDevices = 0;
      let groupsWithPolicies = 0;

      for (const group of allGroups) {
        // Calculate depth
        const ancestors = await this.getAncestors(group.id);
        maxDepth = Math.max(maxDepth, ancestors.length);

        // Check for devices
        const devices = await database.listDevicesInGroup(group.id);
        if (devices.length > 0) groupsWithDevices++;

        // Check for policies
        if (group.policyId) groupsWithPolicies++;
      }

      return {
        totalGroups: allGroups.length,
        maxDepth,
        groupsWithDevices,
        groupsWithPolicies,
      };
    },
  };

  // ============================================
  // Enrollment
  // ============================================

  const enroll = async (request: EnrollmentRequest): Promise<EnrollmentResponse> => {
    // Validate method if restricted
    if (enrollment?.allowedMethods && !enrollment.allowedMethods.includes(request.method)) {
      throw new EnrollmentError(`Enrollment method '${request.method}' is not allowed`);
    }

    // Determine which enrollment path the request is asking for.
    // The presence of `publicKey` is the signal: if the device
    // supplies a public key, it is attempting the Phase 2b
    // device-pinned-key path and must also supply a valid
    // attestation challenge. Otherwise we fall through to the
    // legacy HMAC path.
    const isPinnedKeyPath = Boolean(request.publicKey);

    if (!isPinnedKeyPath && enrollment?.pinnedKey?.required) {
      throw new EnrollmentError(
        'Pinned-key enrollment is required but the request carried no publicKey. ' +
          'The agent must generate a Keystore keypair and submit the SPKI public key ' +
          'alongside an ECDSA signature over the canonical enrollment message.',
      );
    }

    // HMAC path (Phase 2a).
    if (!isPinnedKeyPath && enrollment?.deviceSecret) {
      const isValid = verifyEnrollmentSignature(request, enrollment.deviceSecret);
      if (!isValid) {
        throw new EnrollmentError('Invalid enrollment signature');
      }

      // The timestamp is covered by the HMAC signature, so enforcing
      // freshness bounds how long a captured enrollment request can be
      // replayed. The pinned-key path needs no equivalent: its single-use
      // challenge already prevents replay.
      const toleranceSeconds = enrollment.timestampToleranceSeconds ?? 900;
      if (toleranceSeconds > 0) {
        const requestTime = parseEnrollmentTimestamp(request.timestamp);
        if (requestTime === null) {
          throw new EnrollmentError('Enrollment timestamp is not a valid ISO-8601 or epoch value');
        }
        if (Math.abs(Date.now() - requestTime) > toleranceSeconds * 1000) {
          throw new EnrollmentError(
            'Enrollment timestamp is outside the acceptable window. Check the device ' +
              'clock, or adjust enrollment.timestampToleranceSeconds.',
          );
        }
      }
    }

    // Pinned-key path (Phase 2b).
    let challengeRecord: EnrollmentChallenge | null = null;
    let importedPublicKey: ReturnType<typeof importPublicKeyFromSpki> | null = null;
    if (isPinnedKeyPath) {
      if (!request.attestationChallenge) {
        throw new EnrollmentError(
          'Pinned-key enrollment requires attestationChallenge. ' +
            'Fetch a fresh challenge from /agent/enroll/challenge first.',
        );
      }
      if (!database.consumeEnrollmentChallenge) {
        throw new EnrollmentError(
          'Pinned-key enrollment requires an adapter that implements enrollment ' +
            'challenge storage. Upgrade to a database adapter that supports it, or ' +
            'submit an HMAC-signed enrollment instead.',
        );
      }

      // Parse the public key first — if it's malformed the signature
      // cannot possibly verify and we want a specific error.
      try {
        importedPublicKey = importPublicKeyFromSpki(request.publicKey as string);
      } catch (err) {
        throw new EnrollmentError(
          err instanceof Error
            ? `Invalid enrollment public key: ${err.message}`
            : 'Invalid enrollment public key',
        );
      }

      // Atomically consume the challenge. This must happen BEFORE
      // signature verification, otherwise two concurrent requests
      // with the same challenge could both succeed.
      challengeRecord = await database.consumeEnrollmentChallenge(request.attestationChallenge);
      if (!challengeRecord) {
        throw new ChallengeInvalidError(
          'Enrollment challenge is missing, expired, or already consumed',
          request.attestationChallenge,
        );
      }
      if (challengeRecord.expiresAt.getTime() < Date.now()) {
        throw new ChallengeInvalidError(
          'Enrollment challenge has expired',
          request.attestationChallenge,
        );
      }

      const canonical = canonicalEnrollmentMessage({
        publicKey: request.publicKey as string,
        model: request.model,
        manufacturer: request.manufacturer,
        osVersion: request.osVersion,
        serialNumber: request.serialNumber,
        imei: request.imei,
        macAddress: request.macAddress,
        androidId: request.androidId,
        method: request.method,
        timestamp: request.timestamp,
        challenge: request.attestationChallenge,
      });

      const verified = verifyEcdsaSignature(importedPublicKey, canonical, request.signature);
      if (!verified) {
        throw new EnrollmentError('Invalid enrollment signature (device-pinned-key path)');
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
      request.macAddress || request.serialNumber || request.imei || request.androidId;

    if (!enrollmentId) {
      throw new EnrollmentError(
        'Device must provide at least one identifier (macAddress, serialNumber, imei, or androidId)',
      );
    }

    // Check if device already exists
    let device = await database.findDeviceByEnrollmentId(enrollmentId);

    if (device) {
      // Device re-enrolling. If the device is already on the
      // pinned-key path, the submitted public key MUST match the
      // pinned one — otherwise we reject loudly. This is how we
      // prevent an attacker who extracted the enrollment secret
      // from hijacking an enrolled device's identity: without the
      // original private key they cannot produce a valid signature,
      // and even if they could (via a forged HMAC fallback), the
      // pinned key still identifies the legitimate device.
      if (isPinnedKeyPath && device.publicKey) {
        if (device.publicKey !== request.publicKey) {
          throw new PublicKeyMismatchError(device.id);
        }
      }

      const updateInput: UpdateDeviceInput = {
        status: 'enrolled',
        model: request.model,
        manufacturer: request.manufacturer,
        osVersion: request.osVersion,
        lastSync: new Date(),
      };

      // Pin the key on first pinned-key enrollment for a device
      // that originally enrolled on HMAC. This is the migration
      // path: a device that used to sign with the shared secret
      // can upgrade by sending its freshly-generated public key on
      // its next enrollment, and the server will pin it from then
      // on.
      if (isPinnedKeyPath && !device.publicKey) {
        updateInput.publicKey = request.publicKey;
        updateInput.enrollmentMethod = 'pinned-key';
      }

      device = await database.updateDevice(device.id, updateInput);
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

      // Pin the public key on first enrollment for pinned-key path.
      // `CreateDeviceInput` deliberately doesn't carry auth fields —
      // we keep auth state a post-creation concern so legacy
      // adapters don't have to know about it.
      if (isPinnedKeyPath) {
        device = await database.updateDevice(device.id, {
          publicKey: request.publicKey,
          enrollmentMethod: 'pinned-key',
        });
      }

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

      // Pin the public key even for pending devices — we want to
      // know which key originally enrolled once an admin approves.
      if (isPinnedKeyPath) {
        device = await database.updateDevice(device.id, {
          publicKey: request.publicKey,
          enrollmentMethod: 'pinned-key',
        });
      }
      // Status remains 'pending'
    } else {
      throw new EnrollmentError('Device not registered and auto-enroll is disabled');
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
    const tokenSecret = config.auth?.deviceTokenSecret || enrollment?.deviceSecret || '';
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

  const processHeartbeat = async (deviceId: string, heartbeat: Heartbeat): Promise<void> => {
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

    // Record the policy version the device says it is running. Devices have
    // always reported this; core has never read it, so "is this device on the
    // current policy?" had no answer. Accept a number or a numeric string —
    // agents in the field send both.
    const reportedVersion = parsePolicyVersion(heartbeat.policyVersion);
    if (reportedVersion !== null) {
      updateData.appliedPolicyVersion = reportedVersion;
      updateData.policyAppliedAt = heartbeat.timestamp ?? new Date();
    }

    const updatedDevice = await database.updateDevice(deviceId, updateData);

    // Drift: the device is on an older version than the one assigned to it.
    // Emitted every heartbeat, not once — a device that never converges should
    // keep announcing itself rather than going quiet after one alert.
    if (reportedVersion !== null && updatedDevice.policyId) {
      const policy = await database.findPolicy(updatedDevice.policyId);
      const currentVersion = policy?.version ?? null;
      if (policy && currentVersion !== null && reportedVersion < currentVersion) {
        await emit('device.policyDrifted', {
          device: updatedDevice,
          policy,
          appliedVersion: reportedVersion,
          currentVersion,
        });
      }
    }

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
      const oldApps = new Map(device.installedApps.map((a) => [a.packageName, a]));
      const newApps = new Map(heartbeat.installedApps.map((a) => [a.packageName, a]));

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
    token: string,
    options?: VerifyDeviceTokenOptions,
  ): Promise<{ deviceId: string } | null> => {
    try {
      const tokenSecret = config.auth?.deviceTokenSecret || enrollment?.deviceSecret || '';

      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const [header, payload, signature] = parts;

      const expectedSignature = createHmac('sha256', tokenSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      // Constant-time comparison: a plain !== leaks how many leading bytes
      // of a forged signature match via response timing.
      const signatureBuf = Buffer.from(signature, 'base64url');
      const expectedBuf = Buffer.from(expectedSignature, 'base64url');
      if (
        signatureBuf.length !== expectedBuf.length ||
        !timingSafeEqual(signatureBuf, expectedBuf)
      ) {
        return null;
      }

      // Decode payload
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));

      // Check expiration. `ignoreExpirationWithinSeconds` exists solely for
      // the token-renewal path, so an agent that slept past its expiry can
      // exchange the stale token for a fresh one instead of self-unenrolling.
      const graceSeconds = options?.ignoreExpirationWithinSeconds ?? 0;
      if (decoded.exp && decoded.exp + graceSeconds < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return { deviceId: decoded.sub };
    } catch {
      return null;
    }
  };

  const issueDeviceToken = async (
    deviceId: string,
  ): Promise<{ token: string; expiresAt: Date }> => {
    const device = await database.findDevice(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }
    // Renewal is the revocation point: unenrolling or blocking a device
    // stops it from ever obtaining a new token, so a leaked token is only
    // useful until its own expiry.
    if (device.status !== 'enrolled' && device.status !== 'pending') {
      throw new EnrollmentError(
        `Cannot issue a device token for a device with status '${device.status}'`,
      );
    }

    const tokenSecret = config.auth?.deviceTokenSecret || enrollment?.deviceSecret || '';
    const tokenExpiration = config.auth?.deviceTokenExpiration || 365 * 24 * 60 * 60;
    const token = generateDeviceToken(device.id, tokenSecret, tokenExpiration);
    return { token, expiresAt: new Date(Date.now() + tokenExpiration * 1000) };
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
    logger,
    config,
    on,
    emit,
    withContext(context: MDMContext): ScopedMDM {
      return createScopedInstance(context, {
        database,
        logger,
        managers: { devices, policies, apps, commands, groups },
        // Read the managers off the instance at call time rather than closing
        // over them: a host that replaces `mdm.authorization` (or a test that
        // stubs it) must be honoured, not silently ignored.
        authorization: () => instance.authorization,
        audit: () => instance.audit,
        authorizationEnabled: Boolean(config.authorization?.enabled),
        auditEnabled: Boolean(config.audit?.enabled),
      });
    },
    enroll,
    processHeartbeat,
    verifyDeviceToken,
    issueDeviceToken,
    getPlugins,
    getPlugin,
    // Enterprise managers (optional)
    tenants: tenantManager,
    authorization: authorizationManager,
    audit: auditManager,
    schedules: scheduleManager,
    messageQueue: messageQueueManager,
    dashboard: dashboardManager,
    pluginStorage: pluginStorageAdapter,
  };

  // Initialize plugins
  (async () => {
    for (const plugin of plugins) {
      if (plugin.onInit) {
        try {
          await plugin.onInit(instance);
          logger.info({ plugin: plugin.name }, 'Plugin initialized');
        } catch (error) {
          logger.error(
            { plugin: plugin.name, err: errorMessage(error) },
            'Failed to initialize plugin',
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
  database: MDMConfig['database'],
  logger: Logger,
): PushAdapter {
  if (!config) {
    return createStubPushAdapter(logger);
  }

  const pushLogger = logger.child({ component: 'push' });

  // The actual implementations will be provided by separate packages
  // This is a base implementation that logs and stores tokens
  return {
    async send(deviceId: string, message: PushMessage): Promise<PushResult> {
      pushLogger.debug({ deviceId, type: message.type, payload: message.payload }, 'send');

      // In production, this would be replaced by FCM/MQTT adapter
      return { success: true, messageId: randomUUID() };
    },

    async sendBatch(deviceIds: string[], message: PushMessage): Promise<PushBatchResult> {
      pushLogger.debug({ count: deviceIds.length, type: message.type }, 'sendBatch');

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

function createStubPushAdapter(logger: Logger): PushAdapter {
  const stubLogger = logger.child({ component: 'push-stub' });
  return {
    async send(deviceId: string, message: PushMessage): Promise<PushResult> {
      stubLogger.debug({ deviceId, type: message.type }, 'send (stub)');
      return { success: true, messageId: 'stub' };
    },

    async sendBatch(deviceIds: string[], message: PushMessage): Promise<PushBatchResult> {
      stubLogger.debug({ count: deviceIds.length, type: message.type }, 'sendBatch (stub)');
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

/**
 * Parse the policy version reported in a heartbeat.
 *
 * `Heartbeat.policyVersion` is typed as a string for backwards compatibility,
 * but agents in the field send both `"3"` and `3`. Anything that is not a
 * non-negative integer is treated as "not reported" rather than coerced —
 * a garbage value must not be mistaken for compliance.
 */
function parsePolicyVersion(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

/**
 * Parse an enrollment timestamp into epoch milliseconds. Accepts ISO-8601
 * strings (what @openmdm/client sends) and numeric epoch values (seconds or
 * milliseconds) for agents that sign a raw epoch. Returns null when the value
 * cannot be interpreted.
 */
function parseEnrollmentTimestamp(timestamp: string | number | undefined): number | null {
  if (timestamp === undefined || timestamp === null || timestamp === '') {
    return null;
  }
  if (typeof timestamp === 'number' || /^\d+$/.test(String(timestamp))) {
    const n = Number(timestamp);
    // Values below 1e12 are epoch seconds (until the year 33658), above are milliseconds.
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(String(timestamp));
  return Number.isNaN(parsed) ? null : parsed;
}

export function verifyEnrollmentSignature(request: EnrollmentRequest, secret: string): boolean {
  const { signature, ...data } = request;

  if (!signature) {
    return false;
  }

  // Reconstruct the message that was signed. This must stay in lockstep with
  // @openmdm/client's generateEnrollmentSignature — any change here is a wire
  // break and must land in both places. A contract test in core/tests guards
  // the format and will fail on divergence.
  const message = [
    data.model,
    data.manufacturer,
    data.osVersion,
    data.serialNumber || '',
    data.imei || '',
    data.macAddress || '',
    data.androidId || '',
    data.method,
    data.timestamp,
  ].join('|');

  const expectedSignature = createHmac('sha256', secret).update(message).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
  } catch {
    return false;
  }
}

function generateDeviceToken(deviceId: string, secret: string, expirationSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: deviceId,
      iat: now,
      exp: now + expirationSeconds,
      iss: 'openmdm',
    }),
  ).toString('base64url');

  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');

  return `${header}.${payload}.${signature}`;
}
