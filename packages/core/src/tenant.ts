/**
 * OpenMDM Tenant Manager
 *
 * Provides multi-tenancy support for the MDM system.
 * Enables organization isolation, tenant management, and resource quotas.
 */

import type {
  Tenant,
  TenantManager,
  TenantFilter,
  TenantListResult,
  TenantStats,
  CreateTenantInput,
  UpdateTenantInput,
  DatabaseAdapter,
} from './types';
import { TenantNotFoundError, ValidationError } from './types';

/**
 * Generate a unique ID for entities
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Validate tenant slug format
 */
function validateSlug(slug: string): boolean {
  // Slug must be lowercase alphanumeric with hyphens, 3-50 chars
  const slugRegex = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
  return slugRegex.test(slug);
}

/**
 * Create a TenantManager instance
 */
export function createTenantManager(db: DatabaseAdapter): TenantManager {
  return {
    async get(id: string): Promise<Tenant | null> {
      if (!db.findTenant) {
        throw new Error('Database adapter does not support tenant operations');
      }
      return db.findTenant(id);
    },

    async getBySlug(slug: string): Promise<Tenant | null> {
      if (!db.findTenantBySlug) {
        throw new Error('Database adapter does not support tenant operations');
      }
      return db.findTenantBySlug(slug);
    },

    async list(filter?: TenantFilter): Promise<TenantListResult> {
      if (!db.listTenants) {
        throw new Error('Database adapter does not support tenant operations');
      }
      return db.listTenants(filter);
    },

    async create(data: CreateTenantInput): Promise<Tenant> {
      if (!db.createTenant || !db.findTenantBySlug) {
        throw new Error('Database adapter does not support tenant operations');
      }

      // Validate slug format
      if (!validateSlug(data.slug)) {
        throw new ValidationError(
          'Invalid slug format. Must be 3-50 lowercase alphanumeric characters with hyphens.',
          { slug: data.slug }
        );
      }

      // Check for duplicate slug
      const existing = await db.findTenantBySlug(data.slug);
      if (existing) {
        throw new ValidationError(`Tenant with slug '${data.slug}' already exists`, {
          slug: data.slug,
        });
      }

      return db.createTenant({
        ...data,
        slug: data.slug.toLowerCase(),
      });
    },

    async update(id: string, data: UpdateTenantInput): Promise<Tenant> {
      if (!db.updateTenant || !db.findTenant || !db.findTenantBySlug) {
        throw new Error('Database adapter does not support tenant operations');
      }

      const tenant = await db.findTenant(id);
      if (!tenant) {
        throw new TenantNotFoundError(id);
      }

      // Validate new slug if provided
      if (data.slug) {
        if (!validateSlug(data.slug)) {
          throw new ValidationError(
            'Invalid slug format. Must be 3-50 lowercase alphanumeric characters with hyphens.',
            { slug: data.slug }
          );
        }

        // Check for duplicate slug
        const existing = await db.findTenantBySlug(data.slug);
        if (existing && existing.id !== id) {
          throw new ValidationError(`Tenant with slug '${data.slug}' already exists`, {
            slug: data.slug,
          });
        }

        data.slug = data.slug.toLowerCase();
      }

      return db.updateTenant(id, data);
    },

    async delete(id: string, cascade: boolean = false): Promise<void> {
      if (!db.deleteTenant || !db.findTenant) {
        throw new Error('Database adapter does not support tenant operations');
      }

      const tenant = await db.findTenant(id);
      if (!tenant) {
        throw new TenantNotFoundError(id);
      }

      // If cascade is true, the database adapter should handle
      // deletion of all related resources (devices, policies, etc.)
      // This is typically done via ON DELETE CASCADE in the schema

      await db.deleteTenant(id);
    },

    async getStats(tenantId: string): Promise<TenantStats> {
      if (!db.getTenantStats || !db.findTenant) {
        throw new Error('Database adapter does not support tenant operations');
      }

      const tenant = await db.findTenant(tenantId);
      if (!tenant) {
        throw new TenantNotFoundError(tenantId);
      }

      return db.getTenantStats(tenantId);
    },

    async activate(id: string): Promise<Tenant> {
      if (!db.updateTenant || !db.findTenant) {
        throw new Error('Database adapter does not support tenant operations');
      }

      const tenant = await db.findTenant(id);
      if (!tenant) {
        throw new TenantNotFoundError(id);
      }

      if (tenant.status === 'active') {
        return tenant;
      }

      return db.updateTenant(id, { status: 'active' });
    },

    async deactivate(id: string): Promise<Tenant> {
      if (!db.updateTenant || !db.findTenant) {
        throw new Error('Database adapter does not support tenant operations');
      }

      const tenant = await db.findTenant(id);
      if (!tenant) {
        throw new TenantNotFoundError(id);
      }

      if (tenant.status === 'suspended') {
        return tenant;
      }

      return db.updateTenant(id, { status: 'suspended' });
    },
  };
}

/**
 * Default system roles that can be used across tenants
 */
export const DEFAULT_SYSTEM_ROLES = {
  SUPER_ADMIN: {
    name: 'Super Admin',
    description: 'Full system access across all tenants',
    permissions: [{ action: '*' as const, resource: '*' as const }],
    isSystem: true,
  },
  TENANT_ADMIN: {
    name: 'Tenant Admin',
    description: 'Full access within the tenant',
    permissions: [
      { action: 'manage' as const, resource: 'devices' as const },
      { action: 'manage' as const, resource: 'policies' as const },
      { action: 'manage' as const, resource: 'applications' as const },
      { action: 'manage' as const, resource: 'commands' as const },
      { action: 'manage' as const, resource: 'groups' as const },
      { action: 'manage' as const, resource: 'users' as const },
      { action: 'read' as const, resource: 'audit' as const },
    ],
    isSystem: true,
  },
  DEVICE_MANAGER: {
    name: 'Device Manager',
    description: 'Manage devices and send commands',
    permissions: [
      { action: 'manage' as const, resource: 'devices' as const },
      { action: 'manage' as const, resource: 'commands' as const },
      { action: 'read' as const, resource: 'policies' as const },
      { action: 'read' as const, resource: 'groups' as const },
    ],
    isSystem: true,
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access to all resources',
    permissions: [
      { action: 'read' as const, resource: 'devices' as const },
      { action: 'read' as const, resource: 'policies' as const },
      { action: 'read' as const, resource: 'applications' as const },
      { action: 'read' as const, resource: 'commands' as const },
      { action: 'read' as const, resource: 'groups' as const },
    ],
    isSystem: true,
  },
};

export type SystemRoleName = keyof typeof DEFAULT_SYSTEM_ROLES;
