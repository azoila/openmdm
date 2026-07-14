/**
 * What `openmdm generate` actually emits.
 *
 * The generators derive from `mdmSchema` in `@openmdm/core`, so a table or
 * column missing from that declaration is a table or column the CLI silently
 * never creates. That is not theoretical: `mdm_enrollment_challenges` was
 * missing from the declaration while the runtime adapter required it, so
 * consumers who ran `openmdm generate` got a schema the adapter could not run
 * against — and hand-patched the generated file, carrying a "do not regenerate"
 * warning in their repo.
 *
 * These tests assert the generated output actually contains the things a working
 * deployment needs. `packages/adapters/drizzle/tests/schema-parity.test.ts` is
 * the other half: it asserts the declaration matches the runtime schema.
 */

import { describe, expect, it } from 'vitest';
import { generateDrizzleSchema } from '../src/generators/drizzle';
import { generateSqlSchema } from '../src/generators/sql';

describe('SQL generator (pg)', () => {
  const sql = generateSqlSchema({ provider: 'pg' });

  it('creates every table the runtime adapter needs', () => {
    for (const table of [
      'mdm_devices',
      'mdm_policies',
      'mdm_policy_versions',
      'mdm_applications',
      'mdm_commands',
      'mdm_events',
      'mdm_groups',
      'mdm_device_groups',
      'mdm_push_tokens',
      'mdm_app_versions',
      'mdm_rollbacks',
      'mdm_plugin_storage',
      'mdm_enrollment_challenges',
    ]) {
      expect(sql, `generated SQL is missing ${table}`).toContain(table);
    }
  });

  it('creates the device-pinned-key enrollment columns', () => {
    // Without these, Phase 2b enrollment fails against a generated schema.
    expect(sql).toContain('public_key');
    expect(sql).toContain('enrollment_method');
  });

  it('creates the command durability columns', () => {
    expect(sql).toContain('idempotency_key');
    expect(sql).toContain('expires_at');
    expect(sql).toContain('attempt_count');
    expect(sql).toContain('max_attempts');
    expect(sql).toContain('last_attempt_at');
  });

  it('creates the tenant columns', () => {
    expect(sql).toContain('tenant_id');
  });

  it('creates the policy-compliance columns', () => {
    expect(sql).toContain('applied_policy_version');
    expect(sql).toContain('version');
  });

  it('includes `expired` in the command status enum', () => {
    expect(sql).toContain('expired');
  });
});

describe('Drizzle generator (pg)', () => {
  const schema = generateDrizzleSchema({ provider: 'pg' });

  it('emits every table', () => {
    for (const table of [
      'mdmDevices',
      'mdmPolicies',
      'mdmPolicyVersions',
      'mdmCommands',
      'mdmPluginStorage',
      'mdmEnrollmentChallenges',
    ]) {
      expect(schema, `generated schema is missing ${table}`).toContain(table);
    }
  });

  it('emits the columns consumers previously hand-patched in', () => {
    expect(schema).toContain('publicKey');
    expect(schema).toContain('enrollmentMethod');
    expect(schema).toContain('idempotencyKey');
    expect(schema).toContain('tenantId');
  });
});
