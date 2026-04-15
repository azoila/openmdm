import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import type { Device, DeviceFilter, DeviceStatus, MDMInstance } from '@openmdm/core';
import { withMDM } from '../config.js';

interface ListOptions {
  status?: string;
  limit?: string;
  json?: boolean;
}

interface ShowOptions {
  json?: boolean;
}

interface LockOptions {
  message?: string;
}

interface WipeOptions {
  force?: boolean;
  preserveData?: boolean;
}

interface RemoveOptions {
  force?: boolean;
}

const VALID_STATUSES: readonly DeviceStatus[] = [
  'pending',
  'enrolled',
  'unenrolled',
  'blocked',
] as const;

function isDeviceStatus(value: string): value is DeviceStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

export const listDevices = withMDM(async (mdm: MDMInstance, options: ListOptions) => {
  const filter: DeviceFilter = {};

  if (options.status) {
    if (!isDeviceStatus(options.status)) {
      throw new Error(
        `Invalid status "${options.status}". Valid values: ${VALID_STATUSES.join(', ')}`
      );
    }
    filter.status = options.status;
  }

  const limit = Number.parseInt(options.limit ?? '50', 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid limit: ${options.limit}`);
  }
  filter.limit = limit;

  const spinner = ora('Fetching devices...').start();
  const result = await mdm.devices.list(filter);
  spinner.stop();

  if (options.json) {
    console.log(JSON.stringify(result.devices, null, 2));
    return;
  }

  console.log(chalk.blue('\n📱 Devices\n'));

  if (result.devices.length === 0) {
    console.log(chalk.gray('No devices found.'));
    return;
  }

  console.log(
    chalk.gray(
      `${'ID'.padEnd(20)} ${'Model'.padEnd(22)} ${'Status'.padEnd(12)} ${'OS'.padEnd(8)} ${'Battery'.padEnd(8)} ${'Last Seen'.padEnd(14)}`
    )
  );
  console.log(chalk.gray('-'.repeat(90)));

  for (const device of result.devices) {
    const statusColor =
      device.status === 'enrolled'
        ? chalk.green
        : device.status === 'pending'
        ? chalk.yellow
        : chalk.red;

    const lastSeen = device.lastHeartbeat ? formatRelativeTime(device.lastHeartbeat) : 'Never';
    const battery = device.batteryLevel != null ? `${device.batteryLevel}%` : '-';
    const model = device.model ?? '-';
    const os = device.osVersion ?? '-';

    console.log(
      `${truncate(device.id, 20).padEnd(20)} ${truncate(model, 22).padEnd(22)} ${statusColor(
        device.status.padEnd(12)
      )} ${os.padEnd(8)} ${battery.padEnd(8)} ${lastSeen.padEnd(14)}`
    );
  }

  console.log(chalk.gray(`\nShowing ${result.devices.length} of ${result.total} total devices`));
});

export const showDevice = withMDM(
  async (mdm: MDMInstance, deviceId: string, options: ShowOptions) => {
    const spinner = ora(`Fetching device ${deviceId}...`).start();
    const device = await mdm.devices.get(deviceId);
    spinner.stop();

    if (!device) {
      console.log(chalk.red(`\nDevice not found: ${deviceId}`));
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(device, null, 2));
      return;
    }

    renderDeviceDetails(device);
  }
);

export const syncDevice = withMDM(async (mdm: MDMInstance, deviceId: string) => {
  const spinner = ora(`Sending sync command to ${deviceId}...`).start();
  const command = await mdm.devices.sync(deviceId);
  spinner.succeed(`Sync command queued for ${deviceId} (command ${command.id})`);
  console.log(chalk.gray('The device will sync on its next connection.'));
});

export const lockDevice = withMDM(
  async (mdm: MDMInstance, deviceId: string, options: LockOptions) => {
    const spinner = ora(`Sending lock command to ${deviceId}...`).start();
    const command = await mdm.devices.lock(deviceId, options.message);
    spinner.succeed(`Lock command queued for ${deviceId} (command ${command.id})`);
    if (options.message) {
      console.log(chalk.gray(`Lock screen message: "${options.message}"`));
    }
  }
);

export const wipeDevice = withMDM(
  async (mdm: MDMInstance, deviceId: string, options: WipeOptions) => {
    if (!options.force) {
      console.log(chalk.red('\n⚠️  WARNING: This will factory reset the device!'));
      console.log(chalk.red('All data will be permanently deleted.\n'));

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to wipe device ${deviceId}?`,
          default: false,
        },
      ]);

      if (!confirm) {
        console.log(chalk.yellow('Wipe cancelled.'));
        return;
      }
    }

    const spinner = ora(`Sending wipe command to ${deviceId}...`).start();
    const command = await mdm.devices.wipe(deviceId, options.preserveData);
    spinner.succeed(`Wipe command queued for ${deviceId} (command ${command.id})`);

    if (options.preserveData) {
      console.log(chalk.gray('SD card data will be preserved.'));
    }
    console.log(chalk.yellow('\nThe device will be wiped on its next connection.'));
  }
);

export const removeDevice = withMDM(
  async (mdm: MDMInstance, deviceId: string, options: RemoveOptions) => {
    if (!options.force) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to remove device ${deviceId} from MDM?`,
          default: false,
        },
      ]);

      if (!confirm) {
        console.log(chalk.yellow('Removal cancelled.'));
        return;
      }
    }

    const spinner = ora(`Removing device ${deviceId}...`).start();
    await mdm.devices.delete(deviceId);
    spinner.succeed(`Device ${deviceId} removed from MDM`);
  }
);

function renderDeviceDetails(device: Device): void {
  console.log(chalk.blue(`\n📱 Device Details: ${device.id}\n`));
  row('Enrollment ID', device.enrollmentId);
  row('External ID', device.externalId ?? '-');
  row('Model', device.model ?? '-');
  row('Manufacturer', device.manufacturer ?? '-');
  row('OS Version', device.osVersion ? `Android ${device.osVersion}` : '-');
  row('Serial Number', device.serialNumber ?? '-');
  row('Agent Version', device.agentVersion ?? '-');
  console.log('');
  row(
    'Status',
    device.status === 'enrolled'
      ? chalk.green(device.status)
      : chalk.yellow(device.status)
  );
  row('Policy ID', device.policyId ?? '-');
  row('Battery', device.batteryLevel != null ? `${device.batteryLevel}%` : '-');
  row(
    'Storage',
    device.storageUsed != null && device.storageTotal != null
      ? `${formatBytes(device.storageUsed)} / ${formatBytes(device.storageTotal)}`
      : '-'
  );
  row('Last Heartbeat', device.lastHeartbeat ? formatRelativeTime(device.lastHeartbeat) : 'Never');
  row('Last Sync', device.lastSync ? formatRelativeTime(device.lastSync) : 'Never');
  console.log('');
}

function row(label: string, value: string): void {
  console.log(`  ${chalk.gray((label + ':').padEnd(16))} ${value}`);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
