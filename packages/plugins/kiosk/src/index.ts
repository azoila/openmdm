/**
 * OpenMDM Kiosk Mode Plugin
 *
 * Provides kiosk/lockdown mode functionality for Android devices.
 * Supports single-app mode, multi-app kiosk, and screen pinning.
 *
 * @example
 * ```typescript
 * import { createMDM } from '@openmdm/core';
 * import { kioskPlugin } from '@openmdm/plugin-kiosk';
 *
 * const mdm = createMDM({
 *   database: drizzleAdapter(db),
 *   plugins: [
 *     kioskPlugin({
 *       defaultExitPassword: 'admin123',
 *       allowRemoteExit: true,
 *     }),
 *   ],
 * });
 * ```
 */

import type {
  MDMPlugin,
  MDMInstance,
  Device,
  Policy,
  PolicySettings,
  Command,
  CommandResult,
  Heartbeat,
  PluginRoute,
} from '@openmdm/core';

// ============================================
// Kiosk Types
// ============================================

export interface KioskPluginOptions {
  /**
   * Default password for exiting kiosk mode
   * Can be overridden per-policy
   */
  defaultExitPassword?: string;

  /**
   * Allow remote exit command from server
   */
  allowRemoteExit?: boolean;

  /**
   * Auto-lock device when kiosk app crashes
   */
  lockOnCrash?: boolean;

  /**
   * Restart kiosk app if it closes
   */
  autoRestart?: boolean;

  /**
   * Auto-restart delay in milliseconds
   */
  autoRestartDelay?: number;

  /**
   * Maximum exit password attempts before lock
   */
  maxExitAttempts?: number;

  /**
   * Lockout duration in minutes after max attempts
   */
  lockoutDuration?: number;
}

export interface KioskSettings {
  /** Enable kiosk mode */
  enabled: boolean;

  /** Kiosk mode type */
  mode: 'single-app' | 'multi-app' | 'screen-pin';

  /** Main/launcher app package name */
  mainApp: string;

  /** Allowed apps in multi-app mode */
  allowedApps?: string[];

  /** Password to exit kiosk mode (device-side) */
  exitPassword?: string;

  /** Secret gesture to trigger exit (e.g., '5-tap-corners') */
  exitGesture?: string;

  /** Lock status bar */
  lockStatusBar?: boolean;

  /** Lock navigation bar */
  lockNavigationBar?: boolean;

  /** Disable home button */
  disableHomeButton?: boolean;

  /** Disable recent apps button */
  disableRecentApps?: boolean;

  /** Disable power button (soft) */
  disablePowerButton?: boolean;

  /** Disable volume buttons */
  disableVolumeButtons?: boolean;

  /** Lock screen orientation */
  lockOrientation?: 'portrait' | 'landscape' | 'auto';

  /** Disable notifications */
  disableNotifications?: boolean;

  /** Allowed notification packages */
  allowedNotifications?: string[];

  /** Keep screen on */
  keepScreenOn?: boolean;

  /** Screen brightness (0-255, or 'auto') */
  screenBrightness?: number | 'auto';

  /** Auto-launch on boot */
  launchOnBoot?: boolean;

  /** Auto-restart on crash */
  restartOnCrash?: boolean;

  /** Restart delay in ms */
  restartDelay?: number;

  /** Custom wallpaper URL */
  wallpaperUrl?: string;

  /** Hide system UI elements */
  immersiveMode?: boolean;

  /** Allow status bar pull-down for specific items */
  allowedStatusBarItems?: ('wifi' | 'bluetooth' | 'airplane' | 'battery')[];

  /** Show clock/time */
  showClock?: boolean;

  /** Show battery indicator */
  showBattery?: boolean;

  /** Custom exit password per device (encrypted) */
  deviceExitPasswords?: Record<string, string>;
}

export interface KioskState {
  deviceId: string;
  enabled: boolean;
  mode: 'single-app' | 'multi-app' | 'screen-pin';
  mainApp: string;
  activeApp?: string;
  lockedSince?: Date;
  exitAttempts: number;
  lastExitAttempt?: Date;
  lockedOut: boolean;
  lockoutUntil?: Date;
}

// ============================================
// Kiosk Plugin Implementation
// ============================================

/**
 * Create kiosk mode plugin
 */
export function kioskPlugin(options: KioskPluginOptions = {}): MDMPlugin {
  const {
    defaultExitPassword = 'admin',
    allowRemoteExit = true,
    lockOnCrash = true,
    autoRestart = true,
    autoRestartDelay = 1000,
    maxExitAttempts = 5,
    lockoutDuration = 15,
  } = options;

  let mdm: MDMInstance;

  // Kiosk state persistence.
  //
  // Lockout counters, the enabled/disabled flag, and the `mainApp` a
  // device is locked to are *all* critical state. If they live only in
  // process memory, a restart or a second replica silently loses them
  // and a device either falls out of kiosk mode or escapes its lockout
  // timer. Both failure modes have bitten production fleets before.
  //
  // When the host configures `pluginStorage` on createMDM, we persist
  // every write through that adapter so state survives restarts and
  // horizontal scaling works. When it is not configured, we fall back
  // to an in-memory Map with a startup warning — that path is only
  // acceptable for local development and tests.
  const PLUGIN_NAME = 'kiosk';
  const inMemoryFallback = new Map<string, KioskState>();

  function storage(): MDMInstance['pluginStorage'] {
    return mdm?.pluginStorage;
  }

  /**
   * Dates round-trip through JSON as strings; rehydrate them on read.
   */
  function rehydrate(value: unknown): KioskState | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    return {
      deviceId: v.deviceId as string,
      enabled: Boolean(v.enabled),
      mode: v.mode as KioskState['mode'],
      mainApp: (v.mainApp as string) ?? '',
      activeApp: v.activeApp as string | undefined,
      lockedSince: v.lockedSince ? new Date(v.lockedSince as string) : undefined,
      exitAttempts: typeof v.exitAttempts === 'number' ? v.exitAttempts : 0,
      lastExitAttempt: v.lastExitAttempt
        ? new Date(v.lastExitAttempt as string)
        : undefined,
      lockedOut: Boolean(v.lockedOut),
      lockoutUntil: v.lockoutUntil ? new Date(v.lockoutUntil as string) : undefined,
    };
  }

  /**
   * Get kiosk settings from policy
   */
  function getKioskSettings(policy: Policy): KioskSettings | null {
    const settings = policy.settings;

    if (!settings.kioskMode || !settings.mainApp) {
      return null;
    }

    return {
      enabled: settings.kioskMode,
      mode: 'single-app', // Default mode
      mainApp: settings.mainApp,
      allowedApps: settings.allowedApps,
      exitPassword: settings.kioskExitPassword || defaultExitPassword,
      lockStatusBar: settings.lockStatusBar ?? true,
      lockNavigationBar: settings.lockNavigationBar ?? true,
      disableHomeButton: true,
      disableRecentApps: true,
      disablePowerButton: settings.lockPowerButton ?? false,
      keepScreenOn: true,
      launchOnBoot: true,
      restartOnCrash: autoRestart,
      restartDelay: autoRestartDelay,
      immersiveMode: true,
      showClock: true,
      showBattery: true,
      ...(settings.custom?.kiosk as Partial<KioskSettings>),
    };
  }

  /**
   * Get kiosk state for a device. Returns `undefined` if the device
   * has no tracked state (never entered kiosk mode).
   */
  async function getKioskState(deviceId: string): Promise<KioskState | undefined> {
    const store = storage();
    if (store) {
      const raw = await store.get<KioskState>(PLUGIN_NAME, deviceId);
      return rehydrate(raw) ?? undefined;
    }
    return inMemoryFallback.get(deviceId);
  }

  /**
   * Upsert kiosk state for a device. Reads the current value, merges
   * the partial, and writes it back. This is last-write-wins — if two
   * replicas race on the same device, the second write overwrites the
   * first. That is acceptable for this workload: the only concurrent
   * writers are the device itself (via the heartbeat) and the admin
   * side (via explicit commands), and neither path races at the level
   * where an update could be lost without also being recomputed on
   * the next heartbeat.
   */
  async function updateKioskState(
    deviceId: string,
    updates: Partial<KioskState>
  ): Promise<KioskState> {
    const current = (await getKioskState(deviceId)) ?? {
      deviceId,
      enabled: false,
      mode: 'single-app' as const,
      mainApp: '',
      exitAttempts: 0,
      lockedOut: false,
    };

    const updated: KioskState = { ...current, ...updates, deviceId };

    const store = storage();
    if (store) {
      await store.set(PLUGIN_NAME, deviceId, updated);
    } else {
      inMemoryFallback.set(deviceId, updated);
    }
    return updated;
  }

  /**
   * List every device with a known kiosk state. Used by the admin
   * listing route. Note: this loads every key under the plugin
   * namespace on each call, which is fine at fleet scale because the
   * cardinality is bounded by the number of devices that have ever
   * been in kiosk mode, not by event volume.
   */
  async function listKioskStates(): Promise<KioskState[]> {
    const store = storage();
    if (store) {
      const keys = await store.list(PLUGIN_NAME);
      const states = await Promise.all(
        keys.map(async (k) => rehydrate(await store.get(PLUGIN_NAME, k))),
      );
      return states.filter((s): s is KioskState => s !== null);
    }
    return Array.from(inMemoryFallback.values());
  }

  /**
   * Handle exit kiosk command
   */
  async function handleExitKiosk(
    device: Device,
    command: Command
  ): Promise<CommandResult> {
    if (!allowRemoteExit) {
      return {
        success: false,
        message: 'Remote kiosk exit is disabled',
      };
    }

    const state = await getKioskState(device.id);
    if (!state?.enabled) {
      return {
        success: true,
        message: 'Device is not in kiosk mode',
      };
    }

    // Update state
    await updateKioskState(device.id, {
      enabled: false,
      exitAttempts: 0,
      lockedOut: false,
    });

    // Emit event
    await mdm.emit('custom', {
      type: 'kiosk.exited',
      deviceId: device.id,
      method: 'remote',
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      message: 'Kiosk mode exit command sent',
    };
  }

  /**
   * Handle enter kiosk command
   */
  async function handleEnterKiosk(
    device: Device,
    command: Command
  ): Promise<CommandResult> {
    const payload = command.payload as { app?: string } | undefined;

    // Get policy kiosk settings
    let kioskSettings: KioskSettings | null = null;
    if (device.policyId) {
      const policy = await mdm.policies.get(device.policyId);
      if (policy) {
        kioskSettings = getKioskSettings(policy);
      }
    }

    const mainApp = payload?.app || kioskSettings?.mainApp;
    if (!mainApp) {
      return {
        success: false,
        message: 'No main app specified for kiosk mode',
      };
    }

    // Update state
    await updateKioskState(device.id, {
      enabled: true,
      mode: kioskSettings?.mode || 'single-app',
      mainApp,
      lockedSince: new Date(),
      exitAttempts: 0,
      lockedOut: false,
    });

    // Emit event
    await mdm.emit('custom', {
      type: 'kiosk.entered',
      deviceId: device.id,
      mainApp,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      message: `Kiosk mode activated with ${mainApp}`,
      data: { mainApp },
    };
  }

  /**
   * Validate kiosk policy settings
   */
  function validateKioskPolicy(
    settings: PolicySettings
  ): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    if (settings.kioskMode) {
      if (!settings.mainApp) {
        errors.push('Kiosk mode requires a main app package name');
      }

      if (settings.allowedApps && settings.allowedApps.length > 0) {
        if (!settings.allowedApps.includes(settings.mainApp!)) {
          errors.push('Main app must be included in allowed apps list');
        }
      }

      const custom = settings.custom?.kiosk as Partial<KioskSettings> | undefined;
      if (custom?.mode === 'multi-app' && !settings.allowedApps?.length) {
        errors.push('Multi-app kiosk mode requires allowed apps list');
      }

      if (custom?.screenBrightness !== undefined && custom.screenBrightness !== 'auto') {
        if (typeof custom.screenBrightness === 'number') {
          if (custom.screenBrightness < 0 || custom.screenBrightness > 255) {
            errors.push('Screen brightness must be between 0-255 or "auto"');
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // Define plugin routes
  const routes: PluginRoute[] = [
    // Get kiosk status for a device
    {
      method: 'GET',
      path: '/kiosk/:deviceId/status',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const { deviceId } = context.req.param();
        const state = await getKioskState(deviceId);

        if (!state) {
          return context.json({ enabled: false });
        }

        return context.json({
          ...state,
          lockedSince: state.lockedSince?.toISOString(),
          lastExitAttempt: state.lastExitAttempt?.toISOString(),
          lockoutUntil: state.lockoutUntil?.toISOString(),
        });
      },
    },

    // Enter kiosk mode
    {
      method: 'POST',
      path: '/kiosk/:deviceId/enter',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const { deviceId } = context.req.param();
        const body = await context.req.json();

        const command = await mdm.commands.send({
          deviceId,
          type: 'enterKiosk',
          payload: { app: body.app },
        });

        return context.json({ success: true, commandId: command.id });
      },
    },

    // Exit kiosk mode
    {
      method: 'POST',
      path: '/kiosk/:deviceId/exit',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const { deviceId } = context.req.param();

        const command = await mdm.commands.send({
          deviceId,
          type: 'exitKiosk',
        });

        return context.json({ success: true, commandId: command.id });
      },
    },

    // Get all devices in kiosk mode
    {
      method: 'GET',
      path: '/kiosk/devices',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const all = await listKioskStates();
        const kioskDevices = all
          .filter((state) => state.enabled)
          .map((state) => ({
            ...state,
            lockedSince: state.lockedSince?.toISOString(),
          }));

        return context.json({ devices: kioskDevices });
      },
    },

    // Report exit attempt from device
    {
      method: 'POST',
      path: '/kiosk/exit-attempt',
      auth: true,
      handler: async (context: any) => {
        const body = await context.req.json();
        const { deviceId, success, password } = body;

        const state = await getKioskState(deviceId);
        if (!state?.enabled) {
          return context.json({ error: 'Device not in kiosk mode' }, 400);
        }

        // Check lockout
        if (state.lockedOut && state.lockoutUntil) {
          if (new Date() < state.lockoutUntil) {
            return context.json({
              error: 'Exit attempts locked',
              lockoutUntil: state.lockoutUntil.toISOString(),
            }, 403);
          } else {
            // Lockout expired
            await updateKioskState(deviceId, {
              lockedOut: false,
              lockoutUntil: undefined,
              exitAttempts: 0,
            });
          }
        }

        if (success) {
          // Successful exit
          await updateKioskState(deviceId, {
            enabled: false,
            exitAttempts: 0,
          });

          await mdm.emit('custom', {
            type: 'kiosk.exited',
            deviceId,
            method: 'local',
            timestamp: new Date().toISOString(),
          });

          return context.json({ success: true });
        } else {
          // Failed attempt
          const newAttempts = state.exitAttempts + 1;

          if (newAttempts >= maxExitAttempts) {
            // Lock out
            const lockoutUntil = new Date(
              Date.now() + lockoutDuration * 60 * 1000
            );

            await updateKioskState(deviceId, {
              exitAttempts: newAttempts,
              lastExitAttempt: new Date(),
              lockedOut: true,
              lockoutUntil,
            });

            await mdm.emit('custom', {
              type: 'kiosk.lockout',
              deviceId,
              attempts: newAttempts,
              lockoutUntil: lockoutUntil.toISOString(),
            });

            return context.json({
              error: 'Max attempts exceeded',
              lockedOut: true,
              lockoutUntil: lockoutUntil.toISOString(),
            }, 403);
          } else {
            await updateKioskState(deviceId, {
              exitAttempts: newAttempts,
              lastExitAttempt: new Date(),
            });

            return context.json({
              error: 'Invalid password',
              attemptsRemaining: maxExitAttempts - newAttempts,
            }, 401);
          }
        }
      },
    },

    // Report kiosk app crash from device
    {
      method: 'POST',
      path: '/kiosk/app-crash',
      auth: true,
      handler: async (context: any) => {
        const body = await context.req.json();
        const { deviceId, packageName, error } = body;

        await mdm.emit('custom', {
          type: 'kiosk.appCrash',
          deviceId,
          packageName,
          error,
          timestamp: new Date().toISOString(),
        });

        const state = await getKioskState(deviceId);
        const shouldRestart = state?.enabled && autoRestart;

        return context.json({
          restart: shouldRestart,
          restartDelay: autoRestartDelay,
          lockDevice: lockOnCrash,
        });
      },
    },
  ];

  return {
    name: 'kiosk',
    version: '1.0.0',

    async onInit(instance: MDMInstance): Promise<void> {
      mdm = instance;
      const log = instance.logger.child({ component: 'plugin-kiosk' });
      if (!instance.pluginStorage) {
        log.warn(
          {
            reason: 'pluginStorage-not-configured',
            fallback: 'in-memory',
          },
          'Kiosk lockout state will be lost on restart and across replicas. ' +
            'Pass pluginStorage: { adapter: "database" } to createMDM for ' +
            'production setups. See docs/concepts/architecture.',
        );
      }
      log.info('Plugin initialized');
    },

    async onDestroy(): Promise<void> {
      inMemoryFallback.clear();
      mdm?.logger
        .child({ component: 'plugin-kiosk' })
        .info('Plugin destroyed');
    },

    routes,

    async onDeviceEnrolled(device: Device): Promise<void> {
      // Initialize kiosk state for new device
      if (device.policyId) {
        const policy = await mdm.policies.get(device.policyId);
        if (policy) {
          const kioskSettings = getKioskSettings(policy);
          if (kioskSettings?.enabled) {
            await updateKioskState(device.id, {
              enabled: true,
              mode: kioskSettings.mode,
              mainApp: kioskSettings.mainApp,
              lockedSince: new Date(),
            });
          }
        }
      }
    },

    async onHeartbeat(device: Device, heartbeat: Heartbeat): Promise<void> {
      const state = await getKioskState(device.id);

      if (state?.enabled && heartbeat.runningApps) {
        // Check if kiosk app is still running
        const isKioskAppRunning = heartbeat.runningApps.includes(state.mainApp);

        if (!isKioskAppRunning && autoRestart) {
          // Kiosk app is not running - send restart command
          await mdm.commands.send({
            deviceId: device.id,
            type: 'runApp',
            payload: { packageName: state.mainApp },
          });
        }
      }
    },

    policySchema: {
      kioskMode: { type: 'boolean', description: 'Enable kiosk mode' },
      mainApp: {
        type: 'string',
        description: 'Main kiosk app package name',
      },
      allowedApps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Allowed apps in kiosk mode',
      },
      kioskExitPassword: {
        type: 'string',
        description: 'Password to exit kiosk mode',
      },
    },

    validatePolicy: async (settings: PolicySettings) => {
      return validateKioskPolicy(settings);
    },

    commandTypes: ['enterKiosk', 'exitKiosk'] as any,

    executeCommand: async (
      device: Device,
      command: Command
    ): Promise<CommandResult> => {
      switch (command.type) {
        case 'enterKiosk':
          return handleEnterKiosk(device, command);
        case 'exitKiosk':
          return handleExitKiosk(device, command);
        default:
          return {
            success: false,
            message: `Unknown command type: ${command.type}`,
          };
      }
    },
  };
}

// ============================================
// Exports
// ============================================

export type { MDMPlugin };
