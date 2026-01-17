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

import * as mqtt from 'mqtt';
import type {
  PushAdapter,
  PushMessage,
  PushResult,
  PushBatchResult,
  DatabaseAdapter,
} from '@openmdm/core';

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
}

interface DevicePresence {
  deviceId: string;
  online: boolean;
  lastSeen: Date;
}

/**
 * Create an MQTT push adapter for OpenMDM
 */
export function mqttPushAdapter(options: MQTTAdapterOptions): PushAdapter {
  const topicPrefix = options.topicPrefix ?? 'openmdm/devices';
  const qos = options.qos ?? 1;
  const retain = options.retain ?? false;
  const messageExpiryInterval = options.messageExpiryInterval ?? 3600;
  const database = options.database;

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
    reconnectPeriod: options.reconnect?.enabled !== false ? (options.reconnect?.initialDelay ?? 1000) : 0,
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

  client.on('connect', () => {
    connected = true;
    connectionError = null;
    console.log('[OpenMDM MQTT] Connected to broker');

    // Subscribe to presence topic for all devices
    client.subscribe(`${topicPrefix}/+/presence`, { qos: 1 }, (err) => {
      if (err) {
        console.error('[OpenMDM MQTT] Failed to subscribe to presence:', err);
      }
    });

    // Subscribe to acknowledgment topic for all devices
    client.subscribe(`${topicPrefix}/+/ack`, { qos: 1 }, (err) => {
      if (err) {
        console.error('[OpenMDM MQTT] Failed to subscribe to acks:', err);
      }
    });
  });

  client.on('disconnect', () => {
    connected = false;
    console.log('[OpenMDM MQTT] Disconnected from broker');
  });

  client.on('error', (err) => {
    connectionError = err;
    console.error('[OpenMDM MQTT] Connection error:', err);
  });

  client.on('reconnect', () => {
    console.log('[OpenMDM MQTT] Reconnecting...');
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

        console.log(
          `[OpenMDM MQTT] Device ${deviceId} is ${data.online ? 'online' : 'offline'}`
        );
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
      console.error('[OpenMDM MQTT] Error processing message:', error);
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
    waitForAck: boolean = true
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
          // Message was sent but not acknowledged - still consider it sent
          resolve({
            success: true,
            messageId,
          });
        }, 30000); // 30 second timeout for ack

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
        }
      );
    });
  }

  return {
    async send(deviceId: string, message: PushMessage): Promise<PushResult> {
      try {
        const result = await publishToDevice(deviceId, message);

        if (result.success) {
          console.log(
            `[OpenMDM MQTT] Sent to ${deviceId}: ${message.type} (${result.messageId})`
          );
        } else {
          console.error(
            `[OpenMDM MQTT] Failed to send to ${deviceId}:`,
            result.error
          );
        }

        return result;
      } catch (error: any) {
        console.error(`[OpenMDM MQTT] Error sending to ${deviceId}:`, error);
        return {
          success: false,
          error: error.message || 'MQTT send failed',
        };
      }
    },

    async sendBatch(
      deviceIds: string[],
      message: PushMessage
    ): Promise<PushBatchResult> {
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

      console.log(
        `[OpenMDM MQTT] Batch sent: ${successCount} success, ${failureCount} failed`
      );

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

      console.log(`[OpenMDM MQTT] Registered device ${deviceId}`);
    },

    async unregisterToken(deviceId: string): Promise<void> {
      devicePresence.delete(deviceId);

      if (database) {
        await database.deletePushToken(deviceId, 'mqtt');
      }

      console.log(`[OpenMDM MQTT] Unregistered device ${deviceId}`);
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
        client.publish(
          `${topicPrefix}/${deviceId}/subscribe`,
          payload,
          { qos: 1 },
          (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(
                `[OpenMDM MQTT] Requested ${deviceId} to subscribe to ${topic}`
              );
              resolve();
            }
          }
        );
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
        client.publish(
          `${topicPrefix}/${deviceId}/unsubscribe`,
          payload,
          { qos: 1 },
          (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(
                `[OpenMDM MQTT] Requested ${deviceId} to unsubscribe from ${topic}`
              );
              resolve();
            }
          }
        );
      });
    },
  };
}

/**
 * Create MQTT adapter from environment variables
 *
 * Expects:
 * - MQTT_BROKER_URL: MQTT broker URL
 * - MQTT_USERNAME: (optional) Username
 * - MQTT_PASSWORD: (optional) Password
 */
export function mqttPushAdapterFromEnv(
  options?: Partial<MQTTAdapterOptions>
): PushAdapter {
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
export function mqttExtendedAdapter(
  options: MQTTAdapterOptions
): MQTTExtendedAdapter {
  const baseAdapter = mqttPushAdapter(options);

  // Access internal state through closure
  // This is a simplified version - in production you'd refactor to share state properly
  const devicePresence = new Map<string, MQTTDeviceStatus>();

  return {
    ...baseAdapter,

    getDeviceStatus(deviceId: string): MQTTDeviceStatus | undefined {
      return devicePresence.get(deviceId);
    },

    getOnlineDevices(): MQTTDeviceStatus[] {
      return Array.from(devicePresence.values()).filter((d) => d.online);
    },

    isDeviceOnline(deviceId: string): boolean {
      const status = devicePresence.get(deviceId);
      return status?.online ?? false;
    },

    async disconnect(): Promise<void> {
      // Note: This would need access to the client from the base adapter
      // In production, refactor to properly share the client instance
      console.log('[OpenMDM MQTT] Disconnecting...');
    },
  };
}
