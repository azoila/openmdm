/**
 * OpenMDM Webhook Delivery System
 *
 * Handles outbound webhook delivery with HMAC signing and retry logic.
 */

import { createHmac, randomUUID } from 'crypto';
import type {
  WebhookConfig,
  WebhookEndpoint,
  EventType,
  MDMEvent,
} from './types';

// ============================================
// Types
// ============================================

export interface WebhookDeliveryResult {
  endpointId: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  retryCount: number;
  deliveredAt?: Date;
}

export interface WebhookPayload<T = unknown> {
  id: string;
  event: EventType;
  timestamp: string;
  data: T;
}

export interface WebhookManager {
  /**
   * Deliver an event to all matching webhook endpoints
   */
  deliver<T>(event: MDMEvent<T>): Promise<WebhookDeliveryResult[]>;

  /**
   * Add a webhook endpoint at runtime
   */
  addEndpoint(endpoint: WebhookEndpoint): void;

  /**
   * Remove a webhook endpoint
   */
  removeEndpoint(endpointId: string): void;

  /**
   * Update a webhook endpoint
   */
  updateEndpoint(endpointId: string, updates: Partial<WebhookEndpoint>): void;

  /**
   * Get all configured endpoints
   */
  getEndpoints(): WebhookEndpoint[];

  /**
   * Test a webhook endpoint with a test payload
   */
  testEndpoint(endpointId: string): Promise<WebhookDeliveryResult>;
}

// ============================================
// Implementation
// ============================================

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
};

/**
 * Create a webhook manager instance
 */
export function createWebhookManager(config: WebhookConfig): WebhookManager {
  const endpoints = new Map<string, WebhookEndpoint>();
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };

  // Initialize with configured endpoints
  if (config.endpoints) {
    for (const endpoint of config.endpoints) {
      endpoints.set(endpoint.id, endpoint);
    }
  }

  /**
   * Sign a webhook payload with HMAC-SHA256
   */
  function signPayload(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Calculate exponential backoff delay
   */
  function getBackoffDelay(retryCount: number): number {
    const delay = retryConfig.initialDelay * Math.pow(2, retryCount);
    return Math.min(delay, retryConfig.maxDelay);
  }

  /**
   * Check if an endpoint should receive this event
   */
  function shouldDeliverToEndpoint(
    endpoint: WebhookEndpoint,
    eventType: EventType
  ): boolean {
    if (!endpoint.enabled) {
      return false;
    }

    // Wildcard matches all events
    if (endpoint.events.includes('*')) {
      return true;
    }

    return endpoint.events.includes(eventType);
  }

  /**
   * Deliver payload to a single endpoint with retry logic
   */
  async function deliverToEndpoint(
    endpoint: WebhookEndpoint,
    payload: WebhookPayload
  ): Promise<WebhookDeliveryResult> {
    const payloadString = JSON.stringify(payload);
    let lastError: string | undefined;
    let lastStatusCode: number | undefined;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        // Prepare headers
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-OpenMDM-Event': payload.event,
          'X-OpenMDM-Delivery': payload.id,
          'X-OpenMDM-Timestamp': payload.timestamp,
          ...endpoint.headers,
        };

        // Add signature if signing secret is configured
        if (config.signingSecret) {
          const signature = signPayload(payloadString, config.signingSecret);
          headers['X-OpenMDM-Signature'] = `sha256=${signature}`;
        }

        // Make the request
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers,
          body: payloadString,
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });

        lastStatusCode = response.status;

        // 2xx is success
        if (response.ok) {
          return {
            endpointId: endpoint.id,
            success: true,
            statusCode: response.status,
            retryCount: attempt,
            deliveredAt: new Date(),
          };
        }

        // 4xx errors (except 429) should not be retried
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return {
            endpointId: endpoint.id,
            success: false,
            statusCode: response.status,
            error: `HTTP ${response.status}: ${response.statusText}`,
            retryCount: attempt,
          };
        }

        // 5xx and 429 should be retried
        lastError = `HTTP ${response.status}: ${response.statusText}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      // Wait before retry (unless this was the last attempt)
      if (attempt < retryConfig.maxRetries) {
        const delay = getBackoffDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return {
      endpointId: endpoint.id,
      success: false,
      statusCode: lastStatusCode,
      error: lastError || 'Max retries exceeded',
      retryCount: retryConfig.maxRetries,
    };
  }

  return {
    async deliver<T>(event: MDMEvent<T>): Promise<WebhookDeliveryResult[]> {
      const matchingEndpoints = Array.from(endpoints.values()).filter((ep) =>
        shouldDeliverToEndpoint(ep, event.type)
      );

      if (matchingEndpoints.length === 0) {
        return [];
      }

      // Prepare webhook payload
      const payload: WebhookPayload<T> = {
        id: randomUUID(),
        event: event.type,
        timestamp: new Date().toISOString(),
        data: event.payload,
      };

      // Deliver to all matching endpoints in parallel
      const deliveryPromises = matchingEndpoints.map((endpoint) =>
        deliverToEndpoint(endpoint, payload as WebhookPayload)
      );

      const results = await Promise.all(deliveryPromises);

      // Log failures
      for (const result of results) {
        if (!result.success) {
          console.error(
            `[OpenMDM] Webhook delivery failed to endpoint ${result.endpointId}:`,
            result.error
          );
        }
      }

      return results;
    },

    addEndpoint(endpoint: WebhookEndpoint): void {
      endpoints.set(endpoint.id, endpoint);
    },

    removeEndpoint(endpointId: string): void {
      endpoints.delete(endpointId);
    },

    updateEndpoint(endpointId: string, updates: Partial<WebhookEndpoint>): void {
      const existing = endpoints.get(endpointId);
      if (existing) {
        endpoints.set(endpointId, { ...existing, ...updates });
      }
    },

    getEndpoints(): WebhookEndpoint[] {
      return Array.from(endpoints.values());
    },

    async testEndpoint(endpointId: string): Promise<WebhookDeliveryResult> {
      const endpoint = endpoints.get(endpointId);
      if (!endpoint) {
        return {
          endpointId,
          success: false,
          error: 'Endpoint not found',
          retryCount: 0,
        };
      }

      const testPayload: WebhookPayload = {
        id: randomUUID(),
        event: 'device.heartbeat',
        timestamp: new Date().toISOString(),
        data: {
          test: true,
          message: 'OpenMDM webhook test',
        },
      };

      return deliverToEndpoint(endpoint, testPayload);
    },
  };
}

/**
 * Verify a webhook signature from incoming requests
 * (Utility for consumers to verify our webhooks)
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = `sha256=${createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`;

  // Constant-time comparison
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }

  return result === 0;
}
