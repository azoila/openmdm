/**
 * OpenMDM FCM Push Adapter
 *
 * Firebase Cloud Messaging adapter for sending push notifications to Android devices.
 *
 * @example
 * ```typescript
 * import { createMDM } from '@openmdm/core';
 * import { fcmPushAdapter } from '@openmdm/push-fcm';
 *
 * const mdm = createMDM({
 *   database: drizzleAdapter(db),
 *   push: fcmPushAdapter({
 *     credential: admin.credential.cert(serviceAccount),
 *     // or: credentialPath: './service-account.json',
 *   }),
 * });
 * ```
 */

import * as admin from 'firebase-admin';
import type {
  PushAdapter,
  PushMessage,
  PushResult,
  PushBatchResult,
  DatabaseAdapter,
} from '@openmdm/core';

export interface FCMAdapterOptions {
  /**
   * Firebase Admin credential object
   * Use admin.credential.cert(serviceAccount) or admin.credential.applicationDefault()
   */
  credential?: admin.credential.Credential;

  /**
   * Path to service account JSON file
   * Alternative to providing credential directly
   */
  credentialPath?: string;

  /**
   * Firebase project ID (optional, usually inferred from credential)
   */
  projectId?: string;

  /**
   * Database adapter for storing/retrieving push tokens
   */
  database?: DatabaseAdapter;

  /**
   * Whether to use data-only messages (default: true)
   * Data-only messages wake the app even when in background
   */
  dataOnly?: boolean;

  /**
   * Default TTL for messages in seconds (default: 3600 = 1 hour)
   */
  defaultTtl?: number;

  /**
   * Android-specific notification options
   */
  android?: {
    priority?: 'high' | 'normal';
    restrictedPackageName?: string;
    directBootOk?: boolean;
  };
}

/**
 * Create an FCM push adapter for OpenMDM
 */
export function fcmPushAdapter(options: FCMAdapterOptions): PushAdapter {
  // Initialize Firebase Admin if not already initialized
  let app: admin.app.App;

  try {
    app = admin.app('[openmdm]');
  } catch {
    // App doesn't exist, create it
    const initOptions: admin.AppOptions = {};

    if (options.credential) {
      initOptions.credential = options.credential;
    } else if (options.credentialPath) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const serviceAccount = require(options.credentialPath);
      initOptions.credential = admin.credential.cert(serviceAccount);
    } else {
      // Use application default credentials
      initOptions.credential = admin.credential.applicationDefault();
    }

    if (options.projectId) {
      initOptions.projectId = options.projectId;
    }

    app = admin.initializeApp(initOptions, '[openmdm]');
  }

  const messaging = app.messaging();
  const database = options.database;
  const dataOnly = options.dataOnly ?? true;
  const defaultTtl = options.defaultTtl ?? 3600;

  // Token cache: deviceId -> FCM token
  const tokenCache = new Map<string, string>();

  /**
   * Get FCM token for a device
   */
  async function getToken(deviceId: string): Promise<string | null> {
    // Check cache first
    if (tokenCache.has(deviceId)) {
      return tokenCache.get(deviceId)!;
    }

    // Get from database if available
    if (database) {
      const pushToken = await database.findPushToken(deviceId, 'fcm');
      if (pushToken?.token) {
        tokenCache.set(deviceId, pushToken.token);
        return pushToken.token;
      }
    }

    return null;
  }

  /**
   * Build FCM message from OpenMDM push message
   */
  function buildMessage(
    token: string,
    message: PushMessage
  ): admin.messaging.Message {
    const fcmMessage: admin.messaging.Message = {
      token,
      android: {
        priority: message.priority === 'high' ? 'high' : 'normal',
        ttl: (message.ttl ?? defaultTtl) * 1000, // Convert to milliseconds
        restrictedPackageName: options.android?.restrictedPackageName,
        directBootOk: options.android?.directBootOk,
      },
    };

    if (dataOnly) {
      // Data-only message - always wakes the app
      fcmMessage.data = {
        type: message.type,
        payload: message.payload ? JSON.stringify(message.payload) : '{}',
        timestamp: new Date().toISOString(),
      };

      if (message.collapseKey) {
        fcmMessage.android!.collapseKey = message.collapseKey;
      }
    } else {
      // Notification + data message
      fcmMessage.notification = {
        title: 'MDM Command',
        body: message.type,
      };
      fcmMessage.data = {
        type: message.type,
        payload: message.payload ? JSON.stringify(message.payload) : '{}',
      };
    }

    return fcmMessage;
  }

  return {
    async send(deviceId: string, message: PushMessage): Promise<PushResult> {
      try {
        const token = await getToken(deviceId);
        if (!token) {
          console.warn(`[OpenMDM FCM] No token found for device ${deviceId}`);
          return {
            success: false,
            error: 'No FCM token registered for device',
          };
        }

        const fcmMessage = buildMessage(token, message);
        const messageId = await messaging.send(fcmMessage);

        console.log(
          `[OpenMDM FCM] Sent to ${deviceId}: ${message.type} (${messageId})`
        );

        return {
          success: true,
          messageId,
        };
      } catch (error: any) {
        console.error(`[OpenMDM FCM] Error sending to ${deviceId}:`, error);

        // Handle invalid token
        if (
          error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered'
        ) {
          // Remove invalid token from cache and database
          tokenCache.delete(deviceId);
          if (database) {
            await database.deletePushToken(deviceId, 'fcm');
          }
        }

        return {
          success: false,
          error: error.message || 'FCM send failed',
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

      // Get tokens for all devices
      const tokensMap = new Map<string, string>();
      for (const deviceId of deviceIds) {
        const token = await getToken(deviceId);
        if (token) {
          tokensMap.set(deviceId, token);
        } else {
          results.push({
            deviceId,
            result: {
              success: false,
              error: 'No FCM token registered',
            },
          });
          failureCount++;
        }
      }

      if (tokensMap.size === 0) {
        return { successCount, failureCount, results };
      }

      // Build messages for batch send
      const messages: admin.messaging.Message[] = [];
      const deviceIdOrder: string[] = [];

      for (const [deviceId, token] of tokensMap) {
        messages.push(buildMessage(token, message));
        deviceIdOrder.push(deviceId);
      }

      try {
        // Send batch (max 500 messages per call)
        const batchSize = 500;
        for (let i = 0; i < messages.length; i += batchSize) {
          const batch = messages.slice(i, i + batchSize);
          const batchDeviceIds = deviceIdOrder.slice(i, i + batchSize);

          const response = await messaging.sendEach(batch);

          response.responses.forEach((resp, index) => {
            const deviceId = batchDeviceIds[index];

            if (resp.success) {
              results.push({
                deviceId,
                result: {
                  success: true,
                  messageId: resp.messageId,
                },
              });
              successCount++;
            } else {
              const error = resp.error;

              // Handle invalid token
              if (
                error?.code === 'messaging/invalid-registration-token' ||
                error?.code === 'messaging/registration-token-not-registered'
              ) {
                tokenCache.delete(deviceId);
                if (database) {
                  database.deletePushToken(deviceId, 'fcm').catch(() => {});
                }
              }

              results.push({
                deviceId,
                result: {
                  success: false,
                  error: error?.message || 'FCM send failed',
                },
              });
              failureCount++;
            }
          });
        }

        console.log(
          `[OpenMDM FCM] Batch sent: ${successCount} success, ${failureCount} failed`
        );
      } catch (error: any) {
        console.error('[OpenMDM FCM] Batch send error:', error);

        // Mark all remaining as failed
        for (const deviceId of deviceIdOrder) {
          if (!results.find((r) => r.deviceId === deviceId)) {
            results.push({
              deviceId,
              result: {
                success: false,
                error: error.message || 'FCM batch send failed',
              },
            });
            failureCount++;
          }
        }
      }

      return { successCount, failureCount, results };
    },

    async registerToken(deviceId: string, token: string): Promise<void> {
      // Update cache
      tokenCache.set(deviceId, token);

      // Store in database if available
      if (database) {
        await database.upsertPushToken({
          deviceId,
          provider: 'fcm',
          token,
        });
      }

      console.log(`[OpenMDM FCM] Registered token for device ${deviceId}`);
    },

    async unregisterToken(deviceId: string): Promise<void> {
      // Remove from cache
      tokenCache.delete(deviceId);

      // Remove from database if available
      if (database) {
        await database.deletePushToken(deviceId, 'fcm');
      }

      console.log(`[OpenMDM FCM] Unregistered token for device ${deviceId}`);
    },

    async subscribe(deviceId: string, topic: string): Promise<void> {
      const token = await getToken(deviceId);
      if (!token) {
        throw new Error(`No FCM token for device ${deviceId}`);
      }

      await messaging.subscribeToTopic(token, topic);
      console.log(`[OpenMDM FCM] Subscribed ${deviceId} to topic ${topic}`);
    },

    async unsubscribe(deviceId: string, topic: string): Promise<void> {
      const token = await getToken(deviceId);
      if (!token) {
        return; // Nothing to unsubscribe
      }

      await messaging.unsubscribeFromTopic(token, topic);
      console.log(`[OpenMDM FCM] Unsubscribed ${deviceId} from topic ${topic}`);
    },
  };
}

/**
 * Create FCM adapter from environment variables
 *
 * Expects GOOGLE_APPLICATION_CREDENTIALS environment variable
 * or FIREBASE_PROJECT_ID for application default credentials
 */
export function fcmPushAdapterFromEnv(
  options?: Partial<FCMAdapterOptions>
): PushAdapter {
  return fcmPushAdapter({
    ...options,
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

/**
 * Create FCM adapter from service account JSON
 */
export function fcmPushAdapterFromServiceAccount(
  serviceAccount: admin.ServiceAccount | string,
  options?: Partial<FCMAdapterOptions>
): PushAdapter {
  const credential =
    typeof serviceAccount === 'string'
      ? admin.credential.cert(JSON.parse(serviceAccount))
      : admin.credential.cert(serviceAccount);

  return fcmPushAdapter({
    ...options,
    credential,
  });
}
