import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs/promises';
import type { CreatePolicyInput, MDMInstance, Policy } from '@openmdm/core';
import { withMDM } from '../config.js';

interface ListOptions {
  json?: boolean;
}

interface ShowOptions {
  json?: boolean;
}

interface CreateOptions {
  file?: string;
}

export const listPolicies = withMDM(async (mdm: MDMInstance, options: ListOptions) => {
  const spinner = ora('Fetching policies...').start();
  const policies = await mdm.policies.list();
  spinner.stop();

  if (options.json) {
    console.log(JSON.stringify(policies, null, 2));
    return;
  }

  console.log(chalk.blue('\n📋 Policies\n'));

  if (policies.length === 0) {
    console.log(chalk.gray('No policies found.'));
    return;
  }

  const counts = await Promise.all(
    policies.map(async (p) => {
      const result = await mdm.devices.list({ policyId: p.id, limit: 1 });
      return result.total;
    })
  );

  console.log(
    chalk.gray(
      `${'ID'.padEnd(24)} ${'Name'.padEnd(28)} ${'Default'.padEnd(10)} ${'Devices'.padEnd(10)}`
    )
  );
  console.log(chalk.gray('-'.repeat(75)));

  policies.forEach((policy, i) => {
    const defaultStr = policy.isDefault ? chalk.green('Yes') : 'No';
    console.log(
      `${truncate(policy.id, 24).padEnd(24)} ${truncate(policy.name, 28).padEnd(28)} ${defaultStr.padEnd(
        10
      )} ${String(counts[i]).padEnd(10)}`
    );
  });

  console.log(chalk.gray(`\nTotal: ${policies.length} policies`));
});

export const showPolicy = withMDM(
  async (mdm: MDMInstance, policyId: string, options: ShowOptions) => {
    const spinner = ora(`Fetching policy ${policyId}...`).start();
    const policy = await mdm.policies.get(policyId);
    spinner.stop();

    if (!policy) {
      console.log(chalk.red(`\nPolicy not found: ${policyId}`));
      process.exitCode = 1;
      return;
    }

    const devicesUsingPolicy = await mdm.devices.list({ policyId: policy.id, limit: 1 });

    if (options.json) {
      console.log(
        JSON.stringify({ ...policy, deviceCount: devicesUsingPolicy.total }, null, 2)
      );
      return;
    }

    renderPolicyDetails(policy, devicesUsingPolicy.total);
  }
);

export const createPolicy = withMDM(async (mdm: MDMInstance, options: CreateOptions) => {
  let input: CreatePolicyInput;

  if (options.file) {
    const content = await fs.readFile(options.file, 'utf-8');
    const parsed = JSON.parse(content) as CreatePolicyInput;
    if (!parsed.name) {
      throw new Error('Policy file must include a "name" field');
    }
    if (!parsed.settings || typeof parsed.settings !== 'object') {
      throw new Error('Policy file must include a "settings" object');
    }

    console.log(chalk.blue('\nPolicy to create:'));
    console.log(`  Name: ${parsed.name}`);
    console.log(`  Description: ${parsed.description ?? '-'}`);
    console.log(`  Default: ${parsed.isDefault ? 'Yes' : 'No'}`);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Create this policy?',
        default: true,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow('Cancelled.'));
      return;
    }

    input = parsed;
  } else {
    console.log(chalk.blue('\n📋 Create New Policy\n'));

    interface PolicyAnswers {
      name: string;
      description?: string;
      kioskMode: boolean;
      mainApp?: string;
      lockStatusBar?: boolean;
      isDefault: boolean;
    }

    const answers = (await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Policy name:',
        validate: (v: string) => v.length > 0 || 'Name is required',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):',
      },
      {
        type: 'confirm',
        name: 'kioskMode',
        message: 'Enable kiosk mode?',
        default: false,
      },
      {
        type: 'input',
        name: 'mainApp',
        message: 'Kiosk app package name:',
        when: (a: { kioskMode?: boolean }) => !!a.kioskMode,
      },
      {
        type: 'confirm',
        name: 'lockStatusBar',
        message: 'Lock status bar?',
        when: (a: { kioskMode?: boolean }) => !!a.kioskMode,
        default: true,
      },
      {
        type: 'confirm',
        name: 'isDefault',
        message: 'Set as default policy?',
        default: false,
      },
    ])) as unknown as PolicyAnswers;

    input = {
      name: answers.name,
      description: answers.description || undefined,
      isDefault: answers.isDefault,
      settings: {
        kioskMode: answers.kioskMode,
        ...(answers.mainApp ? { mainApp: answers.mainApp } : {}),
        ...(answers.kioskMode ? { lockStatusBar: answers.lockStatusBar ?? false } : {}),
      },
    };
  }

  const spinner = ora('Creating policy...').start();
  const policy = await mdm.policies.create(input);
  spinner.succeed(`Policy "${policy.name}" created (${policy.id})`);
});

export const applyPolicy = withMDM(
  async (mdm: MDMInstance, policyId: string, deviceId: string) => {
    const spinner = ora(`Applying policy ${policyId} to device ${deviceId}...`).start();
    await mdm.policies.applyToDevice(policyId, deviceId);
    spinner.succeed(`Policy ${policyId} applied to device ${deviceId}`);
    console.log(chalk.gray('The device will receive the new policy on its next sync.'));
  }
);

function renderPolicyDetails(policy: Policy, deviceCount: number): void {
  console.log(chalk.blue(`\n📋 Policy: ${policy.name}\n`));
  console.log(`  ${chalk.gray('ID:          ')} ${policy.id}`);
  console.log(`  ${chalk.gray('Description: ')} ${policy.description ?? '-'}`);
  console.log(
    `  ${chalk.gray('Default:     ')} ${policy.isDefault ? chalk.green('Yes') : 'No'}`
  );
  console.log(`  ${chalk.gray('Devices:     ')} ${deviceCount}`);
  console.log(`  ${chalk.gray('Created:     ')} ${policy.createdAt.toISOString()}`);
  console.log(`  ${chalk.gray('Updated:     ')} ${policy.updatedAt.toISOString()}`);
  console.log('');
  console.log(chalk.gray('  Settings:'));
  console.log(
    JSON.stringify(policy.settings, null, 2)
      .split('\n')
      .map((l) => '    ' + l)
      .join('\n')
  );
  console.log('');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
