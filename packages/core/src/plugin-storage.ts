/**
 * OpenMDM Plugin Storage Manager
 *
 * Provides persistent storage for plugin state.
 * Supports both database-backed and in-memory storage.
 */

import type { PluginStorageAdapter, DatabaseAdapter } from './types';

/**
 * Create a PluginStorageAdapter backed by the database
 */
export function createPluginStorageAdapter(db: DatabaseAdapter): PluginStorageAdapter {
  return {
    async get<T>(pluginName: string, key: string): Promise<T | null> {
      if (db.getPluginValue) {
        const value = await db.getPluginValue(pluginName, key);
        return value as T | null;
      }

      // Fallback: not supported
      // Silently no-op: the plugin-storage contract treats missing
      // adapter methods as "not configured", which is the same
      // branch plugins handle via their in-memory fallback. A warn
      // log here would flood production with one line per hit.
      //
      return null;
    },

    async set<T>(pluginName: string, key: string, value: T): Promise<void> {
      if (db.setPluginValue) {
        await db.setPluginValue(pluginName, key, value);
        return;
      }

      // Silently no-op: the plugin-storage contract treats missing
      // adapter methods as "not configured", which is the same
      // branch plugins handle via their in-memory fallback. A warn
      // log here would flood production with one line per hit.
      //
    },

    async delete(pluginName: string, key: string): Promise<void> {
      if (db.deletePluginValue) {
        await db.deletePluginValue(pluginName, key);
        return;
      }

      // Silently no-op: the plugin-storage contract treats missing
      // adapter methods as "not configured", which is the same
      // branch plugins handle via their in-memory fallback. A warn
      // log here would flood production with one line per hit.
      //
    },

    async list(pluginName: string, prefix?: string): Promise<string[]> {
      if (db.listPluginKeys) {
        return db.listPluginKeys(pluginName, prefix);
      }

      // Silently no-op: the plugin-storage contract treats missing
      // adapter methods as "not configured", which is the same
      // branch plugins handle via their in-memory fallback. A warn
      // log here would flood production with one line per hit.
      //
      return [];
    },

    async clear(pluginName: string): Promise<void> {
      if (db.clearPluginData) {
        await db.clearPluginData(pluginName);
        return;
      }

      // Silently no-op: the plugin-storage contract treats missing
      // adapter methods as "not configured", which is the same
      // branch plugins handle via their in-memory fallback. A warn
      // log here would flood production with one line per hit.
      //
    },
  };
}

/**
 * Create an in-memory PluginStorageAdapter for testing
 */
export function createMemoryPluginStorageAdapter(): PluginStorageAdapter {
  const store = new Map<string, Map<string, unknown>>();

  function getPluginStore(pluginName: string): Map<string, unknown> {
    if (!store.has(pluginName)) {
      store.set(pluginName, new Map());
    }
    return store.get(pluginName)!;
  }

  return {
    async get<T>(pluginName: string, key: string): Promise<T | null> {
      const pluginStore = getPluginStore(pluginName);
      const value = pluginStore.get(key);
      return value === undefined ? null : (value as T);
    },

    async set<T>(pluginName: string, key: string, value: T): Promise<void> {
      const pluginStore = getPluginStore(pluginName);
      pluginStore.set(key, value);
    },

    async delete(pluginName: string, key: string): Promise<void> {
      const pluginStore = getPluginStore(pluginName);
      pluginStore.delete(key);
    },

    async list(pluginName: string, prefix?: string): Promise<string[]> {
      const pluginStore = getPluginStore(pluginName);
      const keys = Array.from(pluginStore.keys());

      if (prefix) {
        return keys.filter((k) => k.startsWith(prefix));
      }

      return keys;
    },

    async clear(pluginName: string): Promise<void> {
      store.delete(pluginName);
    },
  };
}

/**
 * Plugin storage utilities
 */

/**
 * Create a namespaced key for plugin storage
 */
export function createPluginKey(namespace: string, ...parts: string[]): string {
  return [namespace, ...parts].join(':');
}

/**
 * Parse a namespaced key
 */
export function parsePluginKey(key: string): { namespace: string; parts: string[] } {
  const [namespace, ...parts] = key.split(':');
  return { namespace, parts };
}
