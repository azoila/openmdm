/**
 * Fixed-window in-memory rate limiter for the unauthenticated enrollment
 * routes.
 *
 * Scope: single-process only. Each replica keeps its own counters, so with
 * N replicas the effective limit is up to N × `max`. That is acceptable for
 * what this protects — brute-forcing an HMAC enrollment signature needs
 * millions of attempts, not thousands — but deployments that want a strict
 * global limit should enforce it at the reverse proxy and pass
 * `rateLimit: false` to the adapter.
 */

import type { Context } from 'hono';

export interface RateLimitOptions {
  /** Window length in seconds (default: 60). */
  windowSeconds?: number;
  /** Maximum requests per key per window (default: 60). */
  max?: number;
  /**
   * Extract the limiter key from a request. Defaults to the first
   * `X-Forwarded-For` entry, then `X-Real-Ip`, then a shared bucket.
   * Override when your proxy uses a different header, or to key by
   * something other than client IP.
   */
  keyFor?: (c: Context) => string;
}

interface Window {
  count: number;
  startedAt: number;
}

export interface RateLimiter {
  /** Record a hit for this request. Returns false when over the limit. */
  allow(c: Context): boolean;
}

export function defaultRateLimitKey(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return c.req.header('x-real-ip') ?? 'unkeyed';
}

export function createRateLimiter(options: RateLimitOptions = {}): RateLimiter {
  const windowMs = (options.windowSeconds ?? 60) * 1000;
  const max = options.max ?? 60;
  const keyFor = options.keyFor ?? defaultRateLimitKey;
  const windows = new Map<string, Window>();

  return {
    allow(c: Context): boolean {
      const now = Date.now();
      const key = keyFor(c);
      const current = windows.get(key);

      if (!current || now - current.startedAt >= windowMs) {
        // Opportunistic sweep so a long-lived process doesn't accumulate
        // one entry per client IP forever.
        if (windows.size > 10_000) {
          for (const [k, w] of windows) {
            if (now - w.startedAt >= windowMs) {
              windows.delete(k);
            }
          }
        }
        windows.set(key, { count: 1, startedAt: now });
        return true;
      }

      current.count += 1;
      return current.count <= max;
    },
  };
}
