/**
 * Generate Command
 *
 * Generates database schema files for different ORMs.
 * Similar to better-auth's approach.
 */

import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import inquirer from 'inquirer';
import {
  generateDrizzleSchema,
  generateSqlSchema,
  type AdapterType,
  type DatabaseProvider,
} from '../generators/index.js';

interface GenerateOptions {
  adapter?: AdapterType;
  provider?: DatabaseProvider;
  output?: string;
  yes?: boolean;
}

const DEFAULT_OUTPUTS: Record<AdapterType, Record<DatabaseProvider, string>> = {
  drizzle: {
    pg: 'src/db/schema.ts',
    mysql: 'src/db/schema.ts',
    sqlite: 'src/db/schema.ts',
  },
  sql: {
    pg: 'schema.sql',
    mysql: 'schema.sql',
    sqlite: 'schema.sql',
  },
};

export async function runGenerate(options: GenerateOptions): Promise<void> {
  console.log(chalk.blue('\n📦 OpenMDM Schema Generator\n'));

  let { adapter, provider, output } = options;

  // Interactive prompts if not provided
  if (!adapter) {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'adapter',
        message: 'Which adapter do you want to generate schema for?',
        choices: [
          { name: 'Drizzle ORM (TypeScript schema)', value: 'drizzle' },
          { name: 'Raw SQL (SQL file)', value: 'sql' },
        ],
      },
    ]);
    adapter = answer.adapter as AdapterType;
  }

  if (!provider) {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Which database provider?',
        choices: [
          { name: 'PostgreSQL', value: 'pg' },
          { name: 'MySQL', value: 'mysql' },
          { name: 'SQLite', value: 'sqlite' },
        ],
      },
    ]);
    provider = answer.provider as DatabaseProvider;
  }

  // Determine output path
  const defaultOutput = DEFAULT_OUTPUTS[adapter][provider];
  if (!output) {
    if (options.yes) {
      output = defaultOutput;
    } else {
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'output',
          message: 'Output file path:',
          default: defaultOutput,
        },
      ]);
      output = answer.output;
    }
  }

  const outputPath = resolve(process.cwd(), output);

  // Confirm before overwriting
  if (existsSync(outputPath) && !options.yes) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `File ${output} already exists. Overwrite?`,
        default: false,
      },
    ]);
    if (!confirm) {
      console.log(chalk.yellow('Aborted.'));
      return;
    }
  }

  const spinner = ora('Generating schema...').start();

  try {
    let content: string;

    if (adapter === 'drizzle') {
      content = generateDrizzleSchema({ provider });
    } else {
      content = generateSqlSchema({ provider });
    }

    // Ensure directory exists
    const dir = dirname(outputPath);
    await mkdir(dir, { recursive: true });

    // Write file
    writeFileSync(outputPath, content, 'utf-8');

    spinner.succeed(`Schema generated at ${chalk.cyan(output)}`);

    // Show next steps
    console.log(chalk.gray('\nNext steps:'));

    if (adapter === 'drizzle') {
      console.log(chalk.gray(`  1. Review the generated schema at ${output}`));
      console.log(chalk.gray('  2. Run drizzle-kit to generate migrations:'));
      console.log(chalk.cyan('     npx drizzle-kit generate'));
      console.log(chalk.gray('  3. Apply migrations to your database:'));
      console.log(chalk.cyan('     npx drizzle-kit migrate'));
    } else {
      console.log(chalk.gray(`  1. Review the generated SQL at ${output}`));
      console.log(chalk.gray('  2. Execute the SQL against your database'));
    }

    console.log('');
  } catch (error) {
    spinner.fail('Failed to generate schema');
    console.error(chalk.red(error));
    process.exit(1);
  }
}
