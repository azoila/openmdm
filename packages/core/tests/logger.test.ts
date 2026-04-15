import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConsoleLogger, createSilentLogger } from '../src/logger';

/**
 * Contract tests for the default logger implementations. The point
 * of these tests is not to assert on the exact output format — that
 * is meant to be replaced by a real structured logger in production
 * — but to lock in the *interface* so plugins and managers can rely
 * on it. The Logger interface is a public surface; these tests are
 * what protect it from silent breakage.
 */

describe('createConsoleLogger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    delete process.env.DEBUG;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('level routing', () => {
    it('info goes to console.log', () => {
      const logger = createConsoleLogger();
      logger.info('hello');
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy.mock.calls[0][0]).toContain('hello');
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('warn goes to console.warn', () => {
      const logger = createConsoleLogger();
      logger.warn('uh oh');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('error goes to console.error', () => {
      const logger = createConsoleLogger();
      logger.error('boom');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('debug is suppressed by default', () => {
      const logger = createConsoleLogger();
      logger.debug('noisy');
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('debug fires when DEBUG env var is set', () => {
      process.env.DEBUG = '1';
      const logger = createConsoleLogger();
      logger.debug('noisy');
      expect(debugSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('call conventions', () => {
    it('accepts a single message string', () => {
      const logger = createConsoleLogger();
      logger.info('plain message');
      expect(infoSpy.mock.calls[0][0]).toContain('plain message');
    });

    it('accepts (context, message)', () => {
      const logger = createConsoleLogger();
      logger.info({ deviceId: 'dev-1' }, 'enrolled');
      const output = infoSpy.mock.calls[0][0] as string;
      expect(output).toContain('enrolled');
      expect(output).toContain('dev-1');
    });

    it('context is rendered as JSON so pipelines can parse it', () => {
      const logger = createConsoleLogger();
      logger.info({ a: 1, b: 'two' }, 'msg');
      const output = infoSpy.mock.calls[0][0] as string;
      expect(output).toContain('{"a":1,"b":"two"}');
    });

    it('circular context does not crash', () => {
      const logger = createConsoleLogger();
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      // The contract is "log call must not throw" — we don't care
      // about the exact output for circular objects.
      expect(() => logger.info(circular, 'with circle')).not.toThrow();
      expect(infoSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('prefix and child scoping', () => {
    it('default logger uses [openmdm] prefix', () => {
      const logger = createConsoleLogger();
      logger.info('hello');
      expect(infoSpy.mock.calls[0][0]).toContain('[openmdm]');
    });

    it('child() with a component extends the scope', () => {
      const logger = createConsoleLogger();
      const child = logger.child({ component: 'push' });
      child.info('sent');
      expect(infoSpy.mock.calls[0][0]).toContain('[openmdm:push]');
    });

    it('child() nests scopes', () => {
      const logger = createConsoleLogger();
      const child = logger.child({ component: 'push' });
      const grandchild = child.child({ component: 'fcm' });
      grandchild.info('delivered');
      expect(infoSpy.mock.calls[0][0]).toContain('[openmdm:push:fcm]');
    });

    it('child() without component still returns a usable logger', () => {
      const logger = createConsoleLogger();
      const child = logger.child({ arbitrary: 'field' });
      expect(() => child.info('ok')).not.toThrow();
    });
  });
});

describe('createSilentLogger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes nothing at any level', () => {
    const logger = createSilentLogger();
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('child() returns another silent logger', () => {
    const logger = createSilentLogger();
    const child = logger.child({ component: 'test' });
    child.info('hello');
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
