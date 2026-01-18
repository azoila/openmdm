/**
 * OpenMDM Schedule Manager
 *
 * Provides scheduled task management for the MDM system.
 * Enables scheduling of recurring operations, maintenance windows, and one-time tasks.
 */

import type {
  ScheduleManager,
  ScheduledTask,
  ScheduledTaskFilter,
  ScheduledTaskListResult,
  CreateScheduledTaskInput,
  UpdateScheduledTaskInput,
  TaskSchedule,
  TaskExecution,
  DatabaseAdapter,
} from './types';

/**
 * Parse cron expression and calculate next run time
 * Supports: minute hour dayOfMonth month dayOfWeek
 */
function parseCronNextRun(cron: string, from: Date = new Date()): Date | null {
  try {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Simple cron parsing - handles basic patterns
    const now = new Date(from);
    const next = new Date(now);

    // Start from the next minute
    next.setSeconds(0);
    next.setMilliseconds(0);
    next.setMinutes(next.getMinutes() + 1);

    // Try to find next valid time (up to 1 year)
    const maxIterations = 365 * 24 * 60; // 1 year in minutes
    for (let i = 0; i < maxIterations; i++) {
      const matches =
        matchesCronField(minute, next.getMinutes()) &&
        matchesCronField(hour, next.getHours()) &&
        matchesCronField(dayOfMonth, next.getDate()) &&
        matchesCronField(month, next.getMonth() + 1) &&
        matchesCronField(dayOfWeek, next.getDay());

      if (matches) {
        return next;
      }

      next.setMinutes(next.getMinutes() + 1);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a value matches a cron field pattern
 */
function matchesCronField(pattern: string, value: number): boolean {
  if (pattern === '*') return true;

  // Handle step values: */5, */15, etc.
  if (pattern.startsWith('*/')) {
    const step = parseInt(pattern.slice(2), 10);
    return value % step === 0;
  }

  // Handle ranges: 1-5
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map((n) => parseInt(n, 10));
    return value >= start && value <= end;
  }

  // Handle lists: 1,3,5
  if (pattern.includes(',')) {
    const values = pattern.split(',').map((n) => parseInt(n, 10));
    return values.includes(value);
  }

  // Simple number
  return parseInt(pattern, 10) === value;
}

/**
 * Check if current time is within a maintenance window
 */
function isInMaintenanceWindow(
  window: TaskSchedule['window'],
  now: Date = new Date()
): boolean {
  if (!window) return false;

  const dayOfWeek = now.getDay();
  if (!window.daysOfWeek.includes(dayOfWeek)) return false;

  // Parse times
  const [startHour, startMin] = window.startTime.split(':').map(Number);
  const [endHour, endMin] = window.endTime.split(':').map(Number);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  // Handle overnight windows
  if (endMinutes < startMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Calculate next run time for a maintenance window
 */
function calculateNextWindowRun(
  window: TaskSchedule['window'],
  from: Date = new Date()
): Date | null {
  if (!window) return null;

  const [startHour, startMin] = window.startTime.split(':').map(Number);

  // Try each day for the next 7 days
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + dayOffset);
    candidate.setHours(startHour, startMin, 0, 0);

    // Skip if in the past
    if (candidate <= from) continue;

    // Check if day matches
    if (window.daysOfWeek.includes(candidate.getDay())) {
      return candidate;
    }
  }

  return null;
}

/**
 * Create a ScheduleManager instance
 */
export function createScheduleManager(db: DatabaseAdapter): ScheduleManager {
  /**
   * Calculate the next run time for a schedule
   */
  function calculateNextRun(schedule: TaskSchedule): Date | null {
    const now = new Date();

    switch (schedule.type) {
      case 'once':
        // For one-time tasks, return the scheduled time if it's in the future
        if (schedule.executeAt && new Date(schedule.executeAt) > now) {
          return new Date(schedule.executeAt);
        }
        return null;

      case 'recurring':
        // Parse cron expression
        if (schedule.cron) {
          return parseCronNextRun(schedule.cron, now);
        }
        return null;

      case 'window':
        // Calculate next maintenance window start
        if (schedule.window) {
          return calculateNextWindowRun(schedule.window, now);
        }
        return null;

      default:
        return null;
    }
  }

  return {
    async get(id: string): Promise<ScheduledTask | null> {
      if (!db.findScheduledTask) {
        throw new Error('Database adapter does not support task scheduling');
      }
      return db.findScheduledTask(id);
    },

    async list(filter?: ScheduledTaskFilter): Promise<ScheduledTaskListResult> {
      if (!db.listScheduledTasks) {
        throw new Error('Database adapter does not support task scheduling');
      }
      return db.listScheduledTasks(filter);
    },

    async create(data: CreateScheduledTaskInput): Promise<ScheduledTask> {
      if (!db.createScheduledTask) {
        throw new Error('Database adapter does not support task scheduling');
      }

      // Calculate initial next run time
      const nextRunAt = calculateNextRun(data.schedule);

      // Create task with calculated next run
      const task = await db.createScheduledTask({
        ...data,
        // Note: nextRunAt is set by the database adapter based on schedule
      });

      // Update next run time if needed
      if (nextRunAt && db.updateScheduledTask) {
        return db.updateScheduledTask(task.id, {
          ...data,
        });
      }

      return task;
    },

    async update(id: string, data: UpdateScheduledTaskInput): Promise<ScheduledTask> {
      if (!db.updateScheduledTask || !db.findScheduledTask) {
        throw new Error('Database adapter does not support task scheduling');
      }

      const existing = await db.findScheduledTask(id);
      if (!existing) {
        throw new Error(`Scheduled task not found: ${id}`);
      }

      return db.updateScheduledTask(id, data);
    },

    async delete(id: string): Promise<void> {
      if (!db.deleteScheduledTask) {
        throw new Error('Database adapter does not support task scheduling');
      }
      await db.deleteScheduledTask(id);
    },

    async pause(id: string): Promise<ScheduledTask> {
      if (!db.updateScheduledTask || !db.findScheduledTask) {
        throw new Error('Database adapter does not support task scheduling');
      }

      const task = await db.findScheduledTask(id);
      if (!task) {
        throw new Error(`Scheduled task not found: ${id}`);
      }

      if (task.status === 'paused') {
        return task;
      }

      return db.updateScheduledTask(id, { status: 'paused' });
    },

    async resume(id: string): Promise<ScheduledTask> {
      if (!db.updateScheduledTask || !db.findScheduledTask) {
        throw new Error('Database adapter does not support task scheduling');
      }

      const task = await db.findScheduledTask(id);
      if (!task) {
        throw new Error(`Scheduled task not found: ${id}`);
      }

      if (task.status !== 'paused') {
        return task;
      }

      // Recalculate next run time
      const nextRunAt = calculateNextRun(task.schedule);

      return db.updateScheduledTask(id, { status: 'active' });
    },

    async runNow(id: string): Promise<TaskExecution> {
      if (
        !db.findScheduledTask ||
        !db.createTaskExecution ||
        !db.updateScheduledTask
      ) {
        throw new Error('Database adapter does not support task scheduling');
      }

      const task = await db.findScheduledTask(id);
      if (!task) {
        throw new Error(`Scheduled task not found: ${id}`);
      }

      // Create execution record
      const execution = await db.createTaskExecution({ taskId: id });

      // Update task last run time
      await db.updateScheduledTask(id, {});

      return execution;
    },

    async getUpcoming(hours: number): Promise<ScheduledTask[]> {
      if (!db.getUpcomingTasks) {
        throw new Error('Database adapter does not support task scheduling');
      }
      return db.getUpcomingTasks(hours);
    },

    async getExecutions(taskId: string, limit: number = 10): Promise<TaskExecution[]> {
      if (!db.listTaskExecutions) {
        throw new Error('Database adapter does not support task scheduling');
      }
      return db.listTaskExecutions(taskId, limit);
    },

    calculateNextRun,
  };
}

/**
 * Export utility functions
 */
export { parseCronNextRun, isInMaintenanceWindow, calculateNextWindowRun };
