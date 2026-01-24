# @openmdm/core

## 0.4.0

### Minor Changes

- [#6](https://github.com/azoila/openmdm/pull/6) [`997236f`](https://github.com/azoila/openmdm/commit/997236fca5bb2311b4e736b552500aacab6c82d8) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - feat: Add agent versioning and app version tracking

  **New Features:**

  - Added `agentVersion` field to Device interface and schema for tracking MDM agent versions on devices
  - Added `updateAgent` command type to the CommandType union for agent self-update operations
  - Added `mdm_app_versions` table for tracking app version history and supporting rollback operations
  - Added `mdm_rollbacks` table for tracking rollback operation history and status

  **Drizzle Adapter:**

  - Implemented optional `listAppVersions`, `createAppVersion`, `setMinimumVersion`, `getMinimumVersion` methods
  - Implemented optional `createRollback`, `updateRollback`, `listRollbacks` methods
  - Added `rollbackStatusEnum` enum for rollback status tracking
  - Added relations for new tables to existing schema

  **Schema Updates:**

  - Extended `UpdateDeviceInput` to include optional `agentVersion` field
  - Added proper column definitions with indexes for the new tables

## 0.3.0

### Minor Changes

- Add enterprise SDK features:

  - **Multi-tenancy** - TenantManager for customer/organization isolation
  - **RBAC** - AuthorizationManager with granular permission system
  - **Audit logging** - AuditManager for compliance and security tracking
  - **Scheduling** - ScheduleManager for scheduled tasks with cron support
  - **Message queue** - MessageQueueManager for persistent push messaging
  - **Dashboard** - DashboardManager for analytics and statistics
  - **Plugin storage** - PluginStorageAdapter for persistent plugin state
  - **Group hierarchy** - Tree operations, ancestors, descendants, effective policies

  New database tables: mdm_tenants, mdm_roles, mdm_users, mdm_user_roles, mdm_audit_logs, mdm_scheduled_tasks, mdm_task_executions, mdm_message_queue, mdm_plugin_storage

  All features are optional and backwards compatible.

## 0.2.0

### Minor Changes

- [`7e46ef2`](https://github.com/azoila/openmdm/commit/7e46ef205d03dbc488c0ecf924d20aac88f60bc8) Thanks [@andersonkxiass](https://github.com/andersonkxiass)! - Initial release of OpenMDM - a modern, embeddable Mobile Device Management SDK for TypeScript.

  **Core Features:**

  - Device enrollment and management
  - Policy configuration and deployment
  - Command execution (sync, lock, wipe, reboot)
  - Application management
  - Event system with webhooks

  **Adapters:**

  - Hono framework adapter for HTTP endpoints
  - Drizzle ORM adapter for database operations
  - S3 storage adapter for APK uploads

  **Push Notifications:**

  - Firebase Cloud Messaging (FCM) adapter
  - MQTT adapter for private networks

  **Plugins:**

  - Kiosk mode plugin
  - Geofencing plugin

  **Tools:**

  - CLI for device and policy management
  - Client SDK for device-side integration
