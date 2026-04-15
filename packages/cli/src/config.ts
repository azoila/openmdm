import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { createJiti } from 'jiti';
import type { MDMInstance } from '@openmdm/core';

const CANDIDATE_PATHS = [
  'openmdm.config.ts',
  'openmdm.config.js',
  'openmdm.config.mjs',
  'src/mdm.ts',
  'src/mdm.js',
  'src/mdm.mjs',
  'mdm.ts',
  'mdm.js',
  'mdm.mjs',
];

export interface LoadMDMOptions {
  /**
   * Explicit path to a config file. If not provided, standard locations are searched.
   */
  config?: string;
  /**
   * Working directory for resolution (default: process.cwd()).
   */
  cwd?: string;
}

export class ConfigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveConfigPath(options: LoadMDMOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();

  if (options.config) {
    const abs = path.resolve(cwd, options.config);
    if (!(await fileExists(abs))) {
      throw new ConfigLoadError(`Config file not found: ${abs}`);
    }
    return abs;
  }

  for (const candidate of CANDIDATE_PATHS) {
    const abs = path.resolve(cwd, candidate);
    if (await fileExists(abs)) {
      return abs;
    }
  }

  throw new ConfigLoadError(
    `No OpenMDM config file found. Expected one of:\n  ${CANDIDATE_PATHS.join('\n  ')}\n` +
      `Create one by running: openmdm init`
  );
}

function isMDMInstance(value: unknown): value is MDMInstance {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.devices === 'object' &&
    typeof v.policies === 'object' &&
    typeof v.commands === 'object' &&
    typeof v.db === 'object'
  );
}

/**
 * Load the user's MDM instance by importing their config file.
 *
 * The user's file must export an `MDMInstance` as either:
 *   - a named export `mdm`
 *   - the default export
 *
 * TypeScript files are loaded via jiti with transpile-on-demand.
 */
export async function loadMDM(options: LoadMDMOptions = {}): Promise<MDMInstance> {
  const configPath = await resolveConfigPath(options);

  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    moduleCache: false,
  });

  let mod: Record<string, unknown>;
  try {
    mod = (await jiti.import(configPath)) as Record<string, unknown>;
  } catch (error) {
    throw new ConfigLoadError(
      `Failed to load config at ${configPath}: ${(error as Error).message}`
    );
  }

  const candidate =
    (mod as { mdm?: unknown }).mdm ??
    (mod as { default?: unknown }).default ??
    mod;

  if (!isMDMInstance(candidate)) {
    throw new ConfigLoadError(
      `${configPath} did not export an MDMInstance.\n` +
        `Expected a named export \`mdm\` or a default export returned by createMDM().`
    );
  }

  return candidate;
}

/**
 * Wrap a command handler so it gets an MDMInstance and exits cleanly afterwards.
 *
 * We force process.exit() because user config files typically open persistent
 * resources (database pools, MQTT clients, push adapters) that keep the event
 * loop alive. A CLI command should not hang after its work is done.
 */
export function withMDM<T extends unknown[]>(
  handler: (mdm: MDMInstance, ...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    let mdm: MDMInstance;
    try {
      mdm = await loadMDM();
    } catch (error) {
      if (error instanceof ConfigLoadError) {
        console.error(chalk.red('\n✖ ' + error.message + '\n'));
        process.exit(1);
      }
      throw error;
    }

    let exitCode = 0;
    try {
      await handler(mdm, ...args);
    } catch (error) {
      exitCode = 1;
      const err = error as Error;
      console.error(chalk.red(`\n✖ ${err.message}`));
      if (process.env.DEBUG) {
        console.error(chalk.gray(err.stack ?? ''));
      }
    } finally {
      process.exit(exitCode);
    }
  };
}
