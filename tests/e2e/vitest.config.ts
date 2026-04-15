import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.e2e.test.ts'],
    // E2E tests hit real network services (Postgres), so give them
    // generous timeouts. The typical run is well under 2s, but we
    // allow headroom for the docker-compose startup on a cold machine.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Run serially — the tests share the same Postgres instance and
    // some of them truncate tables. Running them in parallel would
    // introduce cross-test races that don't reflect real-world usage.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
