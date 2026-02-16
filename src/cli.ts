#!/usr/bin/env node
import open from 'open';

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  getConfigPath,
  setOllamaBaseUrl,
  setLMStudioBaseUrl,
  setStableDiffusionBaseUrl,
  getEnvironment,
  setEnvironment,
  getEnvironmentInfo,
  type Environment,
} from './config.js';
import {
  discoverAllModels,
  discoverAllModelsWithParameters,
  isAnyProviderRunning,
} from './providers/index.js';
import {
  getRegisteredModels,
  pollDeviceAuth,
  registerLocalModel,
  requestDeviceAuth,
  verifyApiKey,
} from './api.js';
import { TunnelRunner } from './runner.js';
import {
  displayModels,
  sleep,
  clearTerminal,
  MODEL_TYPE_MAP,
} from './helpers.js';

const program = new Command();

program
  .name('mindstudio-local')
  .description('Run local AI models with MindStudio')
  .version('0.1.0');

// Global option for environment
program.option(
  '-e, --env <environment>',
  'Environment to use (prod, local)',
  undefined,
);

// Pre-action hook to set environment from global option
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.env) {
    if (opts.env !== 'prod' && opts.env !== 'local') {
      console.log(
        chalk.red(`Invalid environment: ${opts.env}. Use 'prod' or 'local'.`),
      );
      process.exit(1);
    }
    setEnvironment(opts.env as Environment);
  }
});

// Helper to show environment badge
function envBadge(): string {
  const env = getEnvironment();
  if (env === 'local') {
    return chalk.bgYellow.black(' LOCAL ');
  }
  return chalk.bgGreen.black(' PROD ');
}

// Auth command
program
  .command('auth')
  .description('Authenticate with MindStudio via browser')
  .action(async () => {
    const info = getEnvironmentInfo();
    console.log(chalk.blue(`\nMindStudio Authentication ${envBadge()}\n`));
    console.log(chalk.white(`API: ${info.apiBaseUrl}\n`));

    const success = await performAuth();
    if (success) {
      console.log(chalk.white(`Config saved to: ${getConfigPath()}\n`));
    } else {
      process.exit(1);
    }
  });

/**
 * Shared auth flow: request device auth, open browser, poll for completion.
 * Returns true on success, false on failure.
 */
async function performAuth(): Promise<boolean> {
  const { url: authUrl, token } = await requestDeviceAuth();
  console.log(chalk.white('\nOpening browser for authentication...\n'));
  console.log(chalk.white("  If browser doesn't open, visit:"));
  console.log(chalk.cyan(`  ${authUrl}\n`));
  await open(authUrl);

  const pollSpinner = ora('Waiting for browser authorization...').start();
  const pollInterval = 2000;
  const maxAttempts = 30;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(pollInterval);
    const result = await pollDeviceAuth(token);

    if (result.status === 'completed' && result.apiKey) {
      setApiKey(result.apiKey);
      pollSpinner.succeed(chalk.green('Authenticated successfully!'));
      return true;
    }

    if (result.status === 'expired') {
      pollSpinner.fail(chalk.red('Authorization expired. Please try again.'));
      return false;
    }

    const remaining = Math.floor(((maxAttempts - i) * pollInterval) / 1000);
    pollSpinner.text = `Waiting for browser authorization... (${remaining}s remaining)`;
  }

  pollSpinner.fail(chalk.red('Authorization timed out. Please try again.'));
  return false;
}

/**
 * Shared register flow: discover models, find unregistered ones, register them.
 * Returns { registered: number, total: number } on success.
 * Throws on critical errors. Returns null if nothing to do.
 */
async function performRegister(): Promise<{
  registered: number;
  total: number;
} | null> {
  const spinner = ora('Discovering local models...').start();

  const localModels = await discoverAllModelsWithParameters();
  if (localModels.length === 0) {
    spinner.fail(chalk.yellow('No local models found.'));
    return null;
  }

  const registeredModels = await getRegisteredModels();
  const registeredNames = new Set(registeredModels);
  const unregisteredModels = localModels.filter(
    (m) => !registeredNames.has(m.name),
  );

  if (unregisteredModels.length === 0) {
    spinner.succeed(chalk.green('All models already registered.'));
    return { registered: 0, total: localModels.length };
  }

  spinner.text = `Registering ${unregisteredModels.length} models...`;
  console.log('\n');

  for (const model of unregisteredModels) {
    const modelType =
      MODEL_TYPE_MAP[model.capability as keyof typeof MODEL_TYPE_MAP];

    await registerLocalModel({
      modelName: model.name,
      provider: model.provider,
      modelType,
      parameters: model.parameters,
    });

    const providerTag = chalk.gray(`[${model.provider}]`);
    const paramsInfo = model.parameters
      ? chalk.cyan(` (${model.parameters.length} params)`)
      : '';
    console.log(chalk.green(`✓ ${model.name} ${providerTag}${paramsInfo}`));
  }

  spinner.succeed(
    chalk.green(`Registered ${unregisteredModels.length} models.`),
  );
  return { registered: unregisteredModels.length, total: localModels.length };
}

// Logout command
program
  .command('logout')
  .description('Remove stored credentials for current environment')
  .action(() => {
    clearApiKey();
    console.log(
      chalk.green(`Logged out from ${getEnvironment()} environment.\n`),
    );
  });

// Setup command
program
  .command('setup')
  .alias('quickstart')
  .description('Interactive setup wizard for installing providers')
  .action(async () => {
    const { startQuickstart } = await import('./quickstart/index.js');
    await startQuickstart();
  });

// Status command
program
  .command('status')
  .description('Check connection status')
  .action(async () => {
    const { showStatusScreen } = await import('./tui/screens/index.js');
    await showStatusScreen();
  });

program
  .command('set-config')
  .description('Set configuration')
  .option('--ollama-url <url>', 'Override Ollama base URL')
  .option('--lmstudio-url <url>', 'Override LM Studio base URL')
  .option('--sd-url <url>', 'Override Stable Diffusion base URL')
  .action(async (options) => {
    if (options.ollamaUrl) {
      setOllamaBaseUrl(options.ollamaUrl);
      console.log(chalk.green(`Ollama base URL set to ${options.ollamaUrl}`));
    }
    if (options.lmstudioUrl) {
      setLMStudioBaseUrl(options.lmstudioUrl);
      console.log(
        chalk.green(`LM Studio base URL set to ${options.lmstudioUrl}`),
      );
    }
    if (options.sdUrl) {
      setStableDiffusionBaseUrl(options.sdUrl);
      console.log(
        chalk.green(`Stable Diffusion base URL set to ${options.sdUrl}`),
      );
    }
  });

// Start command
program
  .command('start')
  .description('Start the local model tunnel')
  .option('--ollama-url <url>', 'Override Ollama base URL')
  .option('--lmstudio-url <url>', 'Override LM Studio base URL')
  .option('--sd-url <url>', 'Override Stable Diffusion base URL')
  .option('--simple', 'Use simple non-interactive mode (no TUI)')
  .action(async (options) => {
    if (options.ollamaUrl) {
      setOllamaBaseUrl(options.ollamaUrl);
    }
    if (options.lmstudioUrl) {
      setLMStudioBaseUrl(options.lmstudioUrl);
    }
    if (options.sdUrl) {
      setStableDiffusionBaseUrl(options.sdUrl);
    }

    // Use TUI by default, fall back to simple mode with --simple flag
    if (!options.simple) {
      const { startTUI } = await import('./tui/index.js');
      await startTUI();
      return;
    }

    // Simple mode
    const info = getEnvironmentInfo();
    console.log(
      chalk.white(`Environment: ${info.current} (${info.apiBaseUrl})`),
    );

    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(
        chalk.red(
          `Not authenticated for ${info.current} environment. Run: mindstudio-local auth\n`,
        ),
      );
      process.exit(1);
    }

    // Verify API key
    const spinner = ora('Connecting to MindStudio...').start();
    const isValid = await verifyApiKey();

    if (!isValid) {
      spinner.fail(chalk.red('Invalid API key. Run: mindstudio-local auth'));
      process.exit(1);
    }
    spinner.succeed(`Connected to MindStudio ${envBadge()}`);

    // Check if any provider is running
    const anyProviderRunning = await isAnyProviderRunning();
    if (!anyProviderRunning) {
      console.log(chalk.red('\nNo local model provider is running.'));
      console.log(chalk.white('Start one of the following:'));
      console.log(chalk.white('  Ollama: ollama serve'));
      console.log(chalk.white('  LM Studio: Start the local server'));
      console.log(chalk.white('  Stable Diffusion: Start AUTOMATIC1111\n'));
      process.exit(1);
    }

    // Start the runner with simple chalk/ora output
    const { attachSimpleListener } = await import('./simple-listener.js');
    attachSimpleListener();
    const runner = new TunnelRunner();
    await runner.startWithDiscovery();
  });

// Models command
program
  .command('models')
  .description('List available local models')
  .action(async () => {
    const anyProviderRunning = await isAnyProviderRunning();

    if (!anyProviderRunning) {
      console.log(chalk.red('\nNo local model provider is running.'));
      console.log(chalk.white('  Start Ollama: ollama serve'));
      console.log(chalk.white('  Start LM Studio: Enable local server'));
      console.log(
        chalk.white('  Start Stable Diffusion: Launch AUTOMATIC1111\n'),
      );
      process.exit(1);
    }

    const models = await discoverAllModels();

    if (models.length === 0) {
      console.log(chalk.yellow('\nNo models found.'));
      console.log(chalk.white('  Ollama: ollama pull llama3.2'));
      console.log(chalk.white('  LM Studio: Load a model in the app'));
      console.log(
        chalk.white('  Stable Diffusion: Models in models/Stable-diffusion/\n'),
      );
      return;
    }

    displayModels(models);

    console.log('');
  });

// Config command
program
  .command('config')
  .description('Show configuration')
  .action(async () => {
    const { showConfigScreen } = await import('./tui/screens/index.js');
    await showConfigScreen();
  });

// Env command - switch or show environment
program
  .command('env [environment]')
  .description('[DEVELOPER ONLY] Show or switch environment (prod, local)')
  .action((environment?: string) => {
    if (environment) {
      if (environment !== 'prod' && environment !== 'local') {
        console.log(
          chalk.red(
            `Invalid environment: ${environment}. Use 'prod' or 'local'.`,
          ),
        );
        process.exit(1);
      }
      setEnvironment(environment as Environment);
      console.log(chalk.green(`\nSwitched to ${environment} environment.\n`));
    }

    const info = getEnvironmentInfo();
    console.log(chalk.blue('\nEnvironment\n'));
    console.log(`  Current:     ${envBadge()}`);
    console.log(`  API URL:     ${chalk.white(info.apiBaseUrl)}`);
    console.log(
      `  API Key:     ${
        info.hasApiKey ? chalk.green('Set') : chalk.yellow('Not set')
      }`,
    );
    console.log('');
    console.log(chalk.white('  Switch with: mindstudio-local env prod'));
    console.log(chalk.white('          or: mindstudio-local env local'));
    console.log('');
  });

// Register command
program
  .command('register')
  .description('Register all local models')
  .action(async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(
        chalk.red("\nNot authenticated. Run 'mindstudio-local auth' first.\n"),
      );
      process.exit(1);
    }

    const anyProviderRunning = await isAnyProviderRunning();
    if (!anyProviderRunning) {
      console.log(chalk.red('\nNo local model provider is running.'));
      console.log(chalk.white('  Start Ollama: ollama serve'));
      console.log(chalk.white('  Start LM Studio: Enable local server'));
      console.log(
        chalk.white('  Start Stable Diffusion: Launch AUTOMATIC1111\n'),
      );
      process.exit(1);
    }

    try {
      const result = await performRegister();
      if (result === null) {
        process.exit(1);
      }
      if (result.registered > 0) {
        console.log(
          chalk.white(
            '\nManage models at: https://app.mindstudio.ai/services/self-hosted-models\n',
          ),
        );
      }
      process.exit(0);
    } catch (error) {
      console.log(
        chalk.red(
          `\nFailed to register models: ${error instanceof Error ? error.message : String(error)}\n`,
        ),
      );
      process.exit(1);
    }
  });

// Default action when no command is provided - launch unified TUI
async function runDefaultAction() {
  const args = process.argv.slice(2);
  // Check if a command was provided (excluding global options like --env)
  const hasCommand = args.some(
    (arg) => !arg.startsWith('-') && arg !== 'prod' && arg !== 'local',
  );

  if (!hasCommand) {
    const { startTUI } = await import('./tui/index.js');
    const { executeSetupAction } = await import('./quickstart/actions.js');
    type Page = import('./tui/types.js').Page;
    let initialPage: Page | undefined;
    while (true) {
      const result = await startTUI({ initialPage });
      initialPage = undefined;
      if (result.startsWith('setup:')) {
        const action = result.slice('setup:'.length);
        await executeSetupAction(action);
        clearTerminal();
        initialPage = 'setup';
        continue;
      }
      if (result.startsWith('onboarding:')) {
        const action = result.slice('onboarding:'.length);
        await executeSetupAction(action);
        clearTerminal();
        initialPage = 'onboarding';
        continue;
      }
      break;
    }
    process.exit(0);
  }
}

// Run default action check, then parse commands
runDefaultAction().then(() => {
  // Only parse if we haven't handled via default action
  if (
    process.argv
      .slice(2)
      .some((arg) => !arg.startsWith('-') && arg !== 'prod' && arg !== 'local')
  ) {
    program.parse();
  }
});
