/**
 * OpenMDM Logger
 *
 * Default logger implementations and helpers. Production users are
 * expected to pass their own pino/winston/bunyan instance via
 * `createMDM({ logger })`; these defaults are for development and
 * for the zero-config path.
 */

import type { Logger, LogContext } from './types';

/**
 * Resolve (context, message) or (message) argument forms into a
 * single shape. Matches the pino call convention used by the Logger
 * interface.
 */
function normalize(
  ...args: [LogContext, string] | [string]
): { context: LogContext | undefined; message: string } {
  if (args.length === 1) {
    return { context: undefined, message: args[0] };
  }
  return { context: args[0], message: args[1] };
}

/**
 * Console-backed logger. Writes JSON-ish lines to stdout/stderr with
 * an `[openmdm]` prefix so they stand out in a mixed-log stream.
 *
 * This is the zero-config default — it intentionally does the
 * minimum viable thing. Hosts running in production should replace
 * it with a real structured logger.
 */
export function createConsoleLogger(scope: string[] = []): Logger {
  const prefix = scope.length > 0 ? `[openmdm:${scope.join(':')}]` : '[openmdm]';

  const render = (context: LogContext | undefined): string => {
    if (!context || Object.keys(context).length === 0) return '';
    // Keep single-line to remain friendly to `grep`. JSON.stringify is
    // the cheapest structured-output format that every production
    // logger can consume as-is.
    try {
      return ' ' + JSON.stringify(context);
    } catch {
      // Fall back to a string cast when the context has a circular
      // reference — losing structure is better than crashing the call
      // site.
      return ' ' + String(context);
    }
  };

  return {
    debug: (...args: [LogContext, string] | [string]) => {
      const { context, message } = normalize(...args);
      // Debug is off by default when no DEBUG env var is set — keeps
      // the dev experience quiet unless someone opts in.
      if (!process.env.DEBUG) return;
      console.debug(`${prefix} ${message}${render(context)}`);
    },
    info: (...args: [LogContext, string] | [string]) => {
      const { context, message } = normalize(...args);
      console.log(`${prefix} ${message}${render(context)}`);
    },
    warn: (...args: [LogContext, string] | [string]) => {
      const { context, message } = normalize(...args);
      console.warn(`${prefix} ${message}${render(context)}`);
    },
    error: (...args: [LogContext, string] | [string]) => {
      const { context, message } = normalize(...args);
      console.error(`${prefix} ${message}${render(context)}`);
    },
    child: (bindings: LogContext): Logger => {
      // Console logger's `child` extends the scope with any
      // `component` field if provided, otherwise appends nothing
      // meaningful and just returns a new logger with the same
      // scope. Real loggers (pino) properly attach bindings to every
      // subsequent call — we do the simplest thing that won't lie.
      const componentPart =
        typeof bindings.component === 'string' ? [bindings.component] : [];
      return createConsoleLogger([...scope, ...componentPart]);
    },
  };
}

/**
 * No-op logger. Use to silence OpenMDM entirely — e.g. in tests or in
 * environments where log noise is inappropriate.
 */
export function createSilentLogger(): Logger {
  const silent: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => silent,
  };
  return silent;
}
