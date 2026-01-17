import chalk from 'chalk';
import ora from 'ora';

interface StatsOptions {
  json?: boolean;
}

export async function showStats(options: StatsOptions): Promise<void> {
  const spinner = ora('Fetching statistics...').start();

  try {
    // Mock statistics - in real implementation, this queries the database
    const stats = {
      devices: {
        total: 85,
        enrolled: 72,
        pending: 8,
        blocked: 5,
        online: 45,
        offline: 40,
      },
      policies: {
        total: 5,
        withDevices: 4,
      },
      commands: {
        pending: 12,
        completedToday: 156,
        failedToday: 3,
      },
      system: {
        uptime: '15 days, 4 hours',
        version: '0.1.0',
        lastBackup: new Date(Date.now() - 86400000).toISOString(),
      },
    };

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    console.log(chalk.blue('\\n📊 OpenMDM Statistics\\n'));

    // Devices section
    console.log(chalk.white.bold('  Devices'));
    console.log(chalk.gray('  ─────────────────────'));
    console.log(`  Total:    ${chalk.cyan(stats.devices.total)}`);
    console.log(`  Enrolled: ${chalk.green(stats.devices.enrolled)}`);
    console.log(`  Pending:  ${chalk.yellow(stats.devices.pending)}`);
    console.log(`  Blocked:  ${chalk.red(stats.devices.blocked)}`);
    console.log('');
    console.log(`  Online:   ${chalk.green(stats.devices.online)}`);
    console.log(`  Offline:  ${chalk.gray(stats.devices.offline)}`);
    console.log('');

    // Policies section
    console.log(chalk.white.bold('  Policies'));
    console.log(chalk.gray('  ─────────────────────'));
    console.log(`  Total:        ${chalk.cyan(stats.policies.total)}`);
    console.log(`  With devices: ${chalk.cyan(stats.policies.withDevices)}`);
    console.log('');

    // Commands section
    console.log(chalk.white.bold('  Commands (Today)'));
    console.log(chalk.gray('  ─────────────────────'));
    console.log(`  Pending:   ${chalk.yellow(stats.commands.pending)}`);
    console.log(`  Completed: ${chalk.green(stats.commands.completedToday)}`);
    console.log(`  Failed:    ${chalk.red(stats.commands.failedToday)}`);
    console.log('');

    // System section
    console.log(chalk.white.bold('  System'));
    console.log(chalk.gray('  ─────────────────────'));
    console.log(`  Version:     ${chalk.cyan(stats.system.version)}`);
    console.log(`  Uptime:      ${stats.system.uptime}`);
    console.log(`  Last backup: ${formatDate(stats.system.lastBackup)}`);
    console.log('');
  } catch (error) {
    spinner.fail('Failed to fetch statistics');
    console.error(chalk.red(error));
  }
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}
