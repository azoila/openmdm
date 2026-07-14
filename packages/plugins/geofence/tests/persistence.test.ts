/**
 * Geofence persistence and policy-override revert.
 *
 * Zones and device-zone membership used to live in plain in-process Maps, with
 * a comment conceding they "should be moved to DB adapter in production". Two
 * things followed:
 *
 * 1. Every zone an operator had drawn vanished on restart, and every device
 *    forgot which zones it was inside — so the next heartbeat re-fired `enter`
 *    for a zone the device had been sitting in for a week, re-applying policy
 *    overrides and re-firing webhooks.
 * 2. The policy-override revert was a `console.log` that said "Policy override
 *    ended" and did nothing. A device that drove into a geofenced zone kept that
 *    zone's policy **forever after leaving it** — the exact opposite of what a
 *    geofenced override is for.
 */

import type { Device, MDMInstance, PluginStorageAdapter } from '@openmdm/core';
import { createMemoryPluginStorageAdapter, createSilentLogger } from '@openmdm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geofencePlugin } from '../src/index';

// Zone at the origin; "inside" is within 1km.
const ORIGIN = { latitude: 0, longitude: 0 };
const FAR_AWAY = { latitude: 10, longitude: 10 };

interface Harness {
  plugin: ReturnType<typeof geofencePlugin>;
  mdm: MDMInstance;
  storage: PluginStorageAdapter;
  assignPolicy: ReturnType<typeof vi.fn>;
  updateDevice: ReturnType<typeof vi.fn>;
  route: (method: string, path: string) => any;
}

/**
 * Build a plugin bound to a shared storage adapter. Passing the same adapter to
 * two harnesses simulates a restart (or a second replica): the process memory is
 * new, the storage is not.
 */
async function buildHarness(storage: PluginStorageAdapter): Promise<Harness> {
  const plugin = geofencePlugin();

  const assignPolicy = vi.fn(async () => ({}) as Device);
  const updateDevice = vi.fn(async () => ({}) as Device);

  const mdm = {
    pluginStorage: storage,
    logger: createSilentLogger(),
    emit: vi.fn(async () => {}),
    devices: { assignPolicy, update: updateDevice },
  } as unknown as MDMInstance;

  await plugin.onInit?.(mdm);

  const route = (method: string, path: string) => {
    const found = plugin.routes?.find((r) => r.method === method && r.path === path);
    if (!found) throw new Error(`No route ${method} ${path}`);
    return found.handler;
  };

  return { plugin, mdm, storage, assignPolicy, updateDevice, route };
}

/** Minimal Hono-ish context stand-in. */
function ctx(body?: unknown, params: Record<string, string> = {}) {
  return {
    req: {
      json: async () => body,
      param: () => params,
    },
    json: (payload: unknown, status = 200) => ({ payload, status }),
  };
}

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'device-1',
    enrollmentId: 'enroll-1',
    status: 'enrolled',
    policyId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Device;
}

function heartbeatAt(location: { latitude: number; longitude: number }) {
  return {
    deviceId: 'device-1',
    timestamp: new Date(),
    location: { ...location, timestamp: new Date() },
  } as never;
}

async function createZone(h: Harness, body: Record<string, unknown>) {
  const res = await h.route('POST', '/geofence/zones')(ctx(body));
  return res.payload;
}

describe('zone persistence', () => {
  let storage: PluginStorageAdapter;

  beforeEach(() => {
    storage = createMemoryPluginStorageAdapter();
  });

  it('a zone survives a restart', async () => {
    const first = await buildHarness(storage);
    const zone = await createZone(first, {
      name: 'Depot',
      type: 'circle',
      center: ORIGIN,
      radius: 1000,
    });
    expect(zone.id).toBeTruthy();

    // Restart: new process, same storage.
    const second = await buildHarness(storage);
    const listed = await second.route('GET', '/geofence/zones')(ctx());

    expect(listed.payload.zones).toHaveLength(1);
    expect(listed.payload.zones[0].name).toBe('Depot');
  });

  it('a deleted zone stays deleted', async () => {
    const h = await buildHarness(storage);
    const zone = await createZone(h, {
      name: 'Depot',
      type: 'circle',
      center: ORIGIN,
      radius: 1000,
    });

    await h.route('DELETE', '/geofence/zones/:zoneId')(ctx(undefined, { zoneId: zone.id }));

    const after = await buildHarness(storage);
    const listed = await after.route('GET', '/geofence/zones')(ctx());
    expect(listed.payload.zones).toHaveLength(0);
  });

  it('device zone membership survives a restart — no duplicate enter', async () => {
    const first = await buildHarness(storage);
    await createZone(first, { name: 'Depot', type: 'circle', center: ORIGIN, radius: 1000 });

    const onEnterBefore = vi.fn();
    // Drive the device into the zone.
    await first.plugin.onHeartbeat?.(device(), heartbeatAt(ORIGIN));

    // Restart, and heartbeat again from the SAME place.
    const second = await buildHarness(storage);
    const enterSpy = vi.fn();
    second.mdm.emit = enterSpy;

    await second.plugin.onHeartbeat?.(device(), heartbeatAt(ORIGIN));

    // The device never left, so no fresh `enter` may fire. Before persistence,
    // the restart wiped membership and this re-fired enter for a zone the device
    // had been parked in the whole time.
    const enterEvents = enterSpy.mock.calls.filter(
      (call) => (call[1] as any)?.type === 'geofence.enter',
    );
    expect(enterEvents).toHaveLength(0);
    expect(onEnterBefore).not.toHaveBeenCalled();
  });

  it('reports which devices are inside a zone after a restart', async () => {
    const first = await buildHarness(storage);
    const zone = await createZone(first, {
      name: 'Depot',
      type: 'circle',
      center: ORIGIN,
      radius: 1000,
    });
    await first.plugin.onHeartbeat?.(device(), heartbeatAt(ORIGIN));

    const second = await buildHarness(storage);
    const res = await second.route(
      'GET',
      '/geofence/zones/:zoneId/devices',
    )(ctx(undefined, { zoneId: zone.id }));

    expect(res.payload.deviceIds).toEqual(['device-1']);
  });
});

describe('policy override revert', () => {
  let storage: PluginStorageAdapter;

  beforeEach(() => {
    storage = createMemoryPluginStorageAdapter();
  });

  it('applies the override on entry', async () => {
    const h = await buildHarness(storage);
    await createZone(h, {
      name: 'Depot',
      type: 'circle',
      center: ORIGIN,
      radius: 1000,
      policyOverride: 'depot-policy',
    });

    await h.plugin.onHeartbeat?.(device({ policyId: 'fleet-policy' }), heartbeatAt(ORIGIN));

    expect(h.assignPolicy).toHaveBeenCalledWith('device-1', 'depot-policy');
  });

  it('restores the original policy on exit', async () => {
    const h = await buildHarness(storage);
    await createZone(h, {
      name: 'Depot',
      type: 'circle',
      center: ORIGIN,
      radius: 1000,
      policyOverride: 'depot-policy',
    });

    // Enter carrying 'fleet-policy'...
    await h.plugin.onHeartbeat?.(device({ policyId: 'fleet-policy' }), heartbeatAt(ORIGIN));
    // ...then leave.
    await h.plugin.onHeartbeat?.(device({ policyId: 'depot-policy' }), heartbeatAt(FAR_AWAY));

    // The revert used to be a console.log — the device kept 'depot-policy'
    // forever after driving away.
    expect(h.assignPolicy).toHaveBeenLastCalledWith('device-1', 'fleet-policy');
  });

  it('clears the policy on exit when the device had none before', async () => {
    const h = await buildHarness(storage);
    await createZone(h, {
      name: 'Depot',
      type: 'circle',
      center: ORIGIN,
      radius: 1000,
      policyOverride: 'depot-policy',
    });

    await h.plugin.onHeartbeat?.(device({ policyId: null }), heartbeatAt(ORIGIN));
    await h.plugin.onHeartbeat?.(device({ policyId: 'depot-policy' }), heartbeatAt(FAR_AWAY));

    expect(h.updateDevice).toHaveBeenCalledWith('device-1', { policyId: null });
  });

  it('keeps the override while the device is still inside another zone that applies it', async () => {
    const h = await buildHarness(storage);
    // Two overlapping zones, same override.
    await createZone(h, {
      name: 'Depot',
      type: 'circle',
      center: ORIGIN,
      radius: 500,
      policyOverride: 'depot-policy',
    });
    await createZone(h, {
      name: 'Depot (wide)',
      type: 'circle',
      center: ORIGIN,
      radius: 5000,
      policyOverride: 'depot-policy',
    });

    await h.plugin.onHeartbeat?.(device({ policyId: 'fleet-policy' }), heartbeatAt(ORIGIN));
    h.assignPolicy.mockClear();

    // Move outside the tight zone but still inside the wide one (~1.1km out).
    await h.plugin.onHeartbeat?.(
      device({ policyId: 'depot-policy' }),
      heartbeatAt({ latitude: 0.01, longitude: 0 }),
    );

    // Still overridden — no revert.
    expect(h.assignPolicy).not.toHaveBeenCalledWith('device-1', 'fleet-policy');
    expect(h.updateDevice).not.toHaveBeenCalled();
  });

  it('reverts across a restart, because the pre-override policy is persisted', async () => {
    const first = await buildHarness(storage);
    await createZone(first, {
      name: 'Depot',
      type: 'circle',
      center: ORIGIN,
      radius: 1000,
      policyOverride: 'depot-policy',
    });
    await first.plugin.onHeartbeat?.(device({ policyId: 'fleet-policy' }), heartbeatAt(ORIGIN));

    // Restart while the device is inside the zone, then it drives away.
    const second = await buildHarness(storage);
    await second.plugin.onHeartbeat?.(device({ policyId: 'depot-policy' }), heartbeatAt(FAR_AWAY));

    // The pre-override policy rode along in storage, so the revert still knows
    // what to restore.
    expect(second.assignPolicy).toHaveBeenCalledWith('device-1', 'fleet-policy');
  });
});
