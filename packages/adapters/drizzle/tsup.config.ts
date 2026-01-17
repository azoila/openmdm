import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/schema.ts',
    'src/postgres.ts',
    'src/mysql.ts',
    'src/sqlite.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['drizzle-orm'],
});
