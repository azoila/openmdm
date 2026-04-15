# @openmdm/tests-e2e

End-to-end integration tests that run against **real infrastructure**, not mocks. These cover code paths that unit tests with fakes cannot validate — specifically, anything that crosses the boundary between OpenMDM and an external system (database, push provider, blob store).

This package is **private** and **never published**.

## What's here today

- **`plugin-storage.e2e.test.ts`** — exercises `drizzleAdapter`'s `getPluginValue` / `setPluginValue` / `deletePluginValue` / `listPluginKeys` / `clearPluginData` against a real Postgres. Guards the exact code path the kiosk plugin depends on for lockout state persistence.

## Running locally

1. Start the test Postgres with docker-compose:

   ```bash
   docker compose -f docker-compose.test.yml up -d postgres
   ```

2. Run the suite from the repo root:

   ```bash
   pnpm test:e2e
   ```

3. When you're done:

   ```bash
   docker compose -f docker-compose.test.yml down
   ```

The test Postgres runs on port **54329** (not the default 5432) so it won't collide with a Postgres you might already have running. Its data directory lives in `tmpfs`, so every `docker compose up` starts from a clean slate.

## How it differs from unit tests

| | Unit tests | E2E tests |
|---|---|---|
| Infra | None (in-memory fakes) | Real Postgres via docker-compose |
| Speed | Milliseconds | Seconds |
| What breaks | Logic bugs in pure functions | SQL dialect issues, JSONB serialization, `onConflictDoUpdate` semantics, timezone handling, index behavior |
| When to write one | Always first | When the failure mode only manifests against a real database |

If you find yourself mocking the database inside a unit test and the mock is starting to re-implement Postgres behavior, that's the signal to write an e2e test instead.

## Adding a new test

1. Create `tests/*.e2e.test.ts`.
2. Import the shared connection helper: `import { connect, resetPluginStorage } from '../src/db';`
3. In `beforeAll`, call `connect()` to get a Drizzle instance with the bootstrap schema already applied. In `afterAll`, call the returned `close()` to drain the pool.
4. In `beforeEach`, call any `reset*` helper relevant to your test to start from a clean slate.
5. If your test needs tables the bootstrap doesn't provide, add the DDL to `src/db.ts` under a new `bootstrap*Table` helper. **Keep the DDL in lockstep with the corresponding `postgres.ts` table definition** — a drift here is the kind of bug this whole harness exists to catch in *other* code.

## CI

The `e2e` job in `.github/workflows/ci.yml` runs this suite on every pull request, with a Postgres 16 service container. It's a required status check on the `main` branch, so merging is blocked until the e2e suite passes.
