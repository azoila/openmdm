/**
 * OpenMDM Message Queue Manager
 *
 * Provides persistent message queue management for the MDM system.
 * Ensures reliable message delivery with retry and expiration handling.
 */

import type {
  MessageQueueManager,
  QueuedMessage,
  EnqueueMessageInput,
  QueueStats,
  DatabaseAdapter,
} from './types';

/**
 * Default maximum attempts for message delivery
 */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Default TTL in seconds (24 hours)
 */
const DEFAULT_TTL_SECONDS = 86400;

/**
 * Create a MessageQueueManager instance
 */
export function createMessageQueueManager(db: DatabaseAdapter): MessageQueueManager {
  return {
    async enqueue(message: EnqueueMessageInput): Promise<QueuedMessage> {
      if (!db.enqueueMessage) {
        throw new Error('Database adapter does not support message queue');
      }

      // Set defaults
      const enrichedMessage: EnqueueMessageInput = {
        ...message,
        priority: message.priority ?? 'normal',
        maxAttempts: message.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        ttlSeconds: message.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      };

      return db.enqueueMessage(enrichedMessage);
    },

    async enqueueBatch(messages: EnqueueMessageInput[]): Promise<QueuedMessage[]> {
      if (!db.enqueueMessage) {
        throw new Error('Database adapter does not support message queue');
      }

      const results: QueuedMessage[] = [];

      for (const message of messages) {
        const enrichedMessage: EnqueueMessageInput = {
          ...message,
          priority: message.priority ?? 'normal',
          maxAttempts: message.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          ttlSeconds: message.ttlSeconds ?? DEFAULT_TTL_SECONDS,
        };

        const queued = await db.enqueueMessage(enrichedMessage);
        results.push(queued);
      }

      return results;
    },

    async dequeue(deviceId: string, limit: number = 10): Promise<QueuedMessage[]> {
      if (!db.dequeueMessages) {
        throw new Error('Database adapter does not support message queue');
      }
      return db.dequeueMessages(deviceId, limit);
    },

    async acknowledge(messageId: string): Promise<void> {
      if (!db.acknowledgeMessage) {
        throw new Error('Database adapter does not support message queue');
      }
      await db.acknowledgeMessage(messageId);
    },

    async fail(messageId: string, error: string): Promise<void> {
      if (!db.failMessage) {
        throw new Error('Database adapter does not support message queue');
      }
      await db.failMessage(messageId, error);
    },

    async retryFailed(maxAttempts: number = DEFAULT_MAX_ATTEMPTS): Promise<number> {
      if (!db.retryFailedMessages) {
        throw new Error('Database adapter does not support message queue');
      }
      return db.retryFailedMessages(maxAttempts);
    },

    async purgeExpired(): Promise<number> {
      if (!db.purgeExpiredMessages) {
        throw new Error('Database adapter does not support message queue');
      }
      return db.purgeExpiredMessages();
    },

    async getStats(tenantId?: string): Promise<QueueStats> {
      if (!db.getQueueStats) {
        throw new Error('Database adapter does not support message queue');
      }
      return db.getQueueStats(tenantId);
    },

    async peek(deviceId: string, limit: number = 10): Promise<QueuedMessage[]> {
      if (!db.peekMessages) {
        throw new Error('Database adapter does not support message queue');
      }
      return db.peekMessages(deviceId, limit);
    },
  };
}

/**
 * Message priority weights for sorting
 */
export const PRIORITY_WEIGHTS = {
  high: 3,
  normal: 2,
  low: 1,
} as const;

/**
 * Compare messages by priority (higher priority first)
 */
export function compareByPriority(a: QueuedMessage, b: QueuedMessage): number {
  return PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
}

/**
 * Check if a message has expired
 */
export function isMessageExpired(message: QueuedMessage): boolean {
  if (!message.expiresAt) return false;
  return new Date(message.expiresAt) < new Date();
}

/**
 * Check if a message can be retried
 */
export function canRetryMessage(message: QueuedMessage): boolean {
  return message.status === 'failed' && message.attempts < message.maxAttempts;
}

/**
 * Calculate exponential backoff delay for retries
 */
export function calculateBackoffDelay(
  attempts: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 300000 // 5 minutes
): number {
  const delay = baseDelayMs * Math.pow(2, attempts - 1);
  return Math.min(delay, maxDelayMs);
}
