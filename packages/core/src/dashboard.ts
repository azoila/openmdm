/**
 * OpenMDM Dashboard Manager
 *
 * Provides analytics and statistics for the MDM dashboard.
 * Aggregates data from devices, commands, and applications.
 */

import type {
  DashboardManager,
  DashboardStats,
  DeviceStatusBreakdown,
  EnrollmentTrendPoint,
  CommandSuccessRates,
  AppInstallationSummary,
  DatabaseAdapter,
  DeviceStatus,
} from './types';

/**
 * Create a DashboardManager instance
 */
export function createDashboardManager(db: DatabaseAdapter): DashboardManager {
  return {
    async getStats(_tenantId?: string): Promise<DashboardStats> {
      // Use database method if available
      if (db.getDashboardStats) {
        return db.getDashboardStats(_tenantId);
      }

      // Fallback: compute from individual queries
      const devices = await db.listDevices({
        limit: 10000, // Get all for counting
      });

      const deviceStats = {
        total: devices.total,
        enrolled: devices.devices.filter((d) => d.status === 'enrolled').length,
        active: devices.devices.filter((d) => d.status === 'enrolled').length, // 'active' = 'enrolled' for dashboard
        blocked: devices.devices.filter((d) => d.status === 'blocked').length,
        pending: devices.devices.filter((d) => d.status === 'pending').length,
      };

      const allPolicies = await db.listPolicies();
      const policyStats = {
        total: allPolicies.length,
        deployed: allPolicies.filter((p) => p.isDefault).length,
      };

      const allApps = await db.listApplications();
      const appStats = {
        total: allApps.length,
        deployed: allApps.length, // All apps in db are considered deployed
      };

      // Command stats - get recent commands
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const allCommands = await db.listCommands({ limit: 10000 });

      const pendingCommands = allCommands.filter((c) => c.status === 'pending');
      const last24hCommands = allCommands.filter(
        (c) => new Date(c.createdAt) >= yesterday
      );

      const commandStats = {
        pendingCount: pendingCommands.length,
        last24hTotal: last24hCommands.length,
        last24hSuccess: last24hCommands.filter((c) => c.status === 'completed').length,
        last24hFailed: last24hCommands.filter((c) => c.status === 'failed').length,
      };

      // Group stats
      const allGroups = await db.listGroups();
      let groupsWithDevices = 0;
      for (const group of allGroups) {
        const groupDevices = await db.listDevicesInGroup(group.id);
        if (groupDevices.length > 0) groupsWithDevices++;
      }

      return {
        devices: deviceStats,
        policies: policyStats,
        applications: appStats,
        commands: commandStats,
        groups: {
          total: allGroups.length,
          withDevices: groupsWithDevices,
        },
      };
    },

    async getDeviceStatusBreakdown(_tenantId?: string): Promise<DeviceStatusBreakdown> {
      if (db.getDeviceStatusBreakdown) {
        return db.getDeviceStatusBreakdown(_tenantId);
      }

      const devices = await db.listDevices({
        limit: 10000,
      });

      const byStatus: Record<DeviceStatus, number> = {
        pending: 0,
        enrolled: 0,
        blocked: 0,
        unenrolled: 0,
      };

      const byOs: Record<string, number> = {};
      const byManufacturer: Record<string, number> = {};
      const byModel: Record<string, number> = {};

      for (const device of devices.devices) {
        // By status
        byStatus[device.status]++;

        // By OS version
        const osKey = device.osVersion || 'Unknown';
        byOs[osKey] = (byOs[osKey] || 0) + 1;

        // By manufacturer
        const mfr = device.manufacturer || 'Unknown';
        byManufacturer[mfr] = (byManufacturer[mfr] || 0) + 1;

        // By model
        const model = device.model || 'Unknown';
        byModel[model] = (byModel[model] || 0) + 1;
      }

      return {
        byStatus,
        byOs,
        byManufacturer,
        byModel,
      };
    },

    async getEnrollmentTrend(days: number, _tenantId?: string): Promise<EnrollmentTrendPoint[]> {
      if (db.getEnrollmentTrend) {
        return db.getEnrollmentTrend(days, _tenantId);
      }

      // Generate trend data from event history
      const now = new Date();
      const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      // Get enrollment events
      const events = await db.listEvents({
        type: 'device.enrolled',
        startDate,
        limit: 10000,
      });

      const unenrollEvents = await db.listEvents({
        type: 'device.unenrolled',
        startDate,
        limit: 10000,
      });

      // Group by date
      const trendByDate = new Map<string, { enrolled: number; unenrolled: number }>();

      // Initialize all dates
      for (let i = 0; i < days; i++) {
        const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const dateKey = date.toISOString().split('T')[0];
        trendByDate.set(dateKey, { enrolled: 0, unenrolled: 0 });
      }

      // Count events
      for (const event of events) {
        const dateKey = new Date(event.createdAt).toISOString().split('T')[0];
        const entry = trendByDate.get(dateKey);
        if (entry) {
          entry.enrolled++;
        }
      }

      for (const event of unenrollEvents) {
        const dateKey = new Date(event.createdAt).toISOString().split('T')[0];
        const entry = trendByDate.get(dateKey);
        if (entry) {
          entry.unenrolled++;
        }
      }

      // Get initial device count
      const initialDevices = await db.listDevices({
        limit: 10000,
      });
      let runningTotal = initialDevices.total;

      // Build trend points
      const result: EnrollmentTrendPoint[] = [];
      const sortedDates = Array.from(trendByDate.keys()).sort();

      for (const dateKey of sortedDates) {
        const entry = trendByDate.get(dateKey)!;
        const netChange = entry.enrolled - entry.unenrolled;
        runningTotal += netChange;

        result.push({
          date: new Date(dateKey),
          enrolled: entry.enrolled,
          unenrolled: entry.unenrolled,
          netChange,
          totalDevices: runningTotal,
        });
      }

      return result;
    },

    async getCommandSuccessRates(_tenantId?: string): Promise<CommandSuccessRates> {
      if (db.getCommandSuccessRates) {
        return db.getCommandSuccessRates(_tenantId);
      }

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const commands = await db.listCommands({ limit: 10000 });

      // Overall stats
      const completed = commands.filter((c) => c.status === 'completed').length;
      const failed = commands.filter((c) => c.status === 'failed').length;
      const total = commands.length;

      // By type
      const byType: CommandSuccessRates['byType'] = {};
      for (const cmd of commands) {
        if (!byType[cmd.type]) {
          byType[cmd.type] = {
            total: 0,
            completed: 0,
            failed: 0,
            successRate: 0,
          };
        }
        byType[cmd.type].total++;
        if (cmd.status === 'completed') byType[cmd.type].completed++;
        if (cmd.status === 'failed') byType[cmd.type].failed++;
      }

      // Calculate success rates
      for (const type of Object.keys(byType)) {
        const stats = byType[type];
        const finishedCount = stats.completed + stats.failed;
        stats.successRate = finishedCount > 0 ? (stats.completed / finishedCount) * 100 : 0;
      }

      // Last 24h
      const last24hCommands = commands.filter(
        (c) => new Date(c.createdAt) >= yesterday
      );

      return {
        overall: {
          total,
          completed,
          failed,
          successRate:
            completed + failed > 0 ? (completed / (completed + failed)) * 100 : 0,
        },
        byType,
        last24h: {
          total: last24hCommands.length,
          completed: last24hCommands.filter((c) => c.status === 'completed').length,
          failed: last24hCommands.filter((c) => c.status === 'failed').length,
          pending: last24hCommands.filter((c) => c.status === 'pending').length,
        },
      };
    },

    async getAppInstallationSummary(_tenantId?: string): Promise<AppInstallationSummary> {
      if (db.getAppInstallationSummary) {
        return db.getAppInstallationSummary(_tenantId);
      }

      // Get all apps
      const apps = await db.listApplications();
      const appMap = new Map(apps.map((a) => [a.packageName, a]));

      // Get installation statuses if available
      const byStatus: Record<string, number> = {
        installed: 0,
        installing: 0,
        failed: 0,
        pending: 0,
      };

      // Count installed apps per device
      const installCounts: Record<string, number> = {};

      // Get devices to count installations
      const devices = await db.listDevices({
        limit: 10000,
      });

      for (const device of devices.devices) {
        if (device.installedApps) {
          for (const app of device.installedApps) {
            const key = app.packageName;
            installCounts[key] = (installCounts[key] || 0) + 1;
            byStatus['installed']++;
          }
        }
      }

      // Top installed apps
      const topInstalled = Object.entries(installCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([packageName, count]) => ({
          packageName,
          name: appMap.get(packageName)?.name || packageName,
          installedCount: count,
        }));

      return {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        recentFailures: [], // Would need installation status tracking
        topInstalled,
      };
    },
  };
}
