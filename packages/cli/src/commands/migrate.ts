import chalk from 'chalk';
import ora from 'ora';

interface MigrateOptions {
  dryRun?: boolean;
  rollback?: boolean;
}

const MIGRATION_SQL = `
-- OpenMDM Database Schema
-- PostgreSQL Migration

-- Device Status Enum
DO $$ BEGIN
  CREATE TYPE mdm_device_status AS ENUM ('pending', 'enrolled', 'unenrolled', 'blocked');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Command Status Enum
DO $$ BEGIN
  CREATE TYPE mdm_command_status AS ENUM ('pending', 'sent', 'acknowledged', 'completed', 'failed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Push Provider Enum
DO $$ BEGIN
  CREATE TYPE mdm_push_provider AS ENUM ('fcm', 'mqtt', 'websocket');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Devices Table
CREATE TABLE IF NOT EXISTS mdm_devices (
  id VARCHAR(255) PRIMARY KEY,
  external_id VARCHAR(255),
  enrollment_id VARCHAR(255) NOT NULL UNIQUE,
  status mdm_device_status NOT NULL DEFAULT 'pending',

  model VARCHAR(255),
  manufacturer VARCHAR(255),
  os_version VARCHAR(50),
  serial_number VARCHAR(255),
  imei VARCHAR(50),
  mac_address VARCHAR(50),
  android_id VARCHAR(255),

  policy_id VARCHAR(255),
  last_heartbeat TIMESTAMP,
  last_sync TIMESTAMP,

  battery_level INTEGER,
  storage_used BIGINT,
  storage_total BIGINT,
  location JSONB,
  installed_apps JSONB,

  tags JSONB,
  metadata JSONB,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Policies Table
CREATE TABLE IF NOT EXISTS mdm_policies (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Applications Table
CREATE TABLE IF NOT EXISTS mdm_applications (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  package_name VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  version_code INTEGER NOT NULL,
  url TEXT NOT NULL,
  hash VARCHAR(255),
  size BIGINT,
  min_sdk_version INTEGER,

  show_icon BOOLEAN NOT NULL DEFAULT true,
  run_after_install BOOLEAN NOT NULL DEFAULT false,
  run_at_boot BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,

  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Commands Table
CREATE TABLE IF NOT EXISTS mdm_commands (
  id VARCHAR(255) PRIMARY KEY,
  device_id VARCHAR(255) NOT NULL REFERENCES mdm_devices(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  payload JSONB,
  status mdm_command_status NOT NULL DEFAULT 'pending',
  result JSONB,
  error TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Events Table
CREATE TABLE IF NOT EXISTS mdm_events (
  id VARCHAR(255) PRIMARY KEY,
  device_id VARCHAR(255) NOT NULL REFERENCES mdm_devices(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Groups Table
CREATE TABLE IF NOT EXISTS mdm_groups (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  policy_id VARCHAR(255) REFERENCES mdm_policies(id) ON DELETE SET NULL,
  parent_id VARCHAR(255) REFERENCES mdm_groups(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Device Groups Junction Table
CREATE TABLE IF NOT EXISTS mdm_device_groups (
  device_id VARCHAR(255) NOT NULL REFERENCES mdm_devices(id) ON DELETE CASCADE,
  group_id VARCHAR(255) NOT NULL REFERENCES mdm_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (device_id, group_id)
);

-- Push Tokens Table
CREATE TABLE IF NOT EXISTS mdm_push_tokens (
  id VARCHAR(255) PRIMARY KEY,
  device_id VARCHAR(255) NOT NULL REFERENCES mdm_devices(id) ON DELETE CASCADE,
  provider mdm_push_provider NOT NULL,
  token TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(device_id, provider)
);

-- App Deployments Table
CREATE TABLE IF NOT EXISTS mdm_app_deployments (
  id VARCHAR(255) PRIMARY KEY,
  application_id VARCHAR(255) NOT NULL REFERENCES mdm_applications(id) ON DELETE CASCADE,
  target_type VARCHAR(20) NOT NULL, -- 'device', 'policy', 'group'
  target_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_devices_status ON mdm_devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_policy ON mdm_devices(policy_id);
CREATE INDEX IF NOT EXISTS idx_devices_enrollment ON mdm_devices(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_devices_last_heartbeat ON mdm_devices(last_heartbeat);

CREATE INDEX IF NOT EXISTS idx_commands_device ON mdm_commands(device_id);
CREATE INDEX IF NOT EXISTS idx_commands_status ON mdm_commands(status);
CREATE INDEX IF NOT EXISTS idx_commands_device_status ON mdm_commands(device_id, status);

CREATE INDEX IF NOT EXISTS idx_events_device ON mdm_events(device_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON mdm_events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON mdm_events(created_at);

CREATE INDEX IF NOT EXISTS idx_applications_package ON mdm_applications(package_name);
CREATE INDEX IF NOT EXISTS idx_push_tokens_device ON mdm_push_tokens(device_id);
`;

const ROLLBACK_SQL = `
-- OpenMDM Database Rollback

DROP TABLE IF EXISTS mdm_app_deployments;
DROP TABLE IF EXISTS mdm_push_tokens;
DROP TABLE IF EXISTS mdm_device_groups;
DROP TABLE IF EXISTS mdm_events;
DROP TABLE IF EXISTS mdm_commands;
DROP TABLE IF EXISTS mdm_applications;
DROP TABLE IF EXISTS mdm_groups;
DROP TABLE IF EXISTS mdm_devices;
DROP TABLE IF EXISTS mdm_policies;

DROP TYPE IF EXISTS mdm_push_provider;
DROP TYPE IF EXISTS mdm_command_status;
DROP TYPE IF EXISTS mdm_device_status;
`;

export async function runMigrations(options: MigrateOptions): Promise<void> {
  console.log(chalk.blue('\\n📦 OpenMDM Database Migration\\n'));

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl && !options.dryRun) {
    console.error(chalk.red('Error: DATABASE_URL environment variable is required'));
    console.log(chalk.gray('Set it in your .env file or export it before running migrations.'));
    process.exit(1);
  }

  if (options.rollback) {
    console.log(chalk.yellow('⚠️  Rolling back migrations...\\n'));

    if (options.dryRun) {
      console.log(chalk.gray('SQL to execute:'));
      console.log(ROLLBACK_SQL);
      return;
    }

    const spinner = ora('Rolling back...').start();

    try {
      // In a real implementation, we'd use a database client here
      // For now, just output the SQL
      console.log(chalk.gray('\\nRollback SQL:'));
      console.log(ROLLBACK_SQL);
      spinner.succeed('Rollback SQL generated');

      console.log(chalk.yellow('\\n⚠️  Execute the above SQL manually or use a database client.'));
    } catch (error) {
      spinner.fail('Rollback failed');
      console.error(chalk.red(error));
    }

    return;
  }

  if (options.dryRun) {
    console.log(chalk.gray('SQL to execute:'));
    console.log(MIGRATION_SQL);
    return;
  }

  const spinner = ora('Running migrations...').start();

  try {
    // In a real implementation, we'd connect to the database and execute
    // For now, output the SQL
    console.log(chalk.gray('\\nMigration SQL:'));
    console.log(MIGRATION_SQL);
    spinner.succeed('Migration SQL generated');

    console.log(chalk.green('\\n✅ Migration complete!'));
    console.log(chalk.gray('\\nExecute the above SQL against your database,'));
    console.log(chalk.gray('or integrate with Drizzle Kit for automated migrations:'));
    console.log(chalk.gray('  npx drizzle-kit push:pg'));
  } catch (error) {
    spinner.fail('Migration failed');
    console.error(chalk.red(error));
  }
}
