import chalk from 'chalk';
import ora from 'ora';
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
import {
  getProviderStatuses,
  discoverAllModels,
} from '../../providers/index.js';
import { displayModels, LogoString, clearTerminal } from '../../helpers.js';

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
