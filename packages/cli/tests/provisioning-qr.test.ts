/**
 * What `openmdm enroll qr` actually encodes.
 *
 * A device-owner provisioning QR must be the Android setup wizard's JSON
 * format — `android.app.extra.PROVISIONING_*` extras — or the scan silently
 * does nothing. The previous implementation encoded a plain enrollment URL,
 * which no factory-reset device can consume; users following the README hit a
 * dead end with no error. These tests pin the payload to the contract the
 * Android agent's QREnrollmentParser reads (openmdm-android
 * `library/.../enrollment/QREnrollmentParser.kt`).
 */

import { describe, expect, it } from 'vitest';
import { buildProvisioningPayload } from '../src/commands/enroll';

const SERVER = 'https://mdm.example.com/mdm';

describe('buildProvisioningPayload', () => {
  it('identifies the agent DPC by package and component', () => {
    const p = buildProvisioningPayload({ serverUrl: SERVER });
    expect(p['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_NAME']).toBe('com.openmdm.agent');
    expect(p['android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME']).toBe(
      'com.openmdm.agent/.receiver.MDMDeviceAdminReceiver',
    );
  });

  it('always carries the server URL in the admin-extras bundle', () => {
    const p = buildProvisioningPayload({ serverUrl: SERVER });
    const extras = p['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'] as Record<
      string,
      string
    >;
    expect(extras['openmdm.server_url']).toBe(SERVER);
  });

  it('includes optional extras only when provided', () => {
    const bare = buildProvisioningPayload({ serverUrl: SERVER });
    const bareExtras = bare['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'] as Record<
      string,
      string
    >;
    expect(bareExtras).not.toHaveProperty('openmdm.device_secret');
    expect(bareExtras).not.toHaveProperty('openmdm.enrollment_token');
    expect(bareExtras).not.toHaveProperty('openmdm.policy_id');
    expect(bareExtras).not.toHaveProperty('openmdm.group_id');

    const full = buildProvisioningPayload({
      serverUrl: SERVER,
      secret: 's3cret',
      enrollmentToken: 'TOK-1234',
      policyId: 'pol-1',
      groupId: 'grp-1',
    });
    const fullExtras = full['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'] as Record<
      string,
      string
    >;
    expect(fullExtras['openmdm.device_secret']).toBe('s3cret');
    expect(fullExtras['openmdm.enrollment_token']).toBe('TOK-1234');
    expect(fullExtras['openmdm.policy_id']).toBe('pol-1');
    expect(fullExtras['openmdm.group_id']).toBe('grp-1');
  });

  it('adds download location and signature checksum only when provided', () => {
    const bare = buildProvisioningPayload({ serverUrl: SERVER });
    expect(bare).not.toHaveProperty(
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION',
    );
    expect(bare).not.toHaveProperty(
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM',
    );

    const hosted = buildProvisioningPayload({
      serverUrl: SERVER,
      apkUrl: 'https://cdn.example.com/agent.apk',
      checksum: 'gJD-hR3vAbCdEfGh',
    });
    expect(hosted['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION']).toBe(
      'https://cdn.example.com/agent.apk',
    );
    expect(hosted['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM']).toBe(
      'gJD-hR3vAbCdEfGh',
    );
  });

  it('leaves system apps enabled for demo-friendly provisioning', () => {
    const p = buildProvisioningPayload({ serverUrl: SERVER });
    expect(p['android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED']).toBe(true);
  });

  it('serializes to the JSON shape the setup wizard and QREnrollmentParser accept', () => {
    const p = buildProvisioningPayload({ serverUrl: SERVER, secret: 's3cret' });
    const parsed = JSON.parse(JSON.stringify(p));
    // Starts-with-{ detection in the parser: top level must be an object,
    // and the extras bundle must be a nested object, not a string.
    expect(typeof parsed).toBe('object');
    expect(typeof parsed['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']).toBe('object');
  });
});
