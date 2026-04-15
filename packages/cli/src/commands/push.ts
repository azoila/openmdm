import chalk from 'chalk';
import ora from 'ora';
import type { MDMInstance } from '@openmdm/core';
import { withMDM } from '../config.js';

interface PushOptions {
  title?: string;
  message?: string;
}

export const testPush = withMDM(
  async (mdm: MDMInstance, deviceId: string, options: PushOptions) => {
    const title = options.title ?? 'Test Notification';
    const message = options.message ?? 'This is a test from OpenMDM';

    console.log(chalk.blue('\n📲 Send Test Push Notification\n'));
    console.log(`  ${chalk.gray('Device:')}  ${deviceId}`);
    console.log(`  ${chalk.gray('Title:')}   ${title}`);
    console.log(`  ${chalk.gray('Message:')} ${message}`);
    console.log('');

    const device = await mdm.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    const spinner = ora('Sending push notification...').start();
    const result = await mdm.push.send(deviceId, {
      type: 'test',
      payload: { title, message },
      priority: 'high',
    });

    if (result.success) {
      spinner.succeed('Push notification sent');
      if (result.messageId) {
        console.log(chalk.gray(`Message ID: ${result.messageId}`));
      }
    } else {
      spinner.fail('Push notification failed');
      if (result.error) {
        console.error(chalk.red(result.error));
      }
      process.exitCode = 1;
    }
  }
);
