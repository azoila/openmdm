import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/types.ts', 'src/schema.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
});
