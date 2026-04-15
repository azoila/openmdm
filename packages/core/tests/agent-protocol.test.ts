import { describe, it, expect } from 'vitest';
import {
  wantsAgentProtocolV2,
  agentOk,
  agentFail,
  AGENT_PROTOCOL_HEADER,
  AGENT_PROTOCOL_V2,
} from '../src/agent-protocol';

describe('wantsAgentProtocolV2', () => {
  it('accepts exact string "2"', () => {
    expect(wantsAgentProtocolV2('2')).toBe(true);
  });

  it('rejects undefined (legacy client with no header → v1)', () => {
    expect(wantsAgentProtocolV2(undefined)).toBe(false);
  });

  it('rejects null (some frameworks hand null for missing headers)', () => {
    expect(wantsAgentProtocolV2(null)).toBe(false);
  });

  it('rejects older version numbers', () => {
    expect(wantsAgentProtocolV2('1')).toBe(false);
    expect(wantsAgentProtocolV2('0')).toBe(false);
  });

  it('rejects unrelated strings that should not opt into v2', () => {
    expect(wantsAgentProtocolV2('true')).toBe(false);
    expect(wantsAgentProtocolV2('yes')).toBe(false);
    expect(wantsAgentProtocolV2('v2')).toBe(false);
  });

  it('does NOT trim whitespace (strict equality, header framework normalizes upstream)', () => {
    expect(wantsAgentProtocolV2(' 2')).toBe(false);
    expect(wantsAgentProtocolV2('2 ')).toBe(false);
  });

  it('rejects future version numbers without an explicit upgrade', () => {
    // If/when v3 lands, someone has to come update the strict equality —
    // that's the point. Silent forward-compat would mean v3 clients could
    // get v2 responses they don't understand.
    expect(wantsAgentProtocolV2('3')).toBe(false);
  });
});

describe('agentOk / agentFail envelope builders', () => {
  it('agentOk builds a success envelope with action=none', () => {
    const env = agentOk({ foo: 'bar' });
    expect(env).toEqual({ ok: true, action: 'none', data: { foo: 'bar' } });
  });

  it('agentFail builds a reauth envelope', () => {
    const env = agentFail('reauth', 'token expired');
    expect(env).toEqual({ ok: false, action: 'reauth', message: 'token expired' });
  });

  it('agentFail builds an unenroll envelope', () => {
    const env = agentFail('unenroll', 'device blocked');
    expect(env).toEqual({ ok: false, action: 'unenroll', message: 'device blocked' });
  });

  it('agentFail builds a retry envelope', () => {
    const env = agentFail('retry', 'downstream timeout');
    expect(env).toEqual({ ok: false, action: 'retry', message: 'downstream timeout' });
  });

  it('agentFail message is optional', () => {
    const env = agentFail('retry');
    expect(env.ok).toBe(false);
    expect(env.action).toBe('retry');
    expect(env.message).toBeUndefined();
  });
});

describe('protocol constants', () => {
  it('header name stays stable — changing it is a wire break', () => {
    expect(AGENT_PROTOCOL_HEADER).toBe('X-Openmdm-Protocol');
  });

  it('v2 version marker is exactly "2"', () => {
    expect(AGENT_PROTOCOL_V2).toBe('2');
  });
});
