import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { createWebhookManager, verifyWebhookSignature } from '../src/webhooks';
import type { MDMEvent } from '../src/types';

const SECRET = 'webhook-signing-secret';

function buildEvent(): MDMEvent<{ deviceId: string }> {
  return {
    id: 'evt_123',
    deviceId: 'device-42',
    type: 'device.enrolled',
    createdAt: new Date('2026-04-15T00:00:00Z'),
    payload: { deviceId: 'device-42' },
  };
}

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', () => {
    const payload = '{"hello":"world"}';
    const signature =
      'sha256=' + createHmac('sha256', SECRET).update(payload).digest('hex');
    expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(true);
  });

  it('rejects a payload signed with a different secret', () => {
    const payload = '{"hello":"world"}';
    const signature =
      'sha256=' +
      createHmac('sha256', 'other-secret').update(payload).digest('hex');
    expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(false);
  });

  it('rejects signatures with wrong length (no out-of-bounds read)', () => {
    expect(verifyWebhookSignature('x', 'sha256=short', SECRET)).toBe(false);
    expect(verifyWebhookSignature('x', '', SECRET)).toBe(false);
  });

  it('rejects tampered payloads', () => {
    const signature =
      'sha256=' +
      createHmac('sha256', SECRET).update('{"a":1}').digest('hex');
    expect(verifyWebhookSignature('{"a":2}', signature, SECRET)).toBe(false);
  });

  it('uses the sha256= prefix format', () => {
    const payload = '{"ok":true}';
    const rawHex = createHmac('sha256', SECRET).update(payload).digest('hex');
    // Without prefix should not match
    expect(verifyWebhookSignature(payload, rawHex, SECRET)).toBe(false);
    expect(
      verifyWebhookSignature(payload, `sha256=${rawHex}`, SECRET)
    ).toBe(true);
  });
});

describe('createWebhookManager delivery', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('delivers to endpoints matching the event type', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
    const mgr = createWebhookManager({
      endpoints: [
        {
          id: 'matching',
          url: 'https://example.com/hook',
          events: ['device.enrolled'],
          enabled: true,
        },
        {
          id: 'not-matching',
          url: 'https://example.com/other',
          events: ['command.completed'],
          enabled: true,
        },
      ],
    });

    const results = await mgr.deliver(buildEvent());

    expect(results).toHaveLength(1);
    expect(results[0].endpointId).toBe('matching');
    expect(results[0].success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/hook');
  });

  it('wildcard event selector matches every event', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
    const mgr = createWebhookManager({
      endpoints: [
        {
          id: 'wild',
          url: 'https://example.com/all',
          events: ['*'],
          enabled: true,
        },
      ],
    });

    const results = await mgr.deliver(buildEvent());
    expect(results[0].success).toBe(true);
  });

  it('skips disabled endpoints', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
    const mgr = createWebhookManager({
      endpoints: [
        {
          id: 'disabled',
          url: 'https://example.com/hook',
          events: ['*'],
          enabled: false,
        },
      ],
    });

    const results = await mgr.deliver(buildEvent());
    expect(results).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('signs the payload with HMAC-SHA256 in X-OpenMDM-Signature header', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
    const mgr = createWebhookManager({
      signingSecret: SECRET,
      endpoints: [
        {
          id: 'signed',
          url: 'https://example.com/hook',
          events: ['*'],
          enabled: true,
        },
      ],
    });

    await mgr.deliver(buildEvent());

    const call = fetchSpy.mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;

    expect(headers['X-OpenMDM-Signature']).toBeDefined();
    const expected =
      'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
    expect(headers['X-OpenMDM-Signature']).toBe(expected);
    expect(headers['X-OpenMDM-Event']).toBe('device.enrolled');
    expect(headers['X-OpenMDM-Delivery']).toBeDefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits signature header when no signingSecret is configured', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
    const mgr = createWebhookManager({
      endpoints: [
        {
          id: 'unsigned',
          url: 'https://example.com/hook',
          events: ['*'],
          enabled: true,
        },
      ],
    });

    await mgr.deliver(buildEvent());

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['X-OpenMDM-Signature']).toBeUndefined();
  });

  it('does NOT retry on 4xx (except 429)', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    const mgr = createWebhookManager({
      retry: { maxRetries: 3, initialDelay: 1, maxDelay: 2 },
      endpoints: [
        {
          id: 'e',
          url: 'https://example.com/hook',
          events: ['*'],
          enabled: true,
        },
      ],
    });

    const resultPromise = mgr.deliver(buildEvent());
    await vi.runAllTimersAsync();
    const [result] = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.retryCount).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx up to maxRetries then gives up', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as Response);

    const mgr = createWebhookManager({
      retry: { maxRetries: 3, initialDelay: 1, maxDelay: 2 },
      endpoints: [
        {
          id: 'e',
          url: 'https://example.com/hook',
          events: ['*'],
          enabled: true,
        },
      ],
    });

    const resultPromise = mgr.deliver(buildEvent());
    await vi.runAllTimersAsync();
    const [result] = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.retryCount).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('retries on 429 (rate limit)', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    } as Response);

    const mgr = createWebhookManager({
      retry: { maxRetries: 2, initialDelay: 1, maxDelay: 2 },
      endpoints: [
        {
          id: 'e',
          url: 'https://example.com/hook',
          events: ['*'],
          enabled: true,
        },
      ],
    });

    const resultPromise = mgr.deliver(buildEvent());
    await vi.runAllTimersAsync();
    const [result] = await resultPromise;

    expect(result.success).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('retries on network errors (fetch throws)', async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' } as Response);

    const mgr = createWebhookManager({
      retry: { maxRetries: 3, initialDelay: 1, maxDelay: 2 },
      endpoints: [
        {
          id: 'e',
          url: 'https://example.com/hook',
          events: ['*'],
          enabled: true,
        },
      ],
    });

    const resultPromise = mgr.deliver(buildEvent());
    await vi.runAllTimersAsync();
    const [result] = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.retryCount).toBe(2); // succeeded on 3rd attempt (retryCount = attempt index)
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('passes custom headers through', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);
    const mgr = createWebhookManager({
      endpoints: [
        {
          id: 'e',
          url: 'https://example.com/hook',
          events: ['*'],
          enabled: true,
          headers: { Authorization: 'Bearer custom-token' },
        },
      ],
    });

    await mgr.deliver(buildEvent());
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['Authorization']).toBe('Bearer custom-token');
  });
});
