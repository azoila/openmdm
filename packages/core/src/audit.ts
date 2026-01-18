/**
 * OpenMDM Audit Manager
 *
 * Provides audit logging for compliance and tracking.
 * Records all significant operations for security auditing.
 */

import type {
  AuditLog,
  AuditAction,
  AuditManager,
  AuditSummary,
  CreateAuditLogInput,
  AuditLogFilter,
  AuditLogListResult,
  DatabaseAdapter,
  AuditConfig,
} from './types';

/**
 * Default audit retention in days
 */
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Convert audit log to CSV row
 */
function auditLogToCsvRow(log: AuditLog): string {
  const fields = [
    log.id,
    log.tenantId || '',
    log.userId || '',
    log.action,
    log.resource,
    log.resourceId || '',
    log.status,
    log.ipAddress || '',
    log.userAgent || '',
    log.error || '',
    log.createdAt.toISOString(),
    JSON.stringify(log.details || {}),
  ];
  return fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',');
}

/**
 * CSV header for audit log export
 */
const CSV_HEADER =
  'id,tenant_id,user_id,action,resource,resource_id,status,ip_address,user_agent,error,created_at,details';

/**
 * Create an AuditManager instance
 */
export function createAuditManager(
  db: DatabaseAdapter,
  config?: AuditConfig
): AuditManager {
  const retentionDays = config?.retentionDays ?? DEFAULT_RETENTION_DAYS;

  /**
   * Check if an action should be logged based on configuration
   */
  function shouldLog(action: AuditAction, resource: string): boolean {
    if (!config?.enabled) return false;

    // Skip read operations if configured
    if (config.skipReadOperations && action === 'read') {
      return false;
    }

    // Check action filter
    if (config.logActions && config.logActions.length > 0) {
      if (!config.logActions.includes(action)) {
        return false;
      }
    }

    // Check resource filter
    if (config.logResources && config.logResources.length > 0) {
      if (!config.logResources.includes(resource)) {
        return false;
      }
    }

    return true;
  }

  return {
    async log(entry: CreateAuditLogInput): Promise<AuditLog> {
      if (!db.createAuditLog) {
        throw new Error('Database adapter does not support audit operations');
      }

      // Check if we should log this action
      if (config && !shouldLog(entry.action, entry.resource)) {
        // Return a stub audit log without persisting
        return {
          id: 'skipped',
          ...entry,
          createdAt: new Date(),
        } as AuditLog;
      }

      return db.createAuditLog(entry);
    },

    async list(filter?: AuditLogFilter): Promise<AuditLogListResult> {
      if (!db.listAuditLogs) {
        throw new Error('Database adapter does not support audit operations');
      }
      return db.listAuditLogs(filter);
    },

    async getByResource(resource: string, resourceId: string): Promise<AuditLog[]> {
      if (!db.listAuditLogs) {
        throw new Error('Database adapter does not support audit operations');
      }

      const result = await db.listAuditLogs({
        resource,
        resourceId,
        limit: 1000, // Reasonable limit for resource-specific queries
      });

      return result.logs;
    },

    async getByUser(
      userId: string,
      filter?: Omit<AuditLogFilter, 'userId'>
    ): Promise<AuditLogListResult> {
      if (!db.listAuditLogs) {
        throw new Error('Database adapter does not support audit operations');
      }

      return db.listAuditLogs({
        ...filter,
        userId,
      });
    },

    async export(filter: AuditLogFilter, format: 'csv' | 'json'): Promise<string> {
      if (!db.listAuditLogs) {
        throw new Error('Database adapter does not support audit operations');
      }

      // Fetch all matching logs (with a reasonable limit)
      const allLogs: AuditLog[] = [];
      let offset = 0;
      const batchSize = 1000;

      while (true) {
        const result = await db.listAuditLogs({
          ...filter,
          limit: batchSize,
          offset,
        });

        allLogs.push(...result.logs);

        if (result.logs.length < batchSize || allLogs.length >= 100000) {
          break;
        }

        offset += batchSize;
      }

      if (format === 'json') {
        return JSON.stringify(allLogs, null, 2);
      }

      // CSV format
      const rows = allLogs.map(auditLogToCsvRow);
      return [CSV_HEADER, ...rows].join('\n');
    },

    async purge(olderThanDays?: number): Promise<number> {
      if (!db.deleteAuditLogs) {
        throw new Error('Database adapter does not support audit operations');
      }

      const days = olderThanDays ?? retentionDays;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      return db.deleteAuditLogs({ olderThan: cutoffDate });
    },

    async getSummary(tenantId?: string, days: number = 30): Promise<AuditSummary> {
      if (!db.listAuditLogs) {
        throw new Error('Database adapter does not support audit operations');
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Fetch logs for the period
      const result = await db.listAuditLogs({
        tenantId,
        startDate,
        limit: 10000, // Reasonable limit for summary
      });

      const logs = result.logs;

      // Calculate summary statistics
      const byAction: Record<AuditAction, number> = {} as Record<AuditAction, number>;
      const byResource: Record<string, number> = {};
      const byStatus = { success: 0, failure: 0 };
      const userCounts: Record<string, number> = {};
      const recentFailures: AuditLog[] = [];

      for (const log of logs) {
        // By action
        byAction[log.action] = (byAction[log.action] || 0) + 1;

        // By resource
        byResource[log.resource] = (byResource[log.resource] || 0) + 1;

        // By status
        byStatus[log.status]++;

        // By user
        if (log.userId) {
          userCounts[log.userId] = (userCounts[log.userId] || 0) + 1;
        }

        // Collect failures
        if (log.status === 'failure' && recentFailures.length < 10) {
          recentFailures.push(log);
        }
      }

      // Get top users
      const topUsers = Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([userId, count]) => ({ userId, count }));

      return {
        totalLogs: result.total,
        byAction,
        byResource,
        byStatus,
        topUsers,
        recentFailures,
      };
    },
  };
}

/**
 * Helper function to create audit log entries with common fields
 */
export function createAuditEntry(
  action: AuditAction,
  resource: string,
  options: {
    resourceId?: string;
    tenantId?: string;
    userId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    status?: 'success' | 'failure';
    error?: string;
  } = {}
): CreateAuditLogInput {
  return {
    action,
    resource,
    resourceId: options.resourceId,
    tenantId: options.tenantId,
    userId: options.userId,
    details: options.details,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    status: options.status ?? 'success',
    error: options.error,
  };
}

/**
 * Audit decorator for wrapping async functions with audit logging
 */
export function withAudit<T extends (...args: unknown[]) => Promise<unknown>>(
  manager: AuditManager,
  action: AuditAction,
  resource: string,
  getContext: (...args: Parameters<T>) => Partial<CreateAuditLogInput>
) {
  return function decorator(target: T): T {
    return (async (...args: Parameters<T>) => {
      const context = getContext(...args);
      try {
        const result = await target(...args);
        await manager.log({
          action,
          resource,
          status: 'success',
          ...context,
        });
        return result;
      } catch (error) {
        await manager.log({
          action,
          resource,
          status: 'failure',
          error: error instanceof Error ? error.message : String(error),
          ...context,
        });
        throw error;
      }
    }) as T;
  };
}
