---
"@openmdm/core": minor
"@openmdm/drizzle-adapter": minor
---

feat: Add agent versioning and app version tracking

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
