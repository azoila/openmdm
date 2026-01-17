import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';

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

// Mock data for demonstration
const mockDevices = [
  {
    id: 'device_001',
    enrollmentId: 'ENR-001',
    model: 'Pixel 6 Pro',
    manufacturer: 'Google',
    status: 'enrolled',
    osVersion: '14',
    lastHeartbeat: new Date().toISOString(),
    batteryLevel: 85,
  },
  {
    id: 'device_002',
    enrollmentId: 'ENR-002',
    model: 'Galaxy S23',
    manufacturer: 'Samsung',
    status: 'enrolled',
    osVersion: '13',
    lastHeartbeat: new Date(Date.now() - 3600000).toISOString(),
    batteryLevel: 42,
  },
  {
    id: 'device_003',
    enrollmentId: 'ENR-003',
    model: 'Redmi Note 12',
    manufacturer: 'Xiaomi',
    status: 'pending',
    osVersion: '12',
    lastHeartbeat: null,
    batteryLevel: null,
  },
];

export async function listDevices(options: ListOptions): Promise<void> {
  const spinner = ora('Fetching devices...').start();

  try {
    // In real implementation, this would query the database
    let devices = [...mockDevices];

    if (options.status) {
      devices = devices.filter(d => d.status === options.status);
    }

    const limit = parseInt(options.limit || '50');
    devices = devices.slice(0, limit);

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(devices, null, 2));
      return;
    }

    console.log(chalk.blue('\\n📱 Enrolled Devices\\n'));

    if (devices.length === 0) {
      console.log(chalk.gray('No devices found.'));
      return;
    }

    // Table header
    console.log(
      chalk.gray(
        `${'ID'.padEnd(15)} ${'Model'.padEnd(20)} ${'Status'.padEnd(12)} ${'OS'.padEnd(6)} ${'Battery'.padEnd(8)} ${'Last Seen'.padEnd(20)}`
      )
    );
    console.log(chalk.gray('-'.repeat(85)));

    // Table rows
    for (const device of devices) {
      const statusColor =
        device.status === 'enrolled'
          ? chalk.green
          : device.status === 'pending'
          ? chalk.yellow
          : chalk.red;

      const lastSeen = device.lastHeartbeat
        ? formatRelativeTime(new Date(device.lastHeartbeat))
        : 'Never';

      const battery = device.batteryLevel !== null ? `${device.batteryLevel}%` : '-';

      console.log(
        `${device.id.padEnd(15)} ${device.model.padEnd(20)} ${statusColor(
          device.status.padEnd(12)
        )} ${device.osVersion.padEnd(6)} ${battery.padEnd(8)} ${lastSeen.padEnd(20)}`
      );
    }

    console.log(chalk.gray(`\\nTotal: ${devices.length} devices`));
  } catch (error) {
    spinner.fail('Failed to fetch devices');
    console.error(chalk.red(error));
  }
}

export async function showDevice(deviceId: string, options: ShowOptions): Promise<void> {
  const spinner = ora(`Fetching device ${deviceId}...`).start();

  try {
    // In real implementation, this would query the database
    const device = mockDevices.find(d => d.id === deviceId);

    spinner.stop();

    if (!device) {
      console.log(chalk.red(`\\nDevice not found: ${deviceId}`));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(device, null, 2));
      return;
    }

    console.log(chalk.blue(`\\n📱 Device Details: ${deviceId}\\n`));
    console.log(`  ${chalk.gray('Enrollment ID:')}  ${device.enrollmentId}`);
    console.log(`  ${chalk.gray('Model:')}          ${device.model}`);
    console.log(`  ${chalk.gray('Manufacturer:')}   ${device.manufacturer}`);
    console.log(`  ${chalk.gray('OS Version:')}     Android ${device.osVersion}`);
    console.log(
      `  ${chalk.gray('Status:')}         ${
        device.status === 'enrolled' ? chalk.green(device.status) : chalk.yellow(device.status)
      }`
    );
    console.log(
      `  ${chalk.gray('Battery:')}        ${device.batteryLevel !== null ? `${device.batteryLevel}%` : '-'}`
    );
    console.log(
      `  ${chalk.gray('Last Heartbeat:')} ${
        device.lastHeartbeat ? formatRelativeTime(new Date(device.lastHeartbeat)) : 'Never'
      }`
    );
    console.log('');
  } catch (error) {
    spinner.fail('Failed to fetch device');
    console.error(chalk.red(error));
  }
}

export async function syncDevice(deviceId: string): Promise<void> {
  const spinner = ora(`Sending sync command to ${deviceId}...`).start();

  try {
    // In real implementation, this would send a command via the MDM
    await new Promise(resolve => setTimeout(resolve, 1000));
    spinner.succeed(`Sync command sent to ${deviceId}`);
    console.log(chalk.gray('The device will sync on its next connection.'));
  } catch (error) {
    spinner.fail('Failed to send sync command');
    console.error(chalk.red(error));
  }
}

export async function lockDevice(deviceId: string, options: LockOptions): Promise<void> {
  const spinner = ora(`Sending lock command to ${deviceId}...`).start();

  try {
    // In real implementation, this would send a lock command
    await new Promise(resolve => setTimeout(resolve, 1000));
    spinner.succeed(`Lock command sent to ${deviceId}`);

    if (options.message) {
      console.log(chalk.gray(`Lock screen message: "${options.message}"`));
    }
  } catch (error) {
    spinner.fail('Failed to send lock command');
    console.error(chalk.red(error));
  }
}

export async function wipeDevice(deviceId: string, options: WipeOptions): Promise<void> {
  if (!options.force) {
    console.log(chalk.red('\\n⚠️  WARNING: This will factory reset the device!'));
    console.log(chalk.red('All data will be permanently deleted.\\n'));

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

  try {
    // In real implementation, this would send a wipe command
    await new Promise(resolve => setTimeout(resolve, 1500));
    spinner.succeed(`Wipe command sent to ${deviceId}`);

    if (options.preserveData) {
      console.log(chalk.gray('SD card data will be preserved.'));
    }

    console.log(chalk.yellow('\\nThe device will be wiped on its next connection.'));
  } catch (error) {
    spinner.fail('Failed to send wipe command');
    console.error(chalk.red(error));
  }
}

export async function removeDevice(deviceId: string, options: RemoveOptions): Promise<void> {
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

  try {
    // In real implementation, this would remove the device
    await new Promise(resolve => setTimeout(resolve, 1000));
    spinner.succeed(`Device ${deviceId} removed from MDM`);
  } catch (error) {
    spinner.fail('Failed to remove device');
    console.error(chalk.red(error));
  }
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
