import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/schema.ts', 'src/postgres.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['drizzle-orm'],
  },
  // CJS build for the postgres schema entry only. drizzle-kit loads schema
  // files through a CJS require(), so table definitions must be requireable.
  // The other entries stay ESM-only: index.ts depends on nanoid (ESM-only)
  // and schema.ts on @openmdm/core (ESM-only), so a CJS build of those would
  // fail at require-time anyway. postgres.ts depends only on drizzle-orm,
  // which ships both formats.
  {
    entry: ['src/postgres.ts'],
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: true,
    external: ['drizzle-orm'],
  },
]);
