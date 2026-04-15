import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  isAgentV2,
  agentOkResponse,
  agentFailResponse,
  agentReauth,
  agentUnenroll,
  agentRetry,
} from '../src/agent-envelope';

/**
 * These tests cover the wire-protocol v1↔v2 branching in the envelope
 * helpers. A regression here silently reintroduces the auto-unenroll
 * production bug the envelope rewrite was designed to fix (see
 * core/src/agent-protocol.ts doc comment).
 */

const V2_HEADER = { 'X-Openmdm-Protocol': '2' };

function buildApp(): Hono {
  const app = new Hono();

  app.get('/ok', (c) => agentOkResponse(c, { foo: 'bar' }));
  app.get('/ok-201', (c) => agentOkResponse(c, { id: 'new' }, { legacyStatus: 201 }));
  app.get('/reauth', (c) => agentReauth(c, 'token expired'));
  app.get('/unenroll', (c) => agentUnenroll(c, 'device blocked'));
  app.get('/retry', (c) => agentRetry(c, 'downstream timeout'));
  app.get('/fail-no-message', (c) => agentFailResponse(c, 'reauth'));
  app.get('/is-v2', (c) => c.json({ v2: isAgentV2(c) }));

  // Surface HTTPException thrown by envelope helpers under v1 as JSON so
  // tests can assert on status + body.
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  });

  return app;
}

describe('isAgentV2 header detection', () => {
  const app = buildApp();

  it('returns true when X-Openmdm-Protocol: 2 is set', async () => {
    const res = await app.request('/is-v2', { headers: V2_HEADER });
    expect(await res.json()).toEqual({ v2: true });
  });

  it('returns false when header is absent', async () => {
    const res = await app.request('/is-v2');
    expect(await res.json()).toEqual({ v2: false });
  });

  it('returns false when header is "1"', async () => {
    const res = await app.request('/is-v2', { headers: { 'X-Openmdm-Protocol': '1' } });
    expect(await res.json()).toEqual({ v2: false });
  });

  it('returns false on other truthy values', async () => {
    const res = await app.request('/is-v2', { headers: { 'X-Openmdm-Protocol': 'true' } });
    expect(await res.json()).toEqual({ v2: false });
  });
});

describe('agentOkResponse: v1 vs v2 shapes', () => {
  const app = buildApp();

  it('v2 request gets envelope {ok:true, action:"none", data}', async () => {
    const res = await app.request('/ok', { headers: V2_HEADER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      action: 'none',
      data: { foo: 'bar' },
    });
  });

  it('v1 request gets raw data body at 200', async () => {
    const res = await app.request('/ok');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ foo: 'bar' });
  });

  it('v1 request respects legacyStatus override (e.g. 201 for enrollment)', async () => {
    const res = await app.request('/ok-201');
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'new' });
  });

  it('v2 request IGNORES legacyStatus and always returns 200', async () => {
    const res = await app.request('/ok-201', { headers: V2_HEADER });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, action: 'none', data: { id: 'new' } });
  });
});

describe('agentFailResponse: v1 status codes vs v2 actions', () => {
  const app = buildApp();

  it('v2 reauth → 200 envelope with action="reauth"', async () => {
    const res = await app.request('/reauth', { headers: V2_HEADER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      action: 'reauth',
      message: 'token expired',
    });
  });

  it('v1 reauth → HTTPException(401)', async () => {
    const res = await app.request('/reauth');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'token expired' });
  });

  it('v2 unenroll → 200 envelope with action="unenroll"', async () => {
    const res = await app.request('/unenroll', { headers: V2_HEADER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      action: 'unenroll',
      message: 'device blocked',
    });
  });

  it('v1 unenroll → HTTPException(404)', async () => {
    const res = await app.request('/unenroll');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'device blocked' });
  });

  it('v2 retry → 200 envelope with action="retry"', async () => {
    const res = await app.request('/retry', { headers: V2_HEADER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      action: 'retry',
      message: 'downstream timeout',
    });
  });

  it('v1 retry → HTTPException(503)', async () => {
    const res = await app.request('/retry');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'downstream timeout' });
  });

  it('v1 fallback uses default message when none provided', async () => {
    const res = await app.request('/fail-no-message');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Device authentication required' });
  });
});
