/**
 * Wire-protocol helpers for the `/agent/*` endpoints.
 *
 * All responses flow through this module. It enforces the Phase 2a
 * invariant: a request that carries `X-Openmdm-Protocol: 2` is
 * answered with an {@link AgentResponse} envelope at HTTP 200; any
 * other request gets the legacy flat shape (and `HTTPException`-based
 * error semantics) unchanged.
 *
 * Each handler calls `agentOk(c, data)` on success and
 * `agentReauth / agentUnenroll / agentRetry` on application-level
 * failures. The helpers do the version-detection and response-shape
 * selection so handlers stay small.
 */
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  AGENT_PROTOCOL_HEADER,
  agentOk as buildAgentOk,
  agentFail,
  wantsAgentProtocolV2,
} from '@openmdm/core';
import type { AgentAction } from '@openmdm/core';

/**
 * Returns true when the inbound request opts into protocol v2 via
 * the `X-Openmdm-Protocol` header.
 */
export function isAgentV2(c: Context): boolean {
  return wantsAgentProtocolV2(c.req.header(AGENT_PROTOCOL_HEADER));
}

/**
 * Success response.
 *
 * v2: `{ ok: true, action: "none", data }` at HTTP 200.
 * v1: legacy — either the raw `data` (for endpoints that historically
 *     returned a flat body) or `{ ...data }` if the caller doesn't
 *     care. Pass `legacyStatus` for v1-only status codes like 201
 *     on enrollment.
 */
export function agentOkResponse<T>(
  c: Context,
  data: T,
  opts: { legacyStatus?: 200 | 201 } = {},
): Response {
  if (isAgentV2(c)) {
    return c.json(buildAgentOk(data), 200);
  }
  return c.json(data as any, (opts.legacyStatus ?? 200) as 200 | 201);
}

/**
 * Application-level failure response. Exactly one of the non-`none`
 * actions is expressed.
 *
 * v2: HTTP 200 with `{ ok: false, action, message }`.
 * v1: throws an `HTTPException` with the legacy status so existing
 *     clients see the same errors they saw before Phase 2a landed.
 *
 * Mapping of v2 actions to v1 legacy statuses:
 *  - `reauth`   → 401
 *  - `unenroll` → 404
 *  - `retry`    → 503
 */
export function agentFailResponse(
  c: Context,
  action: Exclude<AgentAction, 'none'>,
  message?: string,
): Response {
  if (isAgentV2(c)) {
    return c.json(agentFail(action, message), 200);
  }
  throw new HTTPException(legacyStatusFor(action), {
    message: message ?? defaultMessageFor(action),
  });
}

/** Convenience: respond with `reauth`. Agent should refresh its token. */
export function agentReauth(c: Context, message?: string): Response {
  return agentFailResponse(c, 'reauth', message);
}

/** Convenience: respond with `unenroll`. Agent is server-side gone. */
export function agentUnenroll(c: Context, message?: string): Response {
  return agentFailResponse(c, 'unenroll', message);
}

/** Convenience: respond with `retry`. Transient failure. */
export function agentRetry(c: Context, message?: string): Response {
  return agentFailResponse(c, 'retry', message);
}

function legacyStatusFor(action: Exclude<AgentAction, 'none'>): 401 | 404 | 503 {
  if (action === 'reauth') return 401;
  if (action === 'unenroll') return 404;
  return 503; // 'retry'
}

function defaultMessageFor(action: Exclude<AgentAction, 'none'>): string {
  if (action === 'reauth') return 'Device authentication required';
  if (action === 'unenroll') return 'Device not found';
  return 'Temporarily unavailable'; // 'retry'
}
