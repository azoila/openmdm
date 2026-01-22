/**
 * OpenMDM Schema Generators
 *
 * Generates database schema files for different ORMs and databases.
 * Inspired by better-auth's approach.
 */

export { generateDrizzleSchema } from './drizzle.js';
export { generateSqlSchema } from './sql.js';

export type DatabaseProvider = 'pg' | 'mysql' | 'sqlite';
export type AdapterType = 'drizzle' | 'sql';

export interface GeneratorOptions {
  adapter: AdapterType;
  provider: DatabaseProvider;
  output?: string;
  tablePrefix?: string;
}
