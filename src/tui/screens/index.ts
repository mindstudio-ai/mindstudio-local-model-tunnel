import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';
import ora from 'ora';
import { HomeScreen } from './HomeScreen.js';
import {
  getConfigPath,
  getApiKey,
  getEnvironment,
  getEnvironmentInfo,
  getOllamaBaseUrl,
  getLMStudioBaseUrl,
  getStableDiffusionBaseUrl,
} from '../../config.js';
import { verifyApiKey } from '../../api.js';
import { getRegisteredModels } from '../../api.js';
import {
  getProviderStatuses,
  discoverAllModels,
} from '../../providers/index.js';
import { displayModels, LogoString, clearTerminal } from '../../helpers.js';

export { HomeScreen } from './HomeScreen.js';

function envBadge(): string {
  const env = getEnvironment();
  if (env === 'local') {
    return chalk.bgYellow.black(' LOCAL ');
  }
  return chalk.bgGreen.black(' PROD ');
}

export async function showStatusScreen(): Promise<void> {
  clearTerminal();

  const info = getEnvironmentInfo();
  console.log(chalk.white(LogoString));
  console.log(chalk.blue(`\nStatus ${envBadge()}\n`));
  console.log(chalk.white(`API: ${info.apiBaseUrl}\n`));

  // Check API key
  const apiKey = getApiKey();
  if (apiKey) {
    const spinner = ora('Checking connection...').start();
    const isValid = await verifyApiKey();
    spinner.stop();
    if (isValid) {
      console.log(chalk.green('✓ MindStudio: Connected'));
    } else {
      console.log(chalk.red('✗ MindStudio: Invalid API key'));
    }
  } else {
    console.log(chalk.yellow('○ MindStudio: Not authenticated'));
  }

  // Check all providers
  const providerStatuses = await getProviderStatuses();
  for (const { provider, running } of providerStatuses) {
    if (running) {
      console.log(chalk.green(`✓ ${provider.displayName}: Running`));
    } else {
      console.log(chalk.gray(`○ ${provider.displayName}: Not running`));
    }
  }

  // Show models if any provider is running
  const models = await discoverAllModels();
  if (models.length > 0) {
    displayModels(models);
  }

  console.log('');
}

export async function showConfigScreen(): Promise<void> {
  clearTerminal();

  const info = getEnvironmentInfo();
  console.log(chalk.blue(`\nConfiguration ${envBadge()}\n`));
  console.log(`  Config file:     ${chalk.white(getConfigPath())}`);
  console.log(`  Environment:     ${chalk.cyan(info.current)}`);
  console.log(`  API URL:         ${chalk.white(info.apiBaseUrl)}`);
  console.log(
    `  API key:         ${info.hasApiKey ? chalk.green('Set') : chalk.yellow('Not set')}`,
  );
  console.log(chalk.blue('\nProvider URLs\n'));
  console.log(`  Ollama:           ${chalk.white(getOllamaBaseUrl())}`);
  console.log(`  LM Studio:        ${chalk.white(getLMStudioBaseUrl())}`);
  console.log(
    `  Stable Diffusion:  ${chalk.white(getStableDiffusionBaseUrl())}`,
  );
  console.log('');
}

export async function showModelsScreen(): Promise<void> {
  clearTerminal();

  console.log(chalk.white(LogoString));
  console.log(chalk.bold('\nLocal Models\n'));

  const spinner = ora('Discovering models...').start();

  const providerStatuses = await getProviderStatuses();
  const runningCount = providerStatuses.filter((s) => s.running).length;

  if (runningCount === 0) {
    spinner.fail(chalk.yellow('No providers are running.'));
    console.log(
      chalk.gray('Start a provider to see available models.'),
    );
    return;
  }

  const models = await discoverAllModels();

  if (models.length === 0) {
    spinner.fail(chalk.yellow('No models found.'));
    console.log(
      chalk.gray(
        'Download models using your provider (e.g., ollama pull llama3.2)',
      ),
    );
    return;
  }

  spinner.stop();

  // Get registered models if authenticated
  let registeredNames = new Set<string>();
  const apiKey = getApiKey();
  if (apiKey) {
    try {
      const registered = await getRegisteredModels();
      registeredNames = new Set(registered);
    } catch {
      // Ignore errors
    }
  }

  const textModels = models.filter((m) => m.capability === 'text');
  const imageModels = models.filter((m) => m.capability === 'image');
  const videoModels = models.filter((m) => m.capability === 'video');

  if (textModels.length > 0) {
    console.log(chalk.green.bold(`Text Models (${textModels.length})`));
    for (const model of textModels) {
      const isRegistered = registeredNames.has(model.name);
      const dot = isRegistered
        ? chalk.green('●')
        : chalk.yellow('○');
      const suffix = isRegistered
        ? ''
        : chalk.gray(' (not registered)');
      console.log(`  ${dot} ${model.name} ${chalk.gray(`[${model.provider}]`)}${suffix}`);
    }
    console.log('');
  }

  if (imageModels.length > 0) {
    console.log(chalk.magenta.bold(`Image Models (${imageModels.length})`));
    for (const model of imageModels) {
      const isRegistered = registeredNames.has(model.name);
      const dot = isRegistered
        ? chalk.magenta('●')
        : chalk.yellow('○');
      const suffix = isRegistered
        ? ''
        : chalk.gray(' (not registered)');
      console.log(`  ${dot} ${model.name} ${chalk.gray(`[${model.provider}]`)}${suffix}`);
    }
    console.log('');
  }

  if (videoModels.length > 0) {
    console.log(chalk.blue.bold(`Video Models (${videoModels.length})`));
    for (const model of videoModels) {
      const isRegistered = registeredNames.has(model.name);
      const dot = isRegistered
        ? chalk.blue('●')
        : chalk.yellow('○');
      const suffix = isRegistered
        ? ''
        : chalk.gray(' (not registered)');
      console.log(`  ${dot} ${model.name} ${chalk.gray(`[${model.provider}]`)}${suffix}`);
    }
    console.log('');
  }

  if (models.length > 0) {
    console.log(
      chalk.gray('● = registered with MindStudio, ○ = not registered'),
    );
  }

  console.log('');
}

export async function showHomeScreen(): Promise<string | null> {
  clearTerminal();
  let nextCommand: string | null = null;
  const { waitUntilExit } = render(
    React.createElement(HomeScreen, {
      onNavigate: (command: string) => {
        nextCommand = command;
      },
    }),
  );
  await waitUntilExit();
  return nextCommand;
}
