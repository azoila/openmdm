/**
 * OpenMDM Geofencing Plugin
 *
 * Provides location-based policy enforcement and monitoring.
 * Supports circular and polygon geofence zones with enter/exit actions.
 *
 * @example
 * ```typescript
 * import { createMDM } from '@openmdm/core';
 * import { geofencePlugin } from '@openmdm/plugin-geofence';
 *
 * const mdm = createMDM({
 *   database: drizzleAdapter(db),
 *   plugins: [
 *     geofencePlugin({
 *       onEnter: async (device, zone) => {
 *         console.log(`Device ${device.id} entered ${zone.name}`);
 *       },
 *       onExit: async (device, zone) => {
 *         console.log(`Device ${device.id} left ${zone.name}`);
 *       },
 *     }),
 *   ],
 * });
 * ```
 */

import type {
  Device,
  DeviceLocation,
  Heartbeat,
  MDMInstance,
  MDMPlugin,
  PluginRoute,
} from '@openmdm/core';

// ============================================
// Geofence Types
// ============================================

export interface GeofencePluginOptions {
  /**
   * Callback when device enters a geofence zone
   */
  onEnter?: (device: Device, zone: GeofenceZone) => Promise<void>;

  /**
   * Callback when device exits a geofence zone
   */
  onExit?: (device: Device, zone: GeofenceZone) => Promise<void>;

  /**
   * Callback when device is inside a zone during heartbeat
   */
  onInside?: (device: Device, zone: GeofenceZone) => Promise<void>;

  /**
   * Default dwell time (ms) before triggering enter event (default: 0)
   */
  defaultDwellTime?: number;

  /**
   * Enable location history tracking (default: false)
   */
  trackHistory?: boolean;

  /**
   * Maximum history entries per device (default: 1000)
   */
  maxHistoryEntries?: number;
}

export interface GeofenceZone {
  id: string;
  name: string;
  description?: string;
  type: 'circle' | 'polygon';
  enabled: boolean;

  // Circle zone
  center?: {
    latitude: number;
    longitude: number;
  };
  radius?: number; // meters

  // Polygon zone
  vertices?: Array<{
    latitude: number;
    longitude: number;
  }>;

  // Actions
  onEnter?: GeofenceAction;
  onExit?: GeofenceAction;

  // Policy override when inside zone
  policyOverride?: string;

  // Scheduling
  schedule?: GeofenceSchedule;

  // Metadata
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeofenceAction {
  /** Action type */
  type: 'notify' | 'command' | 'policy' | 'webhook' | 'none';

  /** Notification message */
  notification?: {
    title: string;
    body: string;
  };

  /** Command to execute */
  command?: {
    type: string;
    payload?: Record<string, unknown>;
  };

  /** Policy to apply */
  policyId?: string;

  /** Webhook to call */
  webhook?: {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  };
}

export interface GeofenceSchedule {
  /** Days of week (0=Sunday, 6=Saturday) */
  daysOfWeek?: number[];

  /** Start time (HH:mm) */
  startTime?: string;

  /** End time (HH:mm) */
  endTime?: string;

  /** Timezone (default: UTC) */
  timezone?: string;
}

export interface DeviceZoneState {
  deviceId: string;
  zoneId: string;
  inside: boolean;
  enteredAt?: Date;
  exitedAt?: Date;
  dwellTime?: number;
  /**
   * The policy the device carried *before* this zone's `policyOverride` was
   * applied. Recorded on entry so exit can put it back — without it, "revert
   * the override" has nothing to revert to, which is why the old
   * implementation only logged and left the device on the zone's policy
   * forever.
   */
  previousPolicyId?: string | null;
}

export interface LocationHistoryEntry {
  deviceId: string;
  location: DeviceLocation;
  zones: string[]; // Zone IDs device was inside
  timestamp: Date;
}

export interface CreateGeofenceZoneInput {
  name: string;
  description?: string;
  type: 'circle' | 'polygon';
  enabled?: boolean;
  center?: { latitude: number; longitude: number };
  radius?: number;
  vertices?: Array<{ latitude: number; longitude: number }>;
  onEnter?: GeofenceAction;
  onExit?: GeofenceAction;
  policyOverride?: string;
  schedule?: GeofenceSchedule;
  metadata?: Record<string, unknown>;
}

export interface UpdateGeofenceZoneInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  center?: { latitude: number; longitude: number };
  radius?: number;
  vertices?: Array<{ latitude: number; longitude: number }>;
  onEnter?: GeofenceAction;
  onExit?: GeofenceAction;
  policyOverride?: string;
  schedule?: GeofenceSchedule;
  metadata?: Record<string, unknown>;
}

// ============================================
// Geo Utilities
// ============================================

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculate distance between two points using Haversine formula
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Check if point is inside circular zone
 */
function isInsideCircle(
  point: { latitude: number; longitude: number },
  center: { latitude: number; longitude: number },
  radiusMeters: number,
): boolean {
  const distance = haversineDistance(
    point.latitude,
    point.longitude,
    center.latitude,
    center.longitude,
  );
  return distance <= radiusMeters;
}

/**
 * Check if point is inside polygon using ray casting algorithm
 */
function isInsidePolygon(
  point: { latitude: number; longitude: number },
  vertices: Array<{ latitude: number; longitude: number }>,
): boolean {
  if (vertices.length < 3) return false;

  let inside = false;
  const n = vertices.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].longitude;
    const yi = vertices[i].latitude;
    const xj = vertices[j].longitude;
    const yj = vertices[j].latitude;

    const intersect =
      yi > point.latitude !== yj > point.latitude &&
      point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Check if zone is active according to schedule
 */
function isZoneScheduleActive(schedule: GeofenceSchedule | undefined): boolean {
  if (!schedule) return true;

  const now = new Date();
  const tz = schedule.timezone || 'UTC';

  // Get current time in zone's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(now);
  const currentHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0');
  const currentMinute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0');
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || '';

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const currentDay = weekdayMap[weekdayStr] ?? now.getDay();

  // Check day of week
  if (schedule.daysOfWeek && !schedule.daysOfWeek.includes(currentDay)) {
    return false;
  }

  // Check time window
  if (schedule.startTime && schedule.endTime) {
    const [startHour, startMin] = schedule.startTime.split(':').map(Number);
    const [endHour, endMin] = schedule.endTime.split(':').map(Number);

    const currentMins = currentHour * 60 + currentMinute;
    const startMins = startHour * 60 + startMin;
    const endMins = endHour * 60 + endMin;

    if (startMins <= endMins) {
      // Normal case: e.g., 09:00-17:00
      if (currentMins < startMins || currentMins > endMins) {
        return false;
      }
    } else {
      // Overnight case: e.g., 22:00-06:00
      if (currentMins < startMins && currentMins > endMins) {
        return false;
      }
    }
  }

  return true;
}

// ============================================
// Geofence Plugin Implementation
// ============================================

/**
 * Create geofencing plugin
 */
export function geofencePlugin(options: GeofencePluginOptions = {}): MDMPlugin {
  const {
    onEnter,
    onExit,
    onInside,
    defaultDwellTime = 0,
    trackHistory = false,
    maxHistoryEntries = 1000,
  } = options;

  let mdm: MDMInstance;

  // ============================================
  // Persistence
  // ============================================
  //
  // Zones and device-zone state used to live in plain in-process Maps, with a
  // comment conceding they "should be moved to DB adapter in production". They
  // were lost on every restart and invisible to a second replica: every zone an
  // operator had drawn vanished, and every device silently forgot which zones it
  // was inside — so the next heartbeat re-fired `enter` for zones the device had
  // been sitting in for a week, re-applying policy overrides and re-firing
  // webhooks.
  //
  // They now persist through `mdm.pluginStorage` (the same mechanism the kiosk
  // plugin uses). When the host has not configured it, we fall back to in-memory
  // Maps with a loud warning — acceptable for local development and tests only.
  const PLUGIN_NAME = 'geofence';
  /** Bound a zone webhook so a hanging endpoint cannot stall heartbeat processing. */
  const WEBHOOK_TIMEOUT_MS = 10_000;
  const ZONE_PREFIX = 'zone:';
  const STATE_PREFIX = 'state:';

  const zoneFallback = new Map<string, GeofenceZone>();
  const stateFallback = new Map<string, Record<string, DeviceZoneState>>();

  /** Location history stays in-process: it is a convenience buffer, not state. */
  const locationHistory = new Map<string, LocationHistoryEntry[]>();

  let zoneIdCounter = 1;

  function storage(): MDMInstance['pluginStorage'] {
    return mdm?.pluginStorage;
  }

  function log() {
    return mdm.logger.child({ component: 'plugin-geofence' });
  }

  /** Dates round-trip through JSON as strings; rehydrate them on read. */
  function rehydrateZone(value: unknown): GeofenceZone | null {
    if (!value || typeof value !== 'object') return null;
    return value as GeofenceZone;
  }

  function rehydrateState(value: unknown): Record<string, DeviceZoneState> {
    if (!value || typeof value !== 'object') return {};
    const raw = value as Record<string, any>;
    const out: Record<string, DeviceZoneState> = {};
    for (const [zoneId, state] of Object.entries(raw)) {
      out[zoneId] = {
        ...state,
        enteredAt: state.enteredAt ? new Date(state.enteredAt) : undefined,
        exitedAt: state.exitedAt ? new Date(state.exitedAt) : undefined,
      };
    }
    return out;
  }

  async function loadZones(): Promise<Map<string, GeofenceZone>> {
    const store = storage();
    if (!store) return zoneFallback;

    const keys = await store.list(PLUGIN_NAME, ZONE_PREFIX);
    const loaded = new Map<string, GeofenceZone>();
    for (const key of keys) {
      const zone = rehydrateZone(await store.get(PLUGIN_NAME, key));
      if (zone) loaded.set(zone.id, zone);
    }
    return loaded;
  }

  async function saveZone(zone: GeofenceZone): Promise<void> {
    const store = storage();
    if (!store) {
      zoneFallback.set(zone.id, zone);
      return;
    }
    await store.set(PLUGIN_NAME, `${ZONE_PREFIX}${zone.id}`, zone);
  }

  async function removeZone(zoneId: string): Promise<void> {
    const store = storage();
    if (!store) {
      zoneFallback.delete(zoneId);
      return;
    }
    await store.delete(PLUGIN_NAME, `${ZONE_PREFIX}${zoneId}`);
  }

  async function loadDeviceStates(deviceId: string): Promise<Record<string, DeviceZoneState>> {
    const store = storage();
    if (!store) {
      return stateFallback.get(deviceId) ?? {};
    }
    return rehydrateState(await store.get(PLUGIN_NAME, `${STATE_PREFIX}${deviceId}`));
  }

  async function saveDeviceStates(
    deviceId: string,
    states: Record<string, DeviceZoneState>,
  ): Promise<void> {
    const store = storage();
    if (!store) {
      stateFallback.set(deviceId, states);
      return;
    }
    await store.set(PLUGIN_NAME, `${STATE_PREFIX}${deviceId}`, states);
  }

  /** Device ids we hold zone state for. O(devices) — admin routes only. */
  async function listTrackedDeviceIds(): Promise<string[]> {
    const store = storage();
    if (!store) {
      return Array.from(stateFallback.keys());
    }
    const keys = await store.list(PLUGIN_NAME, STATE_PREFIX);
    return keys.map((key) => key.slice(STATE_PREFIX.length));
  }

  function serializeZone(zone: GeofenceZone) {
    return {
      ...zone,
      createdAt: new Date(zone.createdAt).toISOString(),
      updatedAt: new Date(zone.updatedAt).toISOString(),
    };
  }

  /**
   * Generate zone ID
   */
  function generateZoneId(): string {
    return `zone_${Date.now()}_${zoneIdCounter++}`;
  }

  /**
   * Check if location is inside zone
   */
  function isInsideZone(location: DeviceLocation, zone: GeofenceZone): boolean {
    if (!zone.enabled) return false;
    if (!isZoneScheduleActive(zone.schedule)) return false;

    if (zone.type === 'circle' && zone.center && zone.radius) {
      return isInsideCircle(location, zone.center, zone.radius);
    }

    if (zone.type === 'polygon' && zone.vertices) {
      return isInsidePolygon(location, zone.vertices);
    }

    return false;
  }

  /**
   * Process location update for a device
   */
  async function processLocation(device: Device, location: DeviceLocation): Promise<void> {
    const zones = await loadZones();
    const deviceStates = await loadDeviceStates(device.id);

    const currentZones: string[] = [];

    for (const [zoneId, zone] of zones) {
      const wasInside = deviceStates[zoneId]?.inside ?? false;
      const isInside = isInsideZone(location, zone);

      if (isInside) {
        currentZones.push(zoneId);
      }

      if (isInside && !wasInside) {
        // Device entered zone. Remember the policy it arrived with, so exit can
        // put it back if this zone applies an override.
        const enteredAt = new Date();
        deviceStates[zoneId] = {
          deviceId: device.id,
          zoneId,
          inside: true,
          enteredAt,
          previousPolicyId: zone.policyOverride ? (device.policyId ?? null) : undefined,
        };

        // Check dwell time
        const dwellTime = (zone.metadata?.dwellTime as number) ?? defaultDwellTime;

        if (dwellTime > 0) {
          // Dwell timers are in-process: a restart during the dwell window drops
          // the pending enter, and the next heartbeat re-evaluates from scratch.
          setTimeout(async () => {
            const current = await loadDeviceStates(device.id);
            const state = current[zoneId];
            if (state?.inside && state.enteredAt?.getTime() === enteredAt.getTime()) {
              await triggerEnter(device, zone, state);
            }
          }, dwellTime);
        } else {
          await triggerEnter(device, zone, deviceStates[zoneId]);
        }
      } else if (!isInside && wasInside) {
        // Device exited zone
        const previous = deviceStates[zoneId];
        deviceStates[zoneId] = {
          deviceId: device.id,
          zoneId,
          inside: false,
          enteredAt: previous?.enteredAt,
          exitedAt: new Date(),
          dwellTime: previous?.enteredAt ? Date.now() - previous.enteredAt.getTime() : undefined,
          previousPolicyId: previous?.previousPolicyId,
        };

        await triggerExit(device, zone, zones, deviceStates);
      } else if (isInside) {
        // Device still inside
        await onInside?.(device, zone);
      }
    }

    // Persist the device's zone membership. Without this the device forgets
    // which zones it is inside on every restart, and the next heartbeat re-fires
    // `enter` for zones it has been sitting in for a week — re-applying policy
    // overrides and re-firing webhooks.
    await saveDeviceStates(device.id, deviceStates);

    // Track history
    if (trackHistory) {
      if (!locationHistory.has(device.id)) {
        locationHistory.set(device.id, []);
      }
      const history = locationHistory.get(device.id)!;

      history.push({
        deviceId: device.id,
        location,
        zones: currentZones,
        timestamp: new Date(),
      });

      // Trim history
      if (history.length > maxHistoryEntries) {
        history.splice(0, history.length - maxHistoryEntries);
      }
    }
  }

  /**
   * Trigger enter event
   */
  async function triggerEnter(
    device: Device,
    zone: GeofenceZone,
    _state: DeviceZoneState,
  ): Promise<void> {
    log().info(
      { deviceId: device.id, zoneId: zone.id, zoneName: zone.name },
      'Device entered zone',
    );

    await onEnter?.(device, zone);

    // Emit event
    await mdm.emit('custom', {
      type: 'geofence.enter',
      deviceId: device.id,
      zoneId: zone.id,
      zoneName: zone.name,
      timestamp: new Date().toISOString(),
    });

    // Execute enter action
    if (zone.onEnter) {
      await executeAction(device, zone.onEnter, zone, 'enter');
    }

    // Apply policy override
    if (zone.policyOverride) {
      await mdm.devices.assignPolicy(device.id, zone.policyOverride);
    }
  }

  /**
   * Trigger exit event
   */
  async function triggerExit(
    device: Device,
    zone: GeofenceZone,
    zones: Map<string, GeofenceZone>,
    deviceStates: Record<string, DeviceZoneState>,
  ): Promise<void> {
    log().info({ deviceId: device.id, zoneId: zone.id, zoneName: zone.name }, 'Device exited zone');

    await onExit?.(device, zone);

    const state = deviceStates[zone.id];
    await mdm.emit('custom', {
      type: 'geofence.exit',
      deviceId: device.id,
      zoneId: zone.id,
      zoneName: zone.name,
      dwellTime: state?.dwellTime,
      timestamp: new Date().toISOString(),
    });

    // Execute exit action
    if (zone.onExit) {
      await executeAction(device, zone.onExit, zone, 'exit');
    }

    // Revert the policy override.
    //
    // This used to be a `console.log` that said "Policy override ended" and did
    // nothing — the device kept the zone's policy forever after leaving it, which
    // is the exact opposite of what a geofenced override is for. We now record
    // the pre-override policy on entry (`previousPolicyId`) and restore it here.
    if (zone.policyOverride) {
      // ...unless the device is still standing in another zone that applies the
      // same override.
      const stillOverridden = Array.from(zones.values()).some(
        (other) =>
          other.id !== zone.id &&
          other.policyOverride === zone.policyOverride &&
          deviceStates[other.id]?.inside,
      );

      if (stillOverridden) {
        log().debug(
          { deviceId: device.id, zoneId: zone.id },
          'Override retained: device is still inside another zone with the same override',
        );
      } else {
        const restoreTo = state?.previousPolicyId ?? null;

        if (restoreTo) {
          await mdm.devices.assignPolicy(device.id, restoreTo);
          log().info(
            { deviceId: device.id, zoneId: zone.id, policyId: restoreTo },
            'Reverted geofence policy override',
          );
        } else {
          // The device had no policy before the override. Clear it rather than
          // leaving the zone's policy stuck on a device that has left the zone.
          await mdm.devices.update(device.id, { policyId: null });
          log().info(
            { deviceId: device.id, zoneId: zone.id },
            'Cleared geofence policy override (device had no policy before entering)',
          );
        }
      }
    }
  }

  /**
   * Execute geofence action
   */
  async function executeAction(
    device: Device,
    action: GeofenceAction,
    zone: GeofenceZone,
    trigger: 'enter' | 'exit',
  ): Promise<void> {
    switch (action.type) {
      case 'notify':
        if (action.notification) {
          await mdm.commands.send({
            deviceId: device.id,
            type: 'sendNotification',
            payload: {
              title: action.notification.title,
              body: action.notification.body,
            },
          });
        }
        break;

      case 'command':
        if (action.command) {
          await mdm.commands.send({
            deviceId: device.id,
            type: action.command.type as any,
            payload: action.command.payload,
          });
        }
        break;

      case 'policy':
        if (action.policyId) {
          await mdm.devices.assignPolicy(device.id, action.policyId);
        }
        break;

      case 'webhook':
        if (action.webhook) {
          let controller: AbortController | undefined;
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          try {
            await fetch(action.webhook.url, {
              method: action.webhook.method || 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...action.webhook.headers,
              },
              body: JSON.stringify({
                event: `geofence.${trigger}`,
                device: {
                  id: device.id,
                  enrollmentId: device.enrollmentId,
                },
                zone: {
                  id: zone.id,
                  name: zone.name,
                },
                timestamp: new Date().toISOString(),
                ...action.webhook.body,
              }),
            });
          } catch (error) {
            // Swallowed deliberately: a zone's webhook endpoint being down must
            // not fail the heartbeat that triggered it. But it is logged, and the
            // request is bounded — an endpoint that simply hangs used to stall
            // heartbeat processing indefinitely, since there was no timeout.
            log().warn(
              {
                zoneId: zone.id,
                deviceId: device.id,
                trigger,
                err: error instanceof Error ? error.message : String(error),
              },
              'Geofence webhook failed',
            );
          } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
          }
        }
        break;
    }
  }

  // Define plugin routes
  const routes: PluginRoute[] = [
    // List all zones
    {
      method: 'GET',
      path: '/geofence/zones',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const zones = await loadZones();
        const zoneList = Array.from(zones.values()).map(serializeZone);
        return context.json({ zones: zoneList });
      },
    },

    // Get zone by ID
    {
      method: 'GET',
      path: '/geofence/zones/:zoneId',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const { zoneId } = context.req.param();
        const zones = await loadZones();
        const zone = zones.get(zoneId);

        if (!zone) {
          return context.json({ error: 'Zone not found' }, 404);
        }

        return context.json(serializeZone(zone));
      },
    },

    // Create zone
    {
      method: 'POST',
      path: '/geofence/zones',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const body = (await context.req.json()) as CreateGeofenceZoneInput;

        // Validate
        if (body.type === 'circle') {
          if (!body.center || !body.radius) {
            return context.json({ error: 'Circle zone requires center and radius' }, 400);
          }
        } else if (body.type === 'polygon') {
          if (!body.vertices || body.vertices.length < 3) {
            return context.json({ error: 'Polygon zone requires at least 3 vertices' }, 400);
          }
        }

        const zone: GeofenceZone = {
          id: generateZoneId(),
          name: body.name,
          description: body.description,
          type: body.type,
          enabled: body.enabled ?? true,
          center: body.center,
          radius: body.radius,
          vertices: body.vertices,
          onEnter: body.onEnter,
          onExit: body.onExit,
          policyOverride: body.policyOverride,
          schedule: body.schedule,
          metadata: body.metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await saveZone(zone);

        return context.json(serializeZone(zone), 201);
      },
    },

    // Update zone
    {
      method: 'PUT',
      path: '/geofence/zones/:zoneId',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const { zoneId } = context.req.param();
        const body = (await context.req.json()) as UpdateGeofenceZoneInput;

        const zones = await loadZones();
        const existing = zones.get(zoneId);
        if (!existing) {
          return context.json({ error: 'Zone not found' }, 404);
        }

        const updated: GeofenceZone = {
          ...existing,
          ...body,
          id: zoneId,
          type: existing.type, // Type cannot be changed
          createdAt: existing.createdAt,
          updatedAt: new Date(),
        };

        await saveZone(updated);

        return context.json(serializeZone(updated));
      },
    },

    // Delete zone
    {
      method: 'DELETE',
      path: '/geofence/zones/:zoneId',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const { zoneId } = context.req.param();
        const zones = await loadZones();

        if (!zones.has(zoneId)) {
          return context.json({ error: 'Zone not found' }, 404);
        }

        await removeZone(zoneId);

        // Drop this zone from every device's membership. A device still holding
        // state for a deleted zone would keep reporting itself inside it.
        for (const deviceId of await listTrackedDeviceIds()) {
          const states = await loadDeviceStates(deviceId);
          if (states[zoneId]) {
            delete states[zoneId];
            await saveDeviceStates(deviceId, states);
          }
        }

        return context.json({ success: true });
      },
    },

    // Get devices in zone
    {
      method: 'GET',
      path: '/geofence/zones/:zoneId/devices',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const { zoneId } = context.req.param();
        const zones = await loadZones();

        if (!zones.has(zoneId)) {
          return context.json({ error: 'Zone not found' }, 404);
        }

        const devicesInZone: string[] = [];
        for (const deviceId of await listTrackedDeviceIds()) {
          const states = await loadDeviceStates(deviceId);
          if (states[zoneId]?.inside) {
            devicesInZone.push(deviceId);
          }
        }

        return context.json({ deviceIds: devicesInZone });
      },
    },

    // Get device zone status
    {
      method: 'GET',
      path: '/geofence/devices/:deviceId/zones',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const { deviceId } = context.req.param();
        const zones = await loadZones();
        const states = await loadDeviceStates(deviceId);

        const zoneStates = Object.values(states).map((state) => ({
          ...state,
          enteredAt: state.enteredAt?.toISOString(),
          exitedAt: state.exitedAt?.toISOString(),
          zoneName: zones.get(state.zoneId)?.name,
        }));

        return context.json({ zones: zoneStates });
      },
    },

    // Get device location history
    {
      method: 'GET',
      path: '/geofence/devices/:deviceId/history',
      auth: true,
      admin: true,
      handler: async (context: any) => {
        const { deviceId } = context.req.param();
        const history = locationHistory.get(deviceId) || [];

        return context.json({
          history: history.map((entry) => ({
            ...entry,
            timestamp: entry.timestamp.toISOString(),
          })),
        });
      },
    },

    // Check if point is in any zone
    {
      method: 'POST',
      path: '/geofence/check',
      auth: true,
      handler: async (context: any) => {
        const body = await context.req.json();
        const { latitude, longitude } = body;

        const zones = await loadZones();
        const matchingZones: string[] = [];
        const location = { latitude, longitude, timestamp: new Date() };

        for (const [zoneId, zone] of zones) {
          if (isInsideZone(location, zone)) {
            matchingZones.push(zoneId);
          }
        }

        return context.json({
          inside: matchingZones.length > 0,
          zones: matchingZones.map((id) => ({
            id,
            name: zones.get(id)?.name,
          })),
        });
      },
    },
  ];

  return {
    name: 'geofence',
    version: '1.0.0',

    async onInit(instance: MDMInstance): Promise<void> {
      mdm = instance;

      if (!instance.pluginStorage) {
        log().warn(
          'pluginStorage is not configured — geofence zones and device zone ' +
            'membership will be held in process memory only. They are lost on ' +
            'restart and invisible to other replicas, so devices will re-fire ' +
            '`enter` for zones they never left. Configure ' +
            "`pluginStorage: { adapter: 'database' }` on createMDM for production.",
        );
      }

      log().info('Geofence plugin initialized');
    },

    async onDestroy(): Promise<void> {
      // Only the in-process caches are dropped. Persisted zones and device
      // membership survive by design — that is the whole point.
      zoneFallback.clear();
      stateFallback.clear();
      locationHistory.clear();
      log().info('Geofence plugin destroyed');
    },

    routes,

    async onHeartbeat(device: Device, heartbeat: Heartbeat): Promise<void> {
      if (heartbeat.location) {
        await processLocation(device, heartbeat.location);
      }
    },
  };
}

// ============================================
// Exports
// ============================================

export type { MDMPlugin };
export { haversineDistance, isInsideCircle, isInsidePolygon, isZoneScheduleActive };
