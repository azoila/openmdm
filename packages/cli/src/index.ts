/**
 * OpenMDM CLI
 *
 * Command-line tools for managing OpenMDM deployments.
 *
 * Commands:
 * - init: Initialize a new OpenMDM project
 * - migrate: Run database migrations
 * - device: Manage devices (list, show, wipe, etc.)
 * - policy: Manage policies
 * - enroll: Generate enrollment QR codes/tokens
 * - push: Test push notifications
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables
dotenvConfig();

const program = new Command();

program
  .name('openmdm')
  .description('OpenMDM CLI - Mobile Device Management tools')
  .version('0.1.0');

// Init command
program
  .command('init')
  .description('Initialize a new OpenMDM configuration')
  .option('-d, --database <type>', 'Database type (postgres, mysql, sqlite)', 'postgres')
  .option('-p, --push <type>', 'Push provider (fcm, mqtt, polling)', 'fcm')
  .action(async (options) => {
    const { initProject } = await import('./commands/init.js');
    await initProject(options);
  });

// Migrate command
program
  .command('migrate')
  .description('Run database migrations')
  .option('--dry-run', 'Show migration SQL without executing')
  .option('--rollback', 'Rollback last migration')
  .action(async (options) => {
    const { runMigrations } = await import('./commands/migrate.js');
    await runMigrations(options);
  });

// Device commands
const deviceCmd = program
  .command('device')
  .description('Device management commands');

deviceCmd
  .command('list')
  .description('List all enrolled devices')
  .option('-s, --status <status>', 'Filter by status (enrolled, pending, blocked)')
  .option('-l, --limit <number>', 'Limit results', '50')
  .option('-j, --json', 'Output as JSON')
  .action(async (options) => {
    const { listDevices } = await import('./commands/device.js');
    await listDevices(options);
  });

deviceCmd
  .command('show <deviceId>')
  .description('Show device details')
  .option('-j, --json', 'Output as JSON')
  .action(async (deviceId, options) => {
    const { showDevice } = await import('./commands/device.js');
    await showDevice(deviceId, options);
  });

deviceCmd
  .command('sync <deviceId>')
  .description('Send sync command to device')
  .action(async (deviceId) => {
    const { syncDevice } = await import('./commands/device.js');
    await syncDevice(deviceId);
  });

deviceCmd
  .command('lock <deviceId>')
  .description('Lock a device')
  .option('-m, --message <message>', 'Lock screen message')
  .action(async (deviceId, options) => {
    const { lockDevice } = await import('./commands/device.js');
    await lockDevice(deviceId, options);
  });

deviceCmd
  .command('wipe <deviceId>')
  .description('Wipe/factory reset a device')
  .option('-f, --force', 'Skip confirmation')
  .option('--preserve-data', 'Preserve SD card data')
  .action(async (deviceId, options) => {
    const { wipeDevice } = await import('./commands/device.js');
    await wipeDevice(deviceId, options);
  });

deviceCmd
  .command('remove <deviceId>')
  .description('Remove a device from MDM')
  .option('-f, --force', 'Skip confirmation')
  .action(async (deviceId, options) => {
    const { removeDevice } = await import('./commands/device.js');
    await removeDevice(deviceId, options);
  });

// Policy commands
const policyCmd = program
  .command('policy')
  .description('Policy management commands');

policyCmd
  .command('list')
  .description('List all policies')
  .option('-j, --json', 'Output as JSON')
  .action(async (options) => {
    const { listPolicies } = await import('./commands/policy.js');
    await listPolicies(options);
  });

policyCmd
  .command('show <policyId>')
  .description('Show policy details')
  .option('-j, --json', 'Output as JSON')
  .action(async (policyId, options) => {
    const { showPolicy } = await import('./commands/policy.js');
    await showPolicy(policyId, options);
  });

policyCmd
  .command('create')
  .description('Create a new policy interactively')
  .option('-f, --file <path>', 'Create from JSON file')
  .action(async (options) => {
    const { createPolicy } = await import('./commands/policy.js');
    await createPolicy(options);
  });

policyCmd
  .command('apply <policyId> <deviceId>')
  .description('Apply policy to a device')
  .action(async (policyId, deviceId) => {
    const { applyPolicy } = await import('./commands/policy.js');
    await applyPolicy(policyId, deviceId);
  });

// Enrollment commands
const enrollCmd = program
  .command('enroll')
  .description('Device enrollment commands');

enrollCmd
  .command('qr')
  .description('Generate enrollment QR code')
  .option('-p, --policy <policyId>', 'Pre-assign policy')
  .option('-g, --group <groupId>', 'Pre-assign group')
  .option('-o, --output <path>', 'Save QR code to file')
  .option('--ascii', 'Output ASCII QR code to terminal')
  .action(async (options) => {
    const { generateQR } = await import('./commands/enroll.js');
    await generateQR(options);
  });

enrollCmd
  .command('token')
  .description('Generate enrollment token')
  .option('-p, --policy <policyId>', 'Pre-assign policy')
  .option('-g, --group <groupId>', 'Pre-assign group')
  .option('-e, --expires <hours>', 'Token expiration in hours', '24')
  .action(async (options) => {
    const { generateToken } = await import('./commands/enroll.js');
    await generateToken(options);
  });

// Push test command
program
  .command('push-test <deviceId>')
  .description('Send test push notification to device')
  .option('-t, --title <title>', 'Notification title', 'Test Notification')
  .option('-m, --message <message>', 'Notification message', 'This is a test from OpenMDM')
  .action(async (deviceId, options) => {
    const { testPush } = await import('./commands/push.js');
    await testPush(deviceId, options);
  });

// Stats command
program
  .command('stats')
  .description('Show MDM statistics')
  .option('-j, --json', 'Output as JSON')
  .action(async (options) => {
    const { showStats } = await import('./commands/stats.js');
    await showStats(options);
  });

// Parse and execute
program.parse();
