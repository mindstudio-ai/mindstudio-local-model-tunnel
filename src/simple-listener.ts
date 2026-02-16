import chalk from 'chalk';
import ora, { Ora } from 'ora';
import {
  requestEvents,
  type RequestStartEvent,
  type RequestCompleteEvent,
} from './events.js';

let spinner: Ora | null = null;
let activeRequests = 0;
let unsubStart: (() => void) | null = null;
let unsubComplete: (() => void) | null = null;

function updateSpinner(): void {
  if (!spinner) return;
  if (activeRequests > 0) {
    spinner.text = `Processing ${activeRequests} request(s)...`;
  } else {
    spinner.text = 'Waiting for requests...';
  }
}

function restoreSpinner(): void {
  spinner = ora({
    text: 'Waiting for requests...',
    color: 'cyan',
  }).start();
  updateSpinner();
}

function handleStart(event: RequestStartEvent): void {
  activeRequests++;
  spinner?.stop();
  console.log(chalk.cyan(`\n⚡ Processing: ${event.modelId}`));
  console.log(chalk.gray(`  Request type: ${event.requestType}`));
  updateSpinner();
}

function handleComplete(event: RequestCompleteEvent): void {
  activeRequests--;

  if (event.success) {
    const duration = (event.duration / 1000).toFixed(1);
    let detail = '';
    if (event.result?.chars) {
      detail = ` (${event.result.chars} chars)`;
    } else if (event.result?.imageSize) {
      const sizeKB = Math.round(event.result.imageSize / 1024);
      detail = ` (${sizeKB}KB)`;
    } else if (event.result?.videoSize) {
      const sizeMB = Math.round(event.result.videoSize / 1024 / 1024);
      detail = ` (${sizeMB}MB)`;
    }
    console.log(chalk.green(`\n✓ Completed in ${duration}s${detail}\n`));
  } else {
    console.log(chalk.red(`\n✗ Failed: ${event.error || 'Unknown error'}\n`));
  }

  restoreSpinner();
}

export function attachSimpleListener(): void {
  spinner = ora({
    text: 'Waiting for requests...',
    color: 'cyan',
  }).start();

  unsubStart = requestEvents.onStart(handleStart);
  unsubComplete = requestEvents.onComplete(handleComplete);
}

export function detachSimpleListener(): void {
  spinner?.stop();
  spinner = null;
  unsubStart?.();
  unsubComplete?.();
  unsubStart = null;
  unsubComplete = null;
}
