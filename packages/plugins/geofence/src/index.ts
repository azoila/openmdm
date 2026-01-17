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
  MDMPlugin,
  MDMInstance,
  Device,
  DeviceLocation,
  Heartbeat,
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
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Check if point is inside circular zone
 */
function isInsideCircle(
  point: { latitude: number; longitude: number },
  center: { latitude: number; longitude: number },
  radiusMeters: number
): boolean {
  const distance = haversineDistance(
    point.latitude,
    point.longitude,
    center.latitude,
    center.longitude
  );
  return distance <= radiusMeters;
}

/**
 * Check if point is inside polygon using ray casting algorithm
 */
function isInsidePolygon(
  point: { latitude: number; longitude: number },
  vertices: Array<{ latitude: number; longitude: number }>
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

  // In-memory storage (should be moved to DB adapter in production)
  const zones = new Map<string, GeofenceZone>();
  const deviceZoneStates = new Map<string, Map<string, DeviceZoneState>>();
  const locationHistory = new Map<string, LocationHistoryEntry[]>();

  let zoneIdCounter = 1;

  /**
   * Generate zone ID
   */
  function generateZoneId(): string {
    return `zone_${Date.now()}_${zoneIdCounter++}`;
  }

  /**
   * Check if location is inside zone
   */
  function isInsideZone(
    location: DeviceLocation,
    zone: GeofenceZone
  ): boolean {
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
  async function processLocation(
    device: Device,
    location: DeviceLocation
  ): Promise<void> {
    if (!deviceZoneStates.has(device.id)) {
      deviceZoneStates.set(device.id, new Map());
    }
    const deviceStates = deviceZoneStates.get(device.id)!;

    const currentZones: string[] = [];

    for (const [zoneId, zone] of zones) {
      const wasInside = deviceStates.get(zoneId)?.inside ?? false;
      const isInside = isInsideZone(location, zone);

      if (isInside) {
        currentZones.push(zoneId);
      }

      if (isInside && !wasInside) {
        // Device entered zone
        const enteredAt = new Date();
        deviceStates.set(zoneId, {
          deviceId: device.id,
          zoneId,
          inside: true,
          enteredAt,
        });

        // Check dwell time
        const dwellTime = (zone.metadata?.dwellTime as number) ?? defaultDwellTime;

        if (dwellTime > 0) {
          setTimeout(async () => {
            const state = deviceStates.get(zoneId);
            if (state?.inside && state.enteredAt === enteredAt) {
              await triggerEnter(device, zone);
            }
          }, dwellTime);
        } else {
          await triggerEnter(device, zone);
        }
      } else if (!isInside && wasInside) {
        // Device exited zone
        const state = deviceStates.get(zoneId);
        deviceStates.set(zoneId, {
          deviceId: device.id,
          zoneId,
          inside: false,
          enteredAt: state?.enteredAt,
          exitedAt: new Date(),
          dwellTime: state?.enteredAt
            ? Date.now() - state.enteredAt.getTime()
            : undefined,
        });

        await triggerExit(device, zone);
      } else if (isInside) {
        // Device still inside
        await onInside?.(device, zone);
      }
    }

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
  async function triggerEnter(device: Device, zone: GeofenceZone): Promise<void> {
    console.log(`[OpenMDM Geofence] Device ${device.id} entered zone ${zone.name}`);

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
  async function triggerExit(device: Device, zone: GeofenceZone): Promise<void> {
    console.log(`[OpenMDM Geofence] Device ${device.id} exited zone ${zone.name}`);

    await onExit?.(device, zone);

    // Emit event
    const state = deviceZoneStates.get(device.id)?.get(zone.id);
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

    // Revert policy override (restore original policy)
    if (zone.policyOverride && device.policyId !== zone.policyOverride) {
      // Only if not still in another zone with same override
      const stillInOverrideZone = Array.from(zones.values()).some(
        (z) =>
          z.id !== zone.id &&
          z.policyOverride === zone.policyOverride &&
          deviceZoneStates.get(device.id)?.get(z.id)?.inside
      );

      if (!stillInOverrideZone) {
        // Revert to previous policy (would need to track original policy)
        console.log(
          `[OpenMDM Geofence] Policy override ended for device ${device.id}`
        );
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
    trigger: 'enter' | 'exit'
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
            console.error(
              `[OpenMDM Geofence] Webhook failed for zone ${zone.id}:`,
              error
            );
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
        const zoneList = Array.from(zones.values()).map((zone) => ({
          ...zone,
          createdAt: zone.createdAt.toISOString(),
          updatedAt: zone.updatedAt.toISOString(),
        }));
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
        const zone = zones.get(zoneId);

        if (!zone) {
          return context.json({ error: 'Zone not found' }, 404);
        }

        return context.json({
          ...zone,
          createdAt: zone.createdAt.toISOString(),
          updatedAt: zone.updatedAt.toISOString(),
        });
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
            return context.json(
              { error: 'Circle zone requires center and radius' },
              400
            );
          }
        } else if (body.type === 'polygon') {
          if (!body.vertices || body.vertices.length < 3) {
            return context.json(
              { error: 'Polygon zone requires at least 3 vertices' },
              400
            );
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

        zones.set(zone.id, zone);

        return context.json(
          {
            ...zone,
            createdAt: zone.createdAt.toISOString(),
            updatedAt: zone.updatedAt.toISOString(),
          },
          201
        );
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

        zones.set(zoneId, updated);

        return context.json({
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        });
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

        if (!zones.has(zoneId)) {
          return context.json({ error: 'Zone not found' }, 404);
        }

        zones.delete(zoneId);

        // Clean up device states for this zone
        for (const states of deviceZoneStates.values()) {
          states.delete(zoneId);
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

        if (!zones.has(zoneId)) {
          return context.json({ error: 'Zone not found' }, 404);
        }

        const devicesInZone: string[] = [];
        for (const [deviceId, states] of deviceZoneStates) {
          if (states.get(zoneId)?.inside) {
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
        const states = deviceZoneStates.get(deviceId);

        if (!states) {
          return context.json({ zones: [] });
        }

        const zoneStates = Array.from(states.values()).map((state) => ({
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
      console.log('[OpenMDM Geofence] Plugin initialized');
    },

    async onDestroy(): Promise<void> {
      zones.clear();
      deviceZoneStates.clear();
      locationHistory.clear();
      console.log('[OpenMDM Geofence] Plugin destroyed');
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

export {
  haversineDistance,
  isInsideCircle,
  isInsidePolygon,
  isZoneScheduleActive,
};

export type { MDMPlugin };
