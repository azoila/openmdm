import { getTableNames } from '@openmdm/core';
import chalk from 'chalk';
import ora from 'ora';
import { generateSqlSchema } from '../generators/sql';

interface MigrateOptions {
  dryRun?: boolean;
  rollback?: boolean;
}

/**
 * `openmdm migrate` — print the SQL for the current schema.
 *
 * This used to print a ~180-line SQL blob hand-maintained inside this file, and
 * it had drifted badly from the schema the adapter actually runs against: it
 * declared `VARCHAR(255)` primary keys where the schema says `varchar(36)`, and
 * it omitted `mdm_app_versions`, `mdm_rollbacks`, `mdm_plugin_storage` and
 * `mdm_enrollment_challenges` entirely. Anyone who followed this path got a
 * database that looked complete and then failed at runtime the first time a
 * query touched a table that had never been created.
 *
 * The schema and the rollback are now derived from `mdmSchema` — the same single
 * source of truth `openmdm generate` uses — so they cannot drift again.
 *
 * The command still only *prints* SQL and keeps no migration history. For that,
 * use `openmdm generate` with drizzle-kit.
 */
export async function runMigrations(options: MigrateOptions): Promise<void> {
  console.log(chalk.blue('\n📦 OpenMDM Database Migration\n'));

  console.log(chalk.yellow('⚠  This command does not execute migrations against your database,'));
  console.log(chalk.yellow('   and keeps no migration history. For that, use:'));
  console.log('');
  console.log(chalk.cyan('     npx openmdm generate --adapter drizzle --provider pg'));
  console.log(chalk.cyan('     npx drizzle-kit generate'));
  console.log(chalk.cyan('     npx drizzle-kit migrate'));
  console.log('');

  if (options.rollback) {
    const sql = generateRollbackSql();

    if (options.dryRun) {
      console.log(chalk.gray('SQL to execute:'));
      console.log(sql);
      return;
    }

    const spinner = ora('Generating rollback SQL...').start();
    spinner.succeed('Rollback SQL generated');

    console.log(chalk.gray('\nRollback SQL:'));
    console.log(sql);
    console.log(chalk.red('\n⚠️  This drops every OpenMDM table and all the data in them.'));
    return;
  }

  const sql = generateSqlSchema({ provider: 'pg' });

  if (options.dryRun) {
    console.log(chalk.gray('SQL to execute:'));
    console.log(sql);
    return;
  }

  const spinner = ora('Generating migration SQL...').start();
  spinner.succeed('Migration SQL generated');

  console.log(chalk.gray('\nMigration SQL:'));
  console.log(sql);

  console.log(chalk.green('\n✅ Schema SQL generated from the current schema.'));
  console.log(chalk.gray('Execute it against your database, or use the drizzle-kit flow above.'));
}

/**
 * Drop every table in the schema.
 *
 * Derived from `mdmSchema` rather than hand-listed, so a table added to the
 * schema is a table this rollback actually drops — the hand-written version had
 * gone stale and left four tables behind. Declaration order is parents-first, so
 * reversing it approximates dependency order; `CASCADE` covers the rest.
 */
function generateRollbackSql(): string {
  const drops = getTableNames()
    .slice()
    .reverse()
    .map((table) => `DROP TABLE IF EXISTS ${table} CASCADE;`)
    .join('\n');

  return `-- OpenMDM Database Rollback
-- Generated from mdmSchema. Drops every OpenMDM table.

${drops}

DROP TYPE IF EXISTS mdm_push_provider;
DROP TYPE IF EXISTS mdm_command_status;
DROP TYPE IF EXISTS mdm_device_status;
`;
}
