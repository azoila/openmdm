/**
 * OpenMDM Agent Wire Protocol v2.
 *
 * A unified response envelope for every `/agent/*` endpoint, plus the
 * version-selection rules that let the server serve v1 and v2 clients
 * simultaneously during a fleet rollout.
 *
 * ## Background
 *
 * Until now, agent-facing handlers returned either a bare JSON body
 * on success or raised an `HTTPException(401|404|5xx)` on failure.
 * The agent had to interpret five different HTTP status codes and
 * infer what to do about each — which in practice meant "on auth
 * error, wipe local enrollment state and re-enroll". That single
 * ambiguity produced the auto-unenroll behavior we saw in production:
 * a transient 401 or 404 was indistinguishable from "you are really
 * unenrolled", so the agent self-destructed.
 *
 * ## Protocol v2
 *
 * Every agent-facing endpoint replies with HTTP 200 and a body of
 * shape {@link AgentResponse}:
 *
 * ```json
 * { "ok": true,  "action": "none",      "data": { ... } }
 * { "ok": false, "action": "retry",     "message": "..." }
 * { "ok": false, "action": "reauth",    "message": "..." }
 * { "ok": false, "action": "unenroll",  "message": "..." }
 * ```
 *
 * - `ok` is the boolean the agent checks first.
 * - `action` is the *only* field the agent reads to decide what to do
 *   next. There is exactly one handler per action on the client, so
 *   adding a new server response path is a matter of picking an
 *   existing action.
 * - `data` carries the handler-specific payload (heartbeat response,
 *   policy update, etc.) on success.
 * - `message` is a human-readable hint, for logs.
 *
 * HTTP 5xx is still used for real infrastructure failures (the Lambda
 * timed out, the database connection dropped, etc.). v2 envelopes are
 * reserved for *application-level* failures the agent can reason about.
 *
 * ## Versioning and rollout
 *
 * The agent opts into v2 by sending the header
 * `X-Openmdm-Protocol: 2` on every request. When absent, the server
 * falls back to the legacy v1 behavior — bare JSON on success,
 * `HTTPException(401|404|…)` on failure — so a fleet still running
 * older APKs keeps working during rollout.
 *
 * After the fleet has been upgraded, v1 can be dropped in a future
 * major release by ignoring the header and always emitting v2.
 */

/**
 * Instruction the server gives the agent on how to react to this
 * response. This is the entire client-side decision space.
 *
 * - `none`: happy path. The agent consumes `data` and continues.
 * - `retry`: transient problem. The agent re-tries later without
 *   touching local state.
 * - `reauth`: the agent's access token is no longer valid. It should
 *   call the refresh flow. It must NOT wipe enrollment state.
 * - `unenroll`: the server-side record for this device is gone or
 *   blocked and the agent's credentials will never work again. The
 *   agent should stop making requests and surface this to the user.
 *   In Phase 2b this will be further softened: the agent will attempt
 *   a hardware-identity-based rebind before treating this as terminal.
 */
export type AgentAction = 'none' | 'retry' | 'reauth' | 'unenroll';

/**
 * Unified response envelope for every `/agent/*` endpoint under
 * protocol v2.
 *
 * Successful responses carry `data`; failure responses carry
 * `message`. The envelope never carries both the happy-path payload
 * and an error hint at the same time.
 */
export type AgentResponse<T = unknown> =
  | {
      ok: true;
      action: 'none';
      data: T;
    }
  | {
      ok: false;
      action: Exclude<AgentAction, 'none'>;
      message?: string;
    };

/**
 * HTTP header an agent sends to opt into protocol v2. Case-insensitive
 * on the wire; use the constant to avoid typos.
 */
export const AGENT_PROTOCOL_HEADER = 'X-Openmdm-Protocol';

/**
 * Current wire-protocol version. Agents that send
 * `X-Openmdm-Protocol: 2` get envelope responses. Absent or older
 * values are served with the legacy flat shape.
 */
export const AGENT_PROTOCOL_V2 = '2';

/**
 * Helper: build a success envelope.
 */
export function agentOk<T>(data: T): AgentResponse<T> {
  return { ok: true, action: 'none', data };
}

/**
 * Helper: build a failure envelope.
 */
export function agentFail(
  action: Exclude<AgentAction, 'none'>,
  message?: string,
): AgentResponse<never> {
  return { ok: false, action, message };
}

/**
 * Returns `true` iff the caller should be served protocol v2. The
 * input is the value of the {@link AGENT_PROTOCOL_HEADER} header,
 * which may be undefined.
 */
export function wantsAgentProtocolV2(headerValue: string | undefined | null): boolean {
  return headerValue === AGENT_PROTOCOL_V2;
}
