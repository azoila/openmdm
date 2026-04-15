import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { drizzleAdapter } from '../../../packages/adapters/drizzle/src/index';
import {
  mdmEnrollmentChallenges,
  mdmPluginStorage,
} from '../../../packages/adapters/drizzle/src/postgres';
import type { DatabaseAdapter } from '../../../packages/core/src/types';
import {
  connect,
  resetEnrollmentChallenges,
  type TestDB,
} from '../src/db';

/**
 * E2E tests for the Phase 2b enrollment challenge storage path
 * against a real Postgres.
 *
 * The critical property is the **atomic single-use consume** — two
 * concurrent consume attempts on the same challenge must return
 * exactly one success and one null. Unit tests with an in-memory
 * fake can pretend, but only a real database proves the
 * `UPDATE ... WHERE consumed_at IS NULL RETURNING *` semantics
 * actually work under concurrency.
 */

type AdapterWithChallenges = Required<
  Pick<
    DatabaseAdapter,
    | 'createEnrollmentChallenge'
    | 'findEnrollmentChallenge'
    | 'consumeEnrollmentChallenge'
    | 'pruneExpiredEnrollmentChallenges'
  >
>;

function assertHasChallenges(
  adapter: DatabaseAdapter,
): asserts adapter is DatabaseAdapter & AdapterWithChallenges {
  if (
    !adapter.createEnrollmentChallenge ||
    !adapter.consumeEnrollmentChallenge
  ) {
    throw new Error('drizzleAdapter did not expose enrollment-challenge methods');
  }
}

describe('drizzleAdapter enrollment challenges (e2e, real Postgres)', () => {
  let db: TestDB;
  let close: () => Promise<void>;
  let adapter: DatabaseAdapter & AdapterWithChallenges;

  beforeAll(async () => {
    const connection = await connect();
    db = connection.db;
    close = connection.close;

    const adapterUntyped = drizzleAdapter(db as never, {
      tables: {
        // Stub the unused tables with any valid table reference so
        // the adapter's type checks pass. This test only exercises
        // the enrollment-challenges branch.
        devices: mdmEnrollmentChallenges as never,
        policies: mdmEnrollmentChallenges as never,
        applications: mdmEnrollmentChallenges as never,
        commands: mdmEnrollmentChallenges as never,
        events: mdmEnrollmentChallenges as never,
        groups: mdmEnrollmentChallenges as never,
        deviceGroups: mdmEnrollmentChallenges as never,
        pushTokens: mdmEnrollmentChallenges as never,
        pluginStorage: mdmPluginStorage,
        enrollmentChallenges: mdmEnrollmentChallenges,
      },
    });
    assertHasChallenges(adapterUntyped);
    adapter = adapterUntyped;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetEnrollmentChallenges(db);
  });

  it('createEnrollmentChallenge persists a row that findEnrollmentChallenge can read', async () => {
    const now = new Date('2026-04-15T12:00:00Z');
    const expiresAt = new Date('2026-04-15T12:05:00Z');
    await adapter.createEnrollmentChallenge({
      challenge: 'chal-1',
      expiresAt,
      consumedAt: null,
      createdAt: now,
    });

    const found = await adapter.findEnrollmentChallenge('chal-1');
    expect(found).not.toBeNull();
    expect(found!.challenge).toBe('chal-1');
    expect(found!.consumedAt).toBeNull();
    expect(found!.expiresAt.toISOString()).toBe(expiresAt.toISOString());
  });

  it('findEnrollmentChallenge returns null for an unknown challenge', async () => {
    const found = await adapter.findEnrollmentChallenge('never-existed');
    expect(found).toBeNull();
  });

  it('consumeEnrollmentChallenge marks the row consumed on first call', async () => {
    const now = new Date();
    await adapter.createEnrollmentChallenge({
      challenge: 'chal-consume',
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      consumedAt: null,
      createdAt: now,
    });

    const consumed = await adapter.consumeEnrollmentChallenge('chal-consume');
    expect(consumed).not.toBeNull();
    expect(consumed!.consumedAt).not.toBeNull();
  });

  it('consumeEnrollmentChallenge returns null on the second call — single-use', async () => {
    const now = new Date();
    await adapter.createEnrollmentChallenge({
      challenge: 'chal-single-use',
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      consumedAt: null,
      createdAt: now,
    });

    const first = await adapter.consumeEnrollmentChallenge('chal-single-use');
    const second = await adapter.consumeEnrollmentChallenge('chal-single-use');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('consume is atomic — two concurrent calls produce exactly one success', async () => {
    // This is the property that a mock can't verify. We fire
    // concurrent consume attempts in the same tick and rely on
    // Postgres's row-level locking + RETURNING to produce exactly
    // one winner. If the adapter implementation ever regresses to
    // a non-atomic "read then write" pattern, both calls race and
    // both succeed.
    const now = new Date();
    await adapter.createEnrollmentChallenge({
      challenge: 'chal-race',
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      consumedAt: null,
      createdAt: now,
    });

    const [a, b, c] = await Promise.all([
      adapter.consumeEnrollmentChallenge('chal-race'),
      adapter.consumeEnrollmentChallenge('chal-race'),
      adapter.consumeEnrollmentChallenge('chal-race'),
    ]);

    const successes = [a, b, c].filter((r) => r !== null);
    expect(successes).toHaveLength(1);
  });

  it('consumeEnrollmentChallenge returns null for an unknown challenge', async () => {
    const result = await adapter.consumeEnrollmentChallenge('never-existed');
    expect(result).toBeNull();
  });

  it('pruneExpiredEnrollmentChallenges deletes only expired unconsumed rows', async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 5 * 60 * 1000);
    const past = new Date(now.getTime() - 5 * 60 * 1000);

    await adapter.createEnrollmentChallenge({
      challenge: 'chal-future',
      expiresAt: future,
      consumedAt: null,
      createdAt: now,
    });
    await adapter.createEnrollmentChallenge({
      challenge: 'chal-past-unconsumed',
      expiresAt: past,
      consumedAt: null,
      createdAt: now,
    });
    // Consumed rows are kept for audit even when expired — prune
    // only touches unconsumed. This matches the Drizzle adapter's
    // `AND consumed_at IS NULL` filter.
    await adapter.createEnrollmentChallenge({
      challenge: 'chal-past-consumed',
      expiresAt: past,
      consumedAt: now,
      createdAt: now,
    });

    const deleted = await adapter.pruneExpiredEnrollmentChallenges(now);
    expect(deleted).toBe(1);

    expect(await adapter.findEnrollmentChallenge('chal-future')).not.toBeNull();
    expect(
      await adapter.findEnrollmentChallenge('chal-past-unconsumed'),
    ).toBeNull();
    expect(
      await adapter.findEnrollmentChallenge('chal-past-consumed'),
    ).not.toBeNull();
  });
});
