import chalk from 'chalk';
import ora from 'ora';
import type { MDMInstance } from '@openmdm/core';
import { withMDM } from '../config.js';

interface StatsOptions {
  json?: boolean;
}

export const showStats = withMDM(async (mdm: MDMInstance, options: StatsOptions) => {
  if (!mdm.dashboard) {
    throw new Error('Dashboard manager is not available on this MDM instance.');
  }

  const spinner = ora('Fetching statistics...').start();
  const [stats, commandRates] = await Promise.all([
    mdm.dashboard.getStats(),
    mdm.dashboard.getCommandSuccessRates(),
  ]);
  spinner.stop();

  if (options.json) {
    console.log(JSON.stringify({ ...stats, commandRates }, null, 2));
    return;
  }

  console.log(chalk.blue('\n📊 OpenMDM Statistics\n'));

  console.log(chalk.white.bold('  Devices'));
  console.log(chalk.gray('  ─────────────────────'));
  console.log(`  Total:       ${chalk.cyan(stats.devices.total)}`);
  console.log(`  Enrolled:    ${chalk.green(stats.devices.enrolled)}`);
  console.log(`  Active:      ${chalk.green(stats.devices.active)}`);
  console.log(`  Pending:     ${chalk.yellow(stats.devices.pending)}`);
  console.log(`  Blocked:     ${chalk.red(stats.devices.blocked)}`);
  console.log('');

  console.log(chalk.white.bold('  Policies'));
  console.log(chalk.gray('  ─────────────────────'));
  console.log(`  Total:       ${chalk.cyan(stats.policies.total)}`);
  console.log(`  Deployed:    ${chalk.cyan(stats.policies.deployed)}`);
  console.log('');

  console.log(chalk.white.bold('  Applications'));
  console.log(chalk.gray('  ─────────────────────'));
  console.log(`  Total:       ${chalk.cyan(stats.applications.total)}`);
  console.log(`  Deployed:    ${chalk.cyan(stats.applications.deployed)}`);
  console.log('');

  console.log(chalk.white.bold('  Commands (all time)'));
  console.log(chalk.gray('  ─────────────────────'));
  console.log(`  Total:       ${chalk.cyan(commandRates.overall.total)}`);
  console.log(`  Completed:   ${chalk.green(commandRates.overall.completed)}`);
  console.log(`  Failed:      ${chalk.red(commandRates.overall.failed)}`);
  console.log(
    `  Success:     ${chalk.cyan(commandRates.overall.successRate.toFixed(1) + '%')}`
  );
  console.log('');

  console.log(chalk.white.bold('  Commands (last 24h)'));
  console.log(chalk.gray('  ─────────────────────'));
  console.log(`  Total:       ${chalk.cyan(commandRates.last24h.total)}`);
  console.log(`  Completed:   ${chalk.green(commandRates.last24h.completed)}`);
  console.log(`  Failed:      ${chalk.red(commandRates.last24h.failed)}`);
  console.log('');
});
