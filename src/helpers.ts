import chalk from 'chalk';
import { createRequire } from 'node:module';

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

export const MODEL_TYPE_MAP = {
  text: 'llm_chat',
  image: 'image_generation',
  video: 'video_generation',
} as const;

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export function getVersion(): string {
  return pkg.version;
}

export const LogoString = `
        .=+-.     :++.
        *@@@@@+  :%@@@@%:
      .%@@@@@@#..@@@@@@@=
    .*@@@@@@@--@@@@@@@#.**.
    *@@@@@@@.-@@@@@@@@.#@@*
  .#@@@@@@@-.@@@@@@@* #@@@@%.
  =@@@@@@@-.@@@@@@@#.-@@@@@@+
  :@@@@@@:  +@@@@@#. .@@@@@@:
    .++:     .-*-.     .++:
`;
