/**
 * OpenMDM MQTT Push Adapter
 *
 * MQTT-based push adapter for sending commands to Android devices.
 * Ideal for private networks, air-gapped environments, and self-hosted deployments
 * where FCM cannot be used.
 *
 * @example
 * ```typescript
 * import { createMDM } from '@openmdm/core';
 * import { mqttPushAdapter } from '@openmdm/push-mqtt';
 *
 * const mdm = createMDM({
 *   database: drizzleAdapter(db),
 *   push: mqttPushAdapter({
 *     brokerUrl: 'mqtt://localhost:1883',
 *     // or: brokerUrl: 'mqtts://broker.example.com:8883',
 *     username: 'mdm-server',
 *     password: 'secret',
 *   }),
 * });
 * ```
 */

import type {
  DatabaseAdapter,
  Logger,
  PushAdapter,
  PushBatchResult,
  PushMessage,
  PushResult,
} from '@openmdm/core';
import { createConsoleLogger } from '@openmdm/core';
import * as mqtt from 'mqtt';

export interface MQTTAdapterOptions {
  /**
   * MQTT broker URL
   * Examples: 'mqtt://localhost:1883', 'mqtts://broker.example.com:8883'
   */
  brokerUrl: string;

  /**
   * Username for MQTT authentication
   */
  username?: string;

  /**
   * Password for MQTT authentication
   */
  password?: string;

  /**
   * Client ID prefix (default: 'openmdm-server')
   * A random suffix will be added for uniqueness
   */
  clientIdPrefix?: string;

  /**
   * Topic prefix for device messages (default: 'openmdm/devices')
   * Messages will be published to: {topicPrefix}/{deviceId}/commands
   */
  topicPrefix?: string;

  /**
   * Database adapter for storing/retrieving connection state
   */
  database?: DatabaseAdapter;

  /**
   * Quality of Service level (default: 1)
   * 0 = At most once, 1 = At least once, 2 = Exactly once
   */
  qos?: 0 | 1 | 2;

  /**
   * Whether to retain messages (default: false)
   * Retained messages are delivered to new subscribers
   */
  retain?: boolean;

  /**
   * Message expiry interval in seconds (default: 3600 = 1 hour)
   * MQTT 5.0 feature
   */
  messageExpiryInterval?: number;

  /**
   * TLS/SSL options for secure connections
   */
  tls?: {
    ca?: string | Buffer | string[] | Buffer[];
    cert?: string | Buffer;
    key?: string | Buffer;
    rejectUnauthorized?: boolean;
  };

  /**
   * Reconnection options
   */
  reconnect?: {
    enabled?: boolean;
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };

  /**
   * Clean session flag (default: true)
   * If false, the broker stores subscriptions and queued messages
   */
  cleanSession?: boolean;

  /**
   * Keep-alive interval in seconds (default: 60)
   */
  keepAlive?: number;

  /**
   * Device-acknowledgment behaviour.
   *
   * A publish that reaches the broker is NOT proof the device got it. This
   * adapter therefore waits for the device to ack on `{topicPrefix}/{deviceId}/ack`.
   */
  ack?: {
    /** Wait for a device ack (default: true). */
    enabled?: boolean;
    /** How long to wait before giving up (default: 30000ms). */
    timeoutMs?: number;
    /**
     * Report an un-acked publish as a success (default: **false**).
     *
     * Leave this false. It used to be the hard-coded behaviour, and it is a
     * lie: the caller is told the device received a command it may never have
     * seen, so the command is marked `sent` and never retried. Only set it
     * true if your devices genuinely do not publish acks and you accept
     * fire-and-forget delivery.
     */
    treatTimeoutAsSuccess?: boolean;
  };

  /** Structured logger. Defaults to the console-backed logger from core. */
  logger?: Logger;
}

interface DevicePresence {
  deviceId: string;
  online: boolean;
  lastSeen: Date;
}

/**
 * Internals shared between the base adapter and the extended one.
 *
 * `mqttExtendedAdapter` used to spread the base adapter and then create its
 * OWN empty presence map, so `getDeviceStatus` / `getOnlineDevices` /
 * `isDeviceOnline` always reported "no devices online" no matter what the
 * broker said, and `disconnect()` only logged. Both now read the same state by
 * construction.
 */
interface MqttInternals {
  adapter: PushAdapter;
  devicePresence: Map<string, DevicePresence>;
  disconnect: () => Promise<void>;
}

function createMqttAdapter(options: MQTTAdapterOptions): MqttInternals {
  const topicPrefix = options.topicPrefix ?? 'openmdm/devices';
  const qos = options.qos ?? 1;
  const retain = options.retain ?? false;
  const messageExpiryInterval = options.messageExpiryInterval ?? 3600;
  const database = options.database;
  const log = (options.logger ?? createConsoleLogger()).child({ component: 'push-mqtt' });

  const ackEnabled = options.ack?.enabled ?? true;
  const ackTimeoutMs = options.ack?.timeoutMs ?? 30_000;
  const ackTimeoutIsSuccess = options.ack?.treatTimeoutAsSuccess ?? false;

  // Generate unique client ID
  const clientId = `${options.clientIdPrefix ?? 'openmdm-server'}-${Math.random().toString(36).substring(2, 10)}`;

  // Device presence tracking
  const devicePresence = new Map<string, DevicePresence>();

  // Pending acknowledgments: messageId -> resolve function
  const pendingAcks = new Map<
    string,
    { resolve: (result: PushResult) => void; timeout: NodeJS.Timeout }
  >();

  // Create MQTT client
  const client = mqtt.connect(options.brokerUrl, {
    clientId,
    username: options.username,
    password: options.password,
    clean: options.cleanSession ?? true,
    keepalive: options.keepAlive ?? 60,
    reconnectPeriod:
      options.reconnect?.enabled !== false ? (options.reconnect?.initialDelay ?? 1000) : 0,
    // mqtt.js reconnects on a fixed period rather than an exponential backoff,
    // so `reconnect.maxDelay` and `reconnect.maxRetries` have no direct
    // equivalent. They are enforced below in the 'reconnect' handler instead of
    // being silently ignored, which is what happened before.
    ...(options.tls && {
      ca: options.tls.ca,
      cert: options.tls.cert,
      key: options.tls.key,
      rejectUnauthorized: options.tls.rejectUnauthorized ?? true,
    }),
  });

  // Connection state
  let connected = false;
  let connectionError: Error | null = null;
  let reconnectAttempts = 0;

  const maxReconnectRetries = options.reconnect?.maxRetries;

  client.on('connect', () => {
    connected = true;
    connectionError = null;
    reconnectAttempts = 0;
    log.info('Connected to broker');

    // Subscribe to presence topic for all devices
    client.subscribe(`${topicPrefix}/+/presence`, { qos: 1 }, (err) => {
      if (err) {
        log.error({ err: err.message }, 'Failed to subscribe to presence topic');
      }
    });

    // Subscribe to acknowledgment topic for all devices
    client.subscribe(`${topicPrefix}/+/ack`, { qos: 1 }, (err) => {
      if (err) {
        log.error({ err: err.message }, 'Failed to subscribe to ack topic');
      }
    });
  });

  client.on('disconnect', () => {
    connected = false;
    log.info('Disconnected from broker');
  });

  client.on('error', (err) => {
    connectionError = err;
    log.error({ err: err.message }, 'MQTT connection error');
  });

  client.on('reconnect', () => {
    reconnectAttempts += 1;
    log.warn(
      { attempt: reconnectAttempts, maxRetries: maxReconnectRetries },
      'Reconnecting to broker',
    );

    // `reconnect.maxRetries` was declared in the options and never wired to
    // anything, so a broker that stayed down was retried forever with no way to
    // stop it. Honour the option: give up and surface the failure.
    if (maxReconnectRetries !== undefined && reconnectAttempts > maxReconnectRetries) {
      log.error(
        { attempts: reconnectAttempts, maxRetries: maxReconnectRetries },
        'Giving up on the broker: reconnect.maxRetries exhausted',
      );
      connectionError = new Error(
        `MQTT broker unreachable after ${maxReconnectRetries} reconnect attempts`,
      );
      client.end(true);
    }
  });

  // Handle incoming messages
  client.on('message', (topic, payload) => {
    try {
      const parts = topic.split('/');
      const deviceId = parts[parts.length - 2];
      const messageType = parts[parts.length - 1];

      if (messageType === 'presence') {
        // Device presence update
        const data = JSON.parse(payload.toString());
        devicePresence.set(deviceId, {
          deviceId,
          online: data.online ?? true,
          lastSeen: new Date(),
        });

        log.debug({ deviceId, online: data.online }, 'Device presence changed');
      } else if (messageType === 'ack') {
        // Message acknowledgment
        const data = JSON.parse(payload.toString());
        const messageId = data.messageId;

        if (messageId && pendingAcks.has(messageId)) {
          const pending = pendingAcks.get(messageId)!;
          clearTimeout(pending.timeout);
          pendingAcks.delete(messageId);

          pending.resolve({
            success: true,
            messageId,
          });
        }
      }
    } catch (error) {
      log.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Error processing MQTT message',
      );
    }
  });

  /**
   * Wait for connection to be established
   */
  async function waitForConnection(timeoutMs: number = 5000): Promise<void> {
    if (connected) return;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MQTT connection timeout'));
      }, timeoutMs);

      const checkConnection = () => {
        if (connected) {
          clearTimeout(timeout);
          resolve();
        } else if (connectionError) {
          clearTimeout(timeout);
          reject(connectionError);
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      checkConnection();
    });
  }

  /**
   * Generate unique message ID
   */
  function generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Build MQTT message payload from OpenMDM push message
   */
  function buildPayload(message: PushMessage, messageId: string): string {
    return JSON.stringify({
      messageId,
      type: message.type,
      payload: message.payload,
      priority: message.priority ?? 'normal',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Publish message to device
   */
  async function publishToDevice(
    deviceId: string,
    message: PushMessage,
    waitForAck: boolean = ackEnabled,
  ): Promise<PushResult> {
    await waitForConnection();

    const messageId = generateMessageId();
    const topic = `${topicPrefix}/${deviceId}/commands`;
    const payload = buildPayload(message, messageId);

    return new Promise((resolve) => {
      // Set up acknowledgment waiting if requested
      if (waitForAck) {
        const timeout = setTimeout(() => {
          pendingAcks.delete(messageId);

          // A publish accepted by the broker is NOT proof the device saw it.
          // This used to resolve `success: true` on timeout, which told the
          // caller a command had been delivered to a device that may have been
          // offline for a week — core marked the command `sent` and never
          // retried it. Report the truth and let the retry sweep do its job.
          if (ackTimeoutIsSuccess) {
            log.warn(
              { deviceId, messageId, ackTimeoutMs },
              'Device did not acknowledge; reporting success because ack.treatTimeoutAsSuccess is set',
            );
            resolve({ success: true, messageId });
            return;
          }

          log.warn(
            { deviceId, messageId, ackTimeoutMs },
            'Device did not acknowledge the published message within the ack timeout',
          );
          resolve({
            success: false,
            messageId,
            error: `ACK_TIMEOUT: published to broker but ${deviceId} did not acknowledge within ${ackTimeoutMs}ms`,
          });
        }, ackTimeoutMs);

        pendingAcks.set(messageId, { resolve, timeout });
      }

      // Publish message
      client.publish(
        topic,
        payload,
        {
          qos,
          retain,
          properties: {
            messageExpiryInterval,
          },
        },
        (err) => {
          if (err) {
            if (waitForAck && pendingAcks.has(messageId)) {
              const pending = pendingAcks.get(messageId)!;
              clearTimeout(pending.timeout);
              pendingAcks.delete(messageId);
            }

            resolve({
              success: false,
              error: err.message,
            });
          } else if (!waitForAck) {
            resolve({
              success: true,
              messageId,
            });
          }
          // If waiting for ack, resolution happens in the message handler
        },
      );
    });
  }

  const adapter: PushAdapter = {
    async send(deviceId: string, message: PushMessage): Promise<PushResult> {
      try {
        const result = await publishToDevice(deviceId, message);

        if (result.success) {
          log.debug(
            { deviceId, type: message.type, messageId: result.messageId },
            'Message delivered',
          );
        } else {
          log.warn({ deviceId, err: result.error }, 'Message delivery failed');
        }

        return result;
      } catch (error: any) {
        log.error(
          { deviceId, err: error instanceof Error ? error.message : String(error) },
          'Error sending message',
        );
        return {
          success: false,
          error: error.message || 'MQTT send failed',
        };
      }
    },

    async sendBatch(deviceIds: string[], message: PushMessage): Promise<PushBatchResult> {
      const results: Array<{ deviceId: string; result: PushResult }> = [];
      let successCount = 0;
      let failureCount = 0;

      // Send to all devices in parallel (don't wait for individual acks)
      const promises = deviceIds.map(async (deviceId) => {
        const result = await publishToDevice(deviceId, message, false);
        return { deviceId, result };
      });

      const settledResults = await Promise.all(promises);

      for (const { deviceId, result } of settledResults) {
        results.push({ deviceId, result });
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
        }
      }

      log.info({ successCount, failureCount }, 'Batch send complete');

      return { successCount, failureCount, results };
    },

    async registerToken(deviceId: string, token: string): Promise<void> {
      // For MQTT, the "token" could be used as a custom device identifier
      // or stored as metadata. The device connects directly via MQTT.
      if (database) {
        await database.upsertPushToken({
          deviceId,
          provider: 'mqtt',
          token: token || deviceId, // Use deviceId as token if not provided
        });
      }

      log.debug({ deviceId }, 'Registered device');
    },

    async unregisterToken(deviceId: string): Promise<void> {
      devicePresence.delete(deviceId);

      if (database) {
        await database.deletePushToken(deviceId, 'mqtt');
      }

      log.debug({ deviceId }, 'Unregistered device');
    },

    async subscribe(deviceId: string, topic: string): Promise<void> {
      // For MQTT, we can add the device to a topic group
      // The device itself subscribes to the topic
      const fullTopic = `${topicPrefix}/topics/${topic}`;

      await waitForConnection();

      // Publish a subscription request that the device can act on
      const payload = JSON.stringify({
        action: 'subscribe',
        topic,
        deviceId,
        timestamp: new Date().toISOString(),
      });

      return new Promise((resolve, reject) => {
        client.publish(`${topicPrefix}/${deviceId}/subscribe`, payload, { qos: 1 }, (err) => {
          if (err) {
            reject(err);
          } else {
            log.debug({ deviceId, topic }, 'Requested device to subscribe to topic');
            resolve();
          }
        });
      });
    },

    async unsubscribe(deviceId: string, topic: string): Promise<void> {
      await waitForConnection();

      const payload = JSON.stringify({
        action: 'unsubscribe',
        topic,
        deviceId,
        timestamp: new Date().toISOString(),
      });

      return new Promise((resolve, reject) => {
        client.publish(`${topicPrefix}/${deviceId}/unsubscribe`, payload, { qos: 1 }, (err) => {
          if (err) {
            reject(err);
          } else {
            log.debug({ deviceId, topic }, 'Requested device to unsubscribe from topic');
            resolve();
          }
        });
      });
    },

    disconnect,
  };

  /**
   * Close the broker connection and settle everything still in flight.
   *
   * Without this the MQTT socket, its reconnect timer, and every pending ack
   * timer leak for the life of the process. Callers awaiting an ack are
   * resolved as failures rather than left hanging forever.
   */
  async function disconnect(): Promise<void> {
    for (const [messageId, pending] of pendingAcks) {
      clearTimeout(pending.timeout);
      pending.resolve({
        success: false,
        messageId,
        error: 'ADAPTER_DISCONNECTED: the MQTT adapter shut down before the device acknowledged',
      });
    }
    pendingAcks.clear();

    await new Promise<void>((resolve) => {
      client.end(false, {}, () => {
        log.info('Disconnected from broker');
        resolve();
      });
    });
  }

  return { adapter, devicePresence, disconnect };
}

/**
 * Create an MQTT push adapter for OpenMDM.
 */
export function mqttPushAdapter(options: MQTTAdapterOptions): PushAdapter {
  return createMqttAdapter(options).adapter;
}

/**
 * Create MQTT adapter from environment variables
 *
 * Expects:
 * - MQTT_BROKER_URL: MQTT broker URL
 * - MQTT_USERNAME: (optional) Username
 * - MQTT_PASSWORD: (optional) Password
 */
export function mqttPushAdapterFromEnv(options?: Partial<MQTTAdapterOptions>): PushAdapter {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    throw new Error('MQTT_BROKER_URL environment variable is required');
  }

  return mqttPushAdapter({
    ...options,
    brokerUrl,
    username: process.env.MQTT_USERNAME ?? options?.username,
    password: process.env.MQTT_PASSWORD ?? options?.password,
  });
}

/**
 * Additional utility types for MQTT-specific features
 */
export interface MQTTDeviceStatus {
  deviceId: string;
  online: boolean;
  lastSeen: Date;
  subscriptions?: string[];
}

/**
 * Extended MQTT adapter with device presence tracking
 */
export interface MQTTExtendedAdapter extends PushAdapter {
  /**
   * Get device online status
   */
  getDeviceStatus(deviceId: string): MQTTDeviceStatus | undefined;

  /**
   * Get all online devices
   */
  getOnlineDevices(): MQTTDeviceStatus[];

  /**
   * Check if device is currently online
   */
  isDeviceOnline(deviceId: string): boolean;

  /**
   * Disconnect from MQTT broker
   */
  disconnect(): Promise<void>;
}

/**
 * Create an extended MQTT adapter with device presence tracking
 */
export function mqttExtendedAdapter(options: MQTTAdapterOptions): MQTTExtendedAdapter {
  // Reads the SAME presence map the broker subscription writes to.
  //
  // This function used to call mqttPushAdapter(), spread the result, and then
  // create its own empty `devicePresence` map — one the presence subscription
  // never touched. So getDeviceStatus() always returned undefined,
  // getOnlineDevices() always returned [], and isDeviceOnline() always returned
  // false, no matter how many devices were connected. An operator asking "which
  // devices are online?" was told "none", forever.
  const { adapter, devicePresence, disconnect } = createMqttAdapter(options);

  return {
    ...adapter,

    getDeviceStatus(deviceId: string): MQTTDeviceStatus | undefined {
      return devicePresence.get(deviceId);
    },

    getOnlineDevices(): MQTTDeviceStatus[] {
      return Array.from(devicePresence.values()).filter((d) => d.online);
    },

    isDeviceOnline(deviceId: string): boolean {
      return devicePresence.get(deviceId)?.online ?? false;
    },

    disconnect,
  };
}
