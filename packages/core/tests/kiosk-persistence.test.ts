import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryPluginStorageAdapter } from '../src/plugin-storage';

/**
 * Tests for the plugin-storage contract that the kiosk plugin relies on.
 *
 * The kiosk plugin keeps per-device state (exit-attempt counters, lockout
 * timers, current kiosk app) that must survive restarts and work across
 * horizontally-scaled instances. Before this test suite, the plugin
 * stored that state in an in-memory Map, which silently broke both
 * properties. The test here covers the in-memory adapter itself —
 * kiosk integration against a real MDM instance is covered by the
 * separate kiosk plugin test suite.
 */

describe('createMemoryPluginStorageAdapter', () => {
  let store: ReturnType<typeof createMemoryPluginStorageAdapter>;

  beforeEach(() => {
    store = createMemoryPluginStorageAdapter();
  });

  describe('get / set / delete', () => {
    it('returns null for a missing key', async () => {
      expect(await store.get('kiosk', 'device-1')).toBeNull();
    });

    it('round-trips a stored value', async () => {
      await store.set('kiosk', 'device-1', { enabled: true, exitAttempts: 0 });
      expect(await store.get('kiosk', 'device-1')).toEqual({
        enabled: true,
        exitAttempts: 0,
      });
    });

    it('overwrites on a second set (last-write-wins)', async () => {
      await store.set('kiosk', 'device-1', { exitAttempts: 1 });
      await store.set('kiosk', 'device-1', { exitAttempts: 2 });
      expect(await store.get('kiosk', 'device-1')).toEqual({ exitAttempts: 2 });
    });

    it('delete removes the key', async () => {
      await store.set('kiosk', 'device-1', { enabled: true });
      await store.delete('kiosk', 'device-1');
      expect(await store.get('kiosk', 'device-1')).toBeNull();
    });

    it('delete is idempotent on a missing key', async () => {
      await expect(store.delete('kiosk', 'never-existed')).resolves.not.toThrow();
    });
  });

  describe('namespace isolation', () => {
    it('different plugin names cannot read each other', async () => {
      await store.set('kiosk', 'device-1', { source: 'kiosk' });
      await store.set('geofence', 'device-1', { source: 'geofence' });

      expect(await store.get('kiosk', 'device-1')).toEqual({ source: 'kiosk' });
      expect(await store.get('geofence', 'device-1')).toEqual({
        source: 'geofence',
      });
    });

    it('clearing one plugin does not affect another', async () => {
      await store.set('kiosk', 'device-1', { source: 'kiosk' });
      await store.set('geofence', 'device-1', { source: 'geofence' });

      await store.clear('kiosk');

      expect(await store.get('kiosk', 'device-1')).toBeNull();
      expect(await store.get('geofence', 'device-1')).toEqual({
        source: 'geofence',
      });
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await store.set('kiosk', 'device-1', {});
      await store.set('kiosk', 'device-2', {});
      await store.set('kiosk', 'device-10', {});
      await store.set('kiosk', 'other-key', {});
      await store.set('geofence', 'device-1', {});
    });

    it('lists every key under a plugin namespace', async () => {
      const keys = (await store.list('kiosk')).sort();
      expect(keys).toEqual(['device-1', 'device-10', 'device-2', 'other-key']);
    });

    it('filters by prefix', async () => {
      const keys = (await store.list('kiosk', 'device-')).sort();
      expect(keys).toEqual(['device-1', 'device-10', 'device-2']);
    });

    it('does not leak keys from other plugins', async () => {
      const keys = await store.list('kiosk');
      expect(keys).not.toContain('geofence:device-1');
    });

    it('empty prefix returns every key', async () => {
      const keys = (await store.list('kiosk', '')).sort();
      expect(keys).toEqual(['device-1', 'device-10', 'device-2', 'other-key']);
    });
  });

  describe('date serialization', () => {
    // The in-memory adapter keeps objects by reference, so Date instances
    // stay as Date. The database-backed adapter goes through JSON, so
    // Dates become ISO strings on the way in and need to be rehydrated
    // by the caller. The kiosk plugin does this rehydration; we keep it
    // documented here so the expected behavior is explicit.
    it('in-memory adapter preserves Date objects by reference', async () => {
      const when = new Date('2026-04-15T12:00:00Z');
      await store.set('kiosk', 'device-1', { lockedSince: when });
      const out = (await store.get('kiosk', 'device-1')) as {
        lockedSince: Date;
      };
      expect(out.lockedSince).toBeInstanceOf(Date);
      expect(out.lockedSince.toISOString()).toBe(when.toISOString());
    });
  });
});
