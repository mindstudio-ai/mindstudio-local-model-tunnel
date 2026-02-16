import chalk from 'chalk';
import { type LocalModel } from './providers/index.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForEnter(): Promise<void> {
  const { spawn } = await import('child_process');

  console.log(chalk.gray('\nPress Enter to continue...'));

  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const child = isWindows
      ? spawn('cmd', ['/c', 'pause >nul'], { stdio: 'inherit' })
      : spawn('bash', ['-c', 'read -n 1 -s'], { stdio: 'inherit' });

    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

export function clearTerminal(): void {
  process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
}

export const displayModels = (models: LocalModel[]): void => {
  const textModels = models.filter((m) => m.capability === 'text');
  const imageModels = models.filter((m) => m.capability === 'image');
  const videoModels = models.filter((m) => m.capability === 'video');

  if (textModels.length > 0) {
    console.log(chalk.green('\nText Models\n'));
    textModels.forEach((m) => {
      const providerTag = chalk.green(`[${m.provider}]`);
      console.log(`  ${chalk.green('*')} ${m.name} ${providerTag}`);
    });
  }

  if (imageModels.length > 0) {
    console.log(chalk.magenta('\nImage Models\n'));
    imageModels.forEach((m) => {
      const providerTag = chalk.magenta(`[${m.provider}]`);
      console.log(`  ${chalk.magenta('*')} ${m.name} ${providerTag}`);
    });
  }

  if (videoModels.length > 0) {
    console.log(chalk.blue('\nVideo Models\n'));
    videoModels.forEach((m) => {
      const providerTag = chalk.blue(`[${m.provider}]`);
      console.log(`  ${chalk.blue('*')} ${m.name} ${providerTag}`);
    });
  }

  console.log('');
};

export const LogoString = `
        .=+-.     :++.
        *@@@@@+  :%@@@@%:
      .%@@@@@@#..@@@@@@@=
    .*@@@@@@@--@@@@@@@#.**.
    *@@@@@@@.-@@@@@@@@.#@@*
  .#@@@@@@@-.@@@@@@@* #@@@@%.
  =@@@@@@@-.@@@@@@@#.-@@@@@@+
  :@@@@@@:  +@@@@@#. .@@@@@@:
    .++:     .-*-.     .++:   `;
