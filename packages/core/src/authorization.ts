/**
 * OpenMDM Authorization Manager
 *
 * Provides Role-Based Access Control (RBAC) for the MDM system.
 * Enables fine-grained permission management for users and resources.
 */

import type {
  Role,
  User,
  UserWithRoles,
  Permission,
  PermissionAction,
  PermissionResource,
  AuthorizationManager,
  CreateRoleInput,
  UpdateRoleInput,
  CreateUserInput,
  UpdateUserInput,
  UserFilter,
  UserListResult,
  DatabaseAdapter,
} from './types';
import {
  UserNotFoundError,
  RoleNotFoundError,
  AuthorizationError,
  ValidationError,
} from './types';

/**
 * Check if an action matches the required action
 */
function actionMatches(required: PermissionAction, granted: PermissionAction): boolean {
  if (granted === '*') return true;
  if (granted === 'manage') {
    // 'manage' implies all CRUD operations
    return ['create', 'read', 'update', 'delete', 'manage'].includes(required);
  }
  return required === granted;
}

/**
 * Check if a resource matches the required resource
 */
function resourceMatches(required: PermissionResource, granted: PermissionResource): boolean {
  if (granted === '*') return true;
  return required === granted;
}

/**
 * Check if a permission matches the required permission
 */
function permissionMatches(
  required: { action: PermissionAction; resource: PermissionResource },
  granted: Permission
): boolean {
  return (
    actionMatches(required.action, granted.action) &&
    resourceMatches(required.resource, granted.resource)
  );
}

/**
 * Check if any permission in the list grants the required access
 */
function hasPermission(
  permissions: Permission[],
  action: PermissionAction,
  resource: PermissionResource
): boolean {
  return permissions.some((p) => permissionMatches({ action, resource }, p));
}

/**
 * Check if user has admin permissions (full access)
 */
function isAdminPermission(permissions: Permission[]): boolean {
  return permissions.some(
    (p) => p.action === '*' && p.resource === '*'
  );
}

/**
 * Validate email format
 */
function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Create an AuthorizationManager instance
 */
export function createAuthorizationManager(db: DatabaseAdapter): AuthorizationManager {
  /**
   * Get all permissions for a user from all their roles
   */
  async function getAllUserPermissions(userId: string): Promise<Permission[]> {
    if (!db.getUserRoles) {
      throw new Error('Database adapter does not support RBAC operations');
    }

    const roles = await db.getUserRoles(userId);
    const permissions: Permission[] = [];

    for (const role of roles) {
      permissions.push(...role.permissions);
    }

    return permissions;
  }

  return {
    // ========================================
    // Role Management
    // ========================================

    async createRole(data: CreateRoleInput): Promise<Role> {
      if (!db.createRole) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      // Validate permissions array
      if (!data.permissions || !Array.isArray(data.permissions)) {
        throw new ValidationError('Permissions must be an array');
      }

      for (const permission of data.permissions) {
        if (!permission.action || !permission.resource) {
          throw new ValidationError('Each permission must have action and resource');
        }
      }

      return db.createRole(data);
    },

    async getRole(id: string): Promise<Role | null> {
      if (!db.findRole) {
        throw new Error('Database adapter does not support RBAC operations');
      }
      return db.findRole(id);
    },

    async listRoles(tenantId?: string): Promise<Role[]> {
      if (!db.listRoles) {
        throw new Error('Database adapter does not support RBAC operations');
      }
      return db.listRoles(tenantId);
    },

    async updateRole(id: string, data: UpdateRoleInput): Promise<Role> {
      if (!db.updateRole || !db.findRole) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const role = await db.findRole(id);
      if (!role) {
        throw new RoleNotFoundError(id);
      }

      // Cannot update system roles
      if (role.isSystem) {
        throw new AuthorizationError('Cannot modify system roles');
      }

      // Validate permissions if provided
      if (data.permissions) {
        if (!Array.isArray(data.permissions)) {
          throw new ValidationError('Permissions must be an array');
        }

        for (const permission of data.permissions) {
          if (!permission.action || !permission.resource) {
            throw new ValidationError('Each permission must have action and resource');
          }
        }
      }

      return db.updateRole(id, data);
    },

    async deleteRole(id: string): Promise<void> {
      if (!db.deleteRole || !db.findRole) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const role = await db.findRole(id);
      if (!role) {
        throw new RoleNotFoundError(id);
      }

      // Cannot delete system roles
      if (role.isSystem) {
        throw new AuthorizationError('Cannot delete system roles');
      }

      await db.deleteRole(id);
    },

    // ========================================
    // User Management
    // ========================================

    async createUser(data: CreateUserInput): Promise<User> {
      if (!db.createUser || !db.findUserByEmail) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      // Validate email
      if (!validateEmail(data.email)) {
        throw new ValidationError('Invalid email format', { email: data.email });
      }

      // Check for duplicate email within tenant
      const existing = await db.findUserByEmail(data.email, data.tenantId);
      if (existing) {
        throw new ValidationError(`User with email '${data.email}' already exists`, {
          email: data.email,
        });
      }

      return db.createUser({
        ...data,
        email: data.email.toLowerCase(),
      });
    },

    async getUser(id: string): Promise<UserWithRoles | null> {
      if (!db.findUser || !db.getUserRoles) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUser(id);
      if (!user) return null;

      const roles = await db.getUserRoles(id);
      return { ...user, roles };
    },

    async getUserByEmail(email: string, tenantId?: string): Promise<UserWithRoles | null> {
      if (!db.findUserByEmail || !db.getUserRoles) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUserByEmail(email.toLowerCase(), tenantId);
      if (!user) return null;

      const roles = await db.getUserRoles(user.id);
      return { ...user, roles };
    },

    async listUsers(filter?: UserFilter): Promise<UserListResult> {
      if (!db.listUsers) {
        throw new Error('Database adapter does not support RBAC operations');
      }
      return db.listUsers(filter);
    },

    async updateUser(id: string, data: UpdateUserInput): Promise<User> {
      if (!db.updateUser || !db.findUser) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUser(id);
      if (!user) {
        throw new UserNotFoundError(id);
      }

      // Validate email if provided
      if (data.email) {
        if (!validateEmail(data.email)) {
          throw new ValidationError('Invalid email format', { email: data.email });
        }
        data.email = data.email.toLowerCase();
      }

      return db.updateUser(id, data);
    },

    async deleteUser(id: string): Promise<void> {
      if (!db.deleteUser || !db.findUser) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUser(id);
      if (!user) {
        throw new UserNotFoundError(id);
      }

      await db.deleteUser(id);
    },

    // ========================================
    // Role Assignment
    // ========================================

    async assignRole(userId: string, roleId: string): Promise<void> {
      if (!db.assignRoleToUser || !db.findUser || !db.findRole) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUser(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      const role = await db.findRole(roleId);
      if (!role) {
        throw new RoleNotFoundError(roleId);
      }

      // Verify tenant compatibility
      if (role.tenantId && user.tenantId && role.tenantId !== user.tenantId) {
        throw new AuthorizationError('Role belongs to a different tenant');
      }

      await db.assignRoleToUser(userId, roleId);
    },

    async removeRole(userId: string, roleId: string): Promise<void> {
      if (!db.removeRoleFromUser || !db.findUser) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUser(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      await db.removeRoleFromUser(userId, roleId);
    },

    async getUserRoles(userId: string): Promise<Role[]> {
      if (!db.getUserRoles || !db.findUser) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUser(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      return db.getUserRoles(userId);
    },

    // ========================================
    // Permission Checking
    // ========================================

    async can(
      userId: string,
      action: PermissionAction,
      resource: PermissionResource,
      _resourceId?: string
    ): Promise<boolean> {
      if (!db.findUser) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUser(userId);
      if (!user) return false;

      // Inactive users have no permissions
      if (user.status !== 'active') return false;

      const permissions = await getAllUserPermissions(userId);
      return hasPermission(permissions, action, resource);
    },

    async requirePermission(
      userId: string,
      action: PermissionAction,
      resource: PermissionResource,
      resourceId?: string
    ): Promise<void> {
      const allowed = await this.can(userId, action, resource, resourceId);
      if (!allowed) {
        throw new AuthorizationError(
          `Permission denied: ${action} on ${resource}${resourceId ? ` (${resourceId})` : ''}`
        );
      }
    },

    async canAny(
      userId: string,
      permissions: Array<{ action: PermissionAction; resource: PermissionResource }>
    ): Promise<boolean> {
      if (!db.findUser) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUser(userId);
      if (!user) return false;

      // Inactive users have no permissions
      if (user.status !== 'active') return false;

      const userPermissions = await getAllUserPermissions(userId);

      return permissions.some((required) =>
        hasPermission(userPermissions, required.action, required.resource)
      );
    },

    async isAdmin(userId: string): Promise<boolean> {
      if (!db.findUser) {
        throw new Error('Database adapter does not support RBAC operations');
      }

      const user = await db.findUser(userId);
      if (!user || user.status !== 'active') return false;

      const permissions = await getAllUserPermissions(userId);
      return isAdminPermission(permissions);
    },
  };
}
