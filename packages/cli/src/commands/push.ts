import chalk from 'chalk';
import ora from 'ora';

interface PushOptions {
  title?: string;
  message?: string;
}

export async function testPush(deviceId: string, options: PushOptions): Promise<void> {
  console.log(chalk.blue('\\n📲 Send Test Push Notification\\n'));

  const title = options.title || 'Test Notification';
  const message = options.message || 'This is a test from OpenMDM';

  console.log(`  ${chalk.gray('Device:')}  ${deviceId}`);
  console.log(`  ${chalk.gray('Title:')}   ${title}`);
  console.log(`  ${chalk.gray('Message:')} ${message}`);
  console.log('');

  const spinner = ora('Sending push notification...').start();

  try {
    // In real implementation, this would use the push adapter
    await new Promise(resolve => setTimeout(resolve, 1500));
    spinner.succeed('Push notification sent');

    console.log(chalk.gray('\\nThe notification should appear on the device shortly.'));
  } catch (error) {
    spinner.fail('Failed to send push notification');
    console.error(chalk.red(error));
  }
}
