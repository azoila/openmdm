import chalk from 'chalk';
import ora from 'ora';
import QRCode from 'qrcode';
import fs from 'fs/promises';

interface QROptions {
  policy?: string;
  group?: string;
  output?: string;
  ascii?: boolean;
}

interface TokenOptions {
  policy?: string;
  group?: string;
  expires?: string;
}

export async function generateQR(options: QROptions): Promise<void> {
  console.log(chalk.blue('\\n🔗 Generate Enrollment QR Code\\n'));

  const serverUrl = process.env.SERVER_URL || 'https://mdm.example.com';
  const deviceSecret = process.env.DEVICE_SECRET;

  if (!deviceSecret) {
    console.log(chalk.yellow('Warning: DEVICE_SECRET not set. Using placeholder.'));
  }

  // Generate enrollment token
  const enrollmentData = {
    serverUrl,
    enrollmentToken: generateEnrollmentToken(),
    policyId: options.policy,
    groupId: options.group,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  const enrollmentUrl = `${serverUrl}/enroll?token=${enrollmentData.enrollmentToken}`;

  const spinner = ora('Generating QR code...').start();

  try {
    if (options.ascii) {
      // Generate ASCII QR for terminal
      const ascii = await QRCode.toString(enrollmentUrl, {
        type: 'terminal',
        small: true,
      });
      spinner.stop();
      console.log(ascii);
    } else if (options.output) {
      // Save to file
      await QRCode.toFile(options.output, enrollmentUrl, {
        width: 400,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });
      spinner.succeed(`QR code saved to ${options.output}`);
    } else {
      // Generate Data URL and display info
      const dataUrl = await QRCode.toDataURL(enrollmentUrl, {
        width: 200,
        margin: 1,
      });
      spinner.succeed('QR code generated');

      console.log(chalk.gray('\\nEnrollment URL:'));
      console.log(chalk.cyan(enrollmentUrl));
      console.log('');
      console.log(chalk.gray('Base64 Data URL (first 100 chars):'));
      console.log(chalk.gray(dataUrl.substring(0, 100) + '...'));
      console.log('');
      console.log(chalk.gray('Use --output to save to file, or --ascii to display in terminal.'));
    }

    console.log('');
    console.log(chalk.gray('Enrollment details:'));
    console.log(chalk.gray(`  Token: ${enrollmentData.enrollmentToken}`));
    console.log(chalk.gray(`  Expires: ${enrollmentData.expiresAt}`));
    if (options.policy) {
      console.log(chalk.gray(`  Policy: ${options.policy}`));
    }
    if (options.group) {
      console.log(chalk.gray(`  Group: ${options.group}`));
    }
    console.log('');
  } catch (error) {
    spinner.fail('Failed to generate QR code');
    console.error(chalk.red(error));
  }
}

export async function generateToken(options: TokenOptions): Promise<void> {
  console.log(chalk.blue('\\n🔑 Generate Enrollment Token\\n'));

  const serverUrl = process.env.SERVER_URL || 'https://mdm.example.com';
  const expiresHours = parseInt(options.expires || '24');

  const token = generateEnrollmentToken();
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);

  console.log(chalk.green('Enrollment Token Generated\\n'));
  console.log(`  ${chalk.gray('Token:')}    ${chalk.cyan(token)}`);
  console.log(`  ${chalk.gray('Expires:')}  ${expiresAt.toISOString()}`);
  console.log(`  ${chalk.gray('Server:')}   ${serverUrl}`);

  if (options.policy) {
    console.log(`  ${chalk.gray('Policy:')}   ${options.policy}`);
  }
  if (options.group) {
    console.log(`  ${chalk.gray('Group:')}    ${options.group}`);
  }

  console.log('\\n' + chalk.gray('Enrollment URL:'));
  console.log(chalk.cyan(`${serverUrl}/enroll?token=${token}`));

  console.log('\\n' + chalk.gray('Android Intent URL:'));
  console.log(
    chalk.cyan(`intent://enroll?token=${token}#Intent;scheme=openmdm;package=com.openmdm.agent;end`)
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
