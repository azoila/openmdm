import chalk from 'chalk';
import ora from 'ora';
import QRCode from 'qrcode';

/**
 * Android managed-provisioning QR generation.
 *
 * A device-owner provisioning QR is NOT an arbitrary URL: the Android
 * setup wizard (scan launched by tapping the welcome screen 6 times on a
 * factory-reset device) expects a JSON object of
 * `android.app.extra.PROVISIONING_*` extras. This command emits that
 * payload, carrying the OpenMDM-specific configuration in the
 * `PROVISIONING_ADMIN_EXTRAS_BUNDLE` under the `openmdm.*` keys the
 * agent's QREnrollmentParser reads.
 */

/** applicationId of the OpenMDM Android agent. */
const AGENT_PACKAGE = 'com.openmdm.agent';
/** Device-admin receiver component of the OpenMDM Android agent. */
const AGENT_COMPONENT = 'com.openmdm.agent/.receiver.MDMDeviceAdminReceiver';

interface QROptions {
  serverUrl?: string;
  secret?: string;
  apkUrl?: string;
  checksum?: string;
  policy?: string;
  group?: string;
  token?: string;
  output?: string;
  ascii?: boolean;
  json?: boolean;
}

interface TokenOptions {
  policy?: string;
  group?: string;
  expires?: string;
}

/**
 * Build the Android device-owner provisioning payload.
 *
 * Standard DPC extras identify and (optionally) fetch the agent APK; the
 * admin-extras bundle carries what the agent needs to reach and enroll with
 * the server. `apkUrl`/`checksum` are optional because they are only needed
 * for factory-reset provisioning — a QR for a device that already has the
 * agent installed omits them.
 */
export function buildProvisioningPayload(options: {
  serverUrl: string;
  secret?: string;
  apkUrl?: string;
  checksum?: string;
  policyId?: string;
  groupId?: string;
  enrollmentToken?: string;
}): Record<string, unknown> {
  const adminExtras: Record<string, string> = {
    'openmdm.server_url': options.serverUrl,
  };
  if (options.secret) adminExtras['openmdm.device_secret'] = options.secret;
  if (options.enrollmentToken) adminExtras['openmdm.enrollment_token'] = options.enrollmentToken;
  if (options.policyId) adminExtras['openmdm.policy_id'] = options.policyId;
  if (options.groupId) adminExtras['openmdm.group_id'] = options.groupId;

  const payload: Record<string, unknown> = {
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_NAME': AGENT_PACKAGE,
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': AGENT_COMPONENT,
    'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
    'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': adminExtras,
  };
  if (options.apkUrl) {
    payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'] =
      options.apkUrl;
  }
  if (options.checksum) {
    payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'] = options.checksum;
  }
  return payload;
}

export async function generateQR(options: QROptions): Promise<void> {
  const serverUrl = options.serverUrl || process.env.SERVER_URL;
  const secret = options.secret || process.env.DEVICE_SECRET;

  if (!serverUrl) {
    console.error(
      chalk.red(
        'A server URL is required: pass --server-url <url> or set SERVER_URL.\n' +
          'Use the URL as reachable FROM THE DEVICE (a LAN IP or public host — ' +
          'never localhost).',
      ),
    );
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    // Machine-readable: the payload and nothing else.
    console.log(
      JSON.stringify(
        buildProvisioningPayload({
          serverUrl,
          secret,
          apkUrl: options.apkUrl,
          checksum: options.checksum,
          policyId: options.policy,
          groupId: options.group,
          enrollmentToken: options.token,
        }),
        null,
        2,
      ),
    );
    return;
  }

  console.log(chalk.blue('\n🔗 Generate Android Provisioning QR Code\n'));

  if (!secret) {
    console.log(
      chalk.yellow(
        '⚠  No device secret (--secret / DEVICE_SECRET). The QR will omit ' +
          'openmdm.device_secret;\n   HMAC-fallback enrollment will not work — ' +
          'only the device-pinned-key path (server ≥ 0.9\n   with challenge ' +
          'storage) can enroll.\n',
      ),
    );
  }
  if (Boolean(options.apkUrl) !== Boolean(options.checksum)) {
    console.log(
      chalk.yellow(
        '⚠  --apk-url and --checksum belong together: Android refuses to install ' +
          'a downloaded DPC\n   without its signing-certificate checksum, and a ' +
          'checksum without an APK does nothing.\n',
      ),
    );
  }
  if (!options.apkUrl) {
    console.log(
      chalk.gray(
        'No --apk-url: this QR only works on devices that already have the agent ' +
          'installed.\nFor factory-reset provisioning, pass --apk-url and --checksum.\n',
      ),
    );
  }

  const payload = buildProvisioningPayload({
    serverUrl,
    secret,
    apkUrl: options.apkUrl,
    checksum: options.checksum,
    policyId: options.policy,
    groupId: options.group,
    enrollmentToken: options.token,
  });
  const content = JSON.stringify(payload);

  const spinner = ora('Generating QR code...').start();

  try {
    if (options.ascii) {
      const ascii = await QRCode.toString(content, {
        type: 'terminal',
        small: true,
      });
      spinner.stop();
      console.log(ascii);
    } else if (options.output) {
      // Type is inferred from the file extension (.png or .svg).
      await QRCode.toFile(options.output, content, {
        errorCorrectionLevel: 'M',
        width: 512,
        margin: 2,
      });
      spinner.succeed(`QR code saved to ${options.output}`);
    } else {
      spinner.stop();
      console.log(JSON.stringify(payload, null, 2));
      console.log('');
      console.log(
        chalk.gray(
          'Use --output enrollment.png to save a scannable image, or --ascii for the terminal.',
        ),
      );
    }

    console.log('');
    console.log(chalk.gray('Provisioning details:'));
    console.log(chalk.gray(`  Server:   ${serverUrl}`));
    console.log(
      chalk.gray(`  Secret:   ${secret ? 'embedded (handle the QR like a credential)' : 'none'}`),
    );
    if (options.apkUrl) console.log(chalk.gray(`  APK:      ${options.apkUrl}`));
    if (options.policy) console.log(chalk.gray(`  Policy:   ${options.policy}`));
    if (options.group) console.log(chalk.gray(`  Group:    ${options.group}`));
    console.log('');
    console.log(
      chalk.gray(
        'Scan: factory-reset the device, tap the welcome screen 6 times, connect Wi-Fi, scan.',
      ),
    );
    console.log('');
  } catch (error) {
    spinner.fail('Failed to generate QR code');
    console.error(chalk.red(String(error)));
    process.exitCode = 1;
  }
}

export async function generateToken(options: TokenOptions): Promise<void> {
  console.log(chalk.blue('\n🔑 Generate Enrollment Token\n'));
  console.log(
    chalk.yellow(
      '⚠  This command currently generates an unsigned, non-persisted token.\n' +
        '   HMAC-signed and server-persisted tokens will land in Phase 2b.\n',
    ),
  );

  const serverUrl = process.env.SERVER_URL || 'https://mdm.example.com';
  const expiresHours = parseInt(options.expires || '24');

  const token = generateEnrollmentToken();
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);

  console.log(chalk.green('Enrollment Token Generated\n'));
  console.log(`  ${chalk.gray('Token:')}    ${chalk.cyan(token)}`);
  console.log(`  ${chalk.gray('Expires:')}  ${expiresAt.toISOString()}`);
  console.log(`  ${chalk.gray('Server:')}   ${serverUrl}`);

  if (options.policy) {
    console.log(`  ${chalk.gray('Policy:')}   ${options.policy}`);
  }
  if (options.group) {
    console.log(`  ${chalk.gray('Group:')}    ${options.group}`);
  }

  console.log('\n' + chalk.gray('Enrollment URL:'));
  console.log(chalk.cyan(`${serverUrl}/enroll?token=${token}`));

  console.log('\n' + chalk.gray('Android Intent URL:'));
  console.log(
    chalk.cyan(
      `intent://enroll?token=${token}#Intent;scheme=openmdm;package=com.openmdm.agent;end`,
    ),
  );
  console.log('');
}

function generateEnrollmentToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = [];
  for (let i = 0; i < 4; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      segment += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(segment);
  }
  return segments.join('-');
}
