import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fs from 'fs/promises';

interface ListOptions {
  json?: boolean;
}

interface ShowOptions {
  json?: boolean;
}

interface CreateOptions {
  file?: string;
}

// Mock data
const mockPolicies = [
  {
    id: 'policy_001',
    name: 'Default Policy',
    description: 'Standard policy for all devices',
    isDefault: true,
    settings: {
      kioskMode: false,
      lockStatusBar: false,
      heartbeatInterval: 60,
    },
    deviceCount: 45,
  },
  {
    id: 'policy_002',
    name: 'Kiosk Mode',
    description: 'Single-app kiosk mode for retail displays',
    isDefault: false,
    settings: {
      kioskMode: true,
      mainApp: 'com.example.kiosk',
      lockStatusBar: true,
      lockNavigationBar: true,
    },
    deviceCount: 12,
  },
  {
    id: 'policy_003',
    name: 'High Security',
    description: 'Strict security policy for corporate devices',
    isDefault: false,
    settings: {
      kioskMode: false,
      encryptionRequired: true,
      passwordPolicy: {
        required: true,
        minLength: 8,
        complexity: 'alphanumeric',
      },
    },
    deviceCount: 28,
  },
];

export async function listPolicies(options: ListOptions): Promise<void> {
  const spinner = ora('Fetching policies...').start();

  try {
    const policies = [...mockPolicies];
    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(policies, null, 2));
      return;
    }

    console.log(chalk.blue('\\n📋 Policies\\n'));

    if (policies.length === 0) {
      console.log(chalk.gray('No policies found.'));
      return;
    }

    // Table header
    console.log(
      chalk.gray(`${'ID'.padEnd(15)} ${'Name'.padEnd(25)} ${'Default'.padEnd(10)} ${'Devices'.padEnd(10)}`)
    );
    console.log(chalk.gray('-'.repeat(60)));

    for (const policy of policies) {
      const defaultStr = policy.isDefault ? chalk.green('Yes') : 'No';
      console.log(
        `${policy.id.padEnd(15)} ${policy.name.padEnd(25)} ${defaultStr.padEnd(10)} ${policy.deviceCount
          .toString()
          .padEnd(10)}`
      );
    }

    console.log(chalk.gray(`\\nTotal: ${policies.length} policies`));
  } catch (error) {
    spinner.fail('Failed to fetch policies');
    console.error(chalk.red(error));
  }
}

export async function showPolicy(policyId: string, options: ShowOptions): Promise<void> {
  const spinner = ora(`Fetching policy ${policyId}...`).start();

  try {
    const policy = mockPolicies.find(p => p.id === policyId);
    spinner.stop();

    if (!policy) {
      console.log(chalk.red(`\\nPolicy not found: ${policyId}`));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(policy, null, 2));
      return;
    }

    console.log(chalk.blue(`\\n📋 Policy: ${policy.name}\\n`));
    console.log(`  ${chalk.gray('ID:')}           ${policy.id}`);
    console.log(`  ${chalk.gray('Description:')}  ${policy.description || '-'}`);
    console.log(
      `  ${chalk.gray('Default:')}      ${policy.isDefault ? chalk.green('Yes') : 'No'}`
    );
    console.log(`  ${chalk.gray('Devices:')}      ${policy.deviceCount}`);
    console.log('');
    console.log(chalk.gray('  Settings:'));
    console.log(JSON.stringify(policy.settings, null, 4).split('\\n').map(l => '    ' + l).join('\\n'));
    console.log('');
  } catch (error) {
    spinner.fail('Failed to fetch policy');
    console.error(chalk.red(error));
  }
}

export async function createPolicy(options: CreateOptions): Promise<void> {
  if (options.file) {
    // Create from file
    const spinner = ora('Reading policy file...').start();
    try {
      const content = await fs.readFile(options.file, 'utf-8');
      const policy = JSON.parse(content);
      spinner.succeed('Policy file read');

      console.log(chalk.blue('\\nPolicy to create:'));
      console.log(`  Name: ${policy.name}`);
      console.log(`  Description: ${policy.description || '-'}`);

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Create this policy?',
          default: true,
        },
      ]);

      if (confirm) {
        spinner.start('Creating policy...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        spinner.succeed(`Policy "${policy.name}" created`);
      }
    } catch (error) {
      spinner.fail('Failed to create policy from file');
      console.error(chalk.red(error));
    }
    return;
  }

  // Interactive creation
  console.log(chalk.blue('\\n📋 Create New Policy\\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Policy name:',
      validate: (input) => input.length > 0 || 'Name is required',
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
      when: (answers) => answers.kioskMode,
    },
    {
      type: 'confirm',
      name: 'lockStatusBar',
      message: 'Lock status bar?',
      when: (answers) => answers.kioskMode,
      default: true,
    },
    {
      type: 'number',
      name: 'heartbeatInterval',
      message: 'Heartbeat interval (seconds):',
      default: 60,
    },
    {
      type: 'confirm',
      name: 'isDefault',
      message: 'Set as default policy?',
      default: false,
    },
  ]);

  const policy = {
    name: answers.name,
    description: answers.description || null,
    isDefault: answers.isDefault,
    settings: {
      kioskMode: answers.kioskMode,
      mainApp: answers.mainApp,
      lockStatusBar: answers.lockStatusBar ?? false,
      heartbeatInterval: answers.heartbeatInterval,
    },
  };

  const spinner = ora('Creating policy...').start();

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    spinner.succeed(`Policy "${policy.name}" created`);
    console.log(chalk.gray('\\nPolicy ID: policy_' + Date.now()));
  } catch (error) {
    spinner.fail('Failed to create policy');
    console.error(chalk.red(error));
  }
}

export async function applyPolicy(policyId: string, deviceId: string): Promise<void> {
  const spinner = ora(`Applying policy ${policyId} to device ${deviceId}...`).start();

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    spinner.succeed(`Policy applied to device ${deviceId}`);
    console.log(chalk.gray('The device will receive the new policy on its next sync.'));
  } catch (error) {
    spinner.fail('Failed to apply policy');
    console.error(chalk.red(error));
  }
}
