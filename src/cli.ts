#!/usr/bin/env node
import open from "open";

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  getConfigPath,
  setOllamaBaseUrl,
  setLMStudioBaseUrl,
  getEnvironment,
  setEnvironment,
  getEnvironmentInfo,
  type Environment,
  getOllamaBaseUrl,
  getLMStudioBaseUrl,
} from "./config.js";
import {
  discoverAllModels,
  getProviderStatuses,
  isAnyProviderRunning,
  type LocalModel,
} from "./providers/index.js";
import {
  getRegisteredModels,
  pollDeviceAuth,
  registerLocalModel,
  requestDeviceAuth,
  verifyApiKey,
} from "./api.js";
import { LocalModelRunner } from "./runner.js";

const program = new Command();

program
  .name("mindstudio-local")
  .description("Run local AI models with MindStudio")
  .version("0.1.0");

// Global option for environment
program.option(
  "-e, --env <environment>",
  "Environment to use (prod, local)",
  undefined
);

// Pre-action hook to set environment from global option
program.hook("preAction", (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.env) {
    if (opts.env !== "prod" && opts.env !== "local") {
      console.log(
        chalk.red(`Invalid environment: ${opts.env}. Use 'prod' or 'local'.`)
      );
      process.exit(1);
    }
    setEnvironment(opts.env as Environment);
  }
});

// Helper to show environment badge
function envBadge(): string {
  const env = getEnvironment();
  if (env === "local") {
    return chalk.bgYellow.black(" LOCAL ");
  }
  return chalk.bgGreen.black(" PROD ");
}

const displayModels = (models: LocalModel[]) => {
  console.log(chalk.blue("\nAvailable Models\n"));

  models.forEach((m) => {
    const providerTag = chalk.blue(`[${m.provider}]`);
    console.log(`  ${chalk.green("*")} ${m.name} ${providerTag}`);
  });

  console.log("");
};

// Auth command
program
  .command("auth")
  .description("Authenticate with MindStudio via browser")
  .action(async () => {
    const info = getEnvironmentInfo();
    console.log(chalk.blue(`\nMindStudio Authentication ${envBadge()}\n`));
    console.log(chalk.white(`API: ${info.apiBaseUrl}\n`));

    const spinner = ora("Requesting authorization...").start();

    const { url: authUrl, token } = await requestDeviceAuth();
    spinner.stop();

    console.log(chalk.white("Opening browser for authentication...\n"));
    console.log(chalk.white(`  If browser doesn't open, visit:`));
    console.log(chalk.cyan(`  ${authUrl}\n`));

    await open(authUrl);

    const pollSpinner = ora("Waiting for browser authorization...").start();
    const pollInterval = 2000;
    const maxAttempts = 30;

    for (let i = 0; i < maxAttempts; i++) {
      await sleep(pollInterval);

      const result = await pollDeviceAuth(token);

      if (result.status === "completed" && result.apiKey) {
        setApiKey(result.apiKey);
        pollSpinner.succeed(chalk.green("Authenticated successfully!"));
        console.log(chalk.white(`Config saved to: ${getConfigPath()}\n`));
        return;
      }

      if (result.status === "expired") {
        pollSpinner.fail(chalk.red("Authorization expired. Please try again."));
        process.exit(1);
      }

      const remaining = Math.floor(((maxAttempts - i) * pollInterval) / 1000);
      pollSpinner.text = `Waiting for browser authorization... (${remaining}s remaining)`;
    }

    pollSpinner.fail(chalk.red("Authorization timed out. Please try again."));
    process.exit(1);
  });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Logout command
program
  .command("logout")
  .description("Remove stored credentials for current environment")
  .action(() => {
    clearApiKey();
    console.log(
      chalk.green(`Logged out from ${getEnvironment()} environment.\n`)
    );
  });

// Status command
program
  .command("status")
  .description("Check connection status")
  .action(async () => {
    const info = getEnvironmentInfo();
    console.log(chalk.blue(`\nStatus ${envBadge()}\n`));
    console.log(chalk.white(`API: ${info.apiBaseUrl}\n`));

    // Check API key
    const apiKey = getApiKey();
    if (apiKey) {
      const isValid = await verifyApiKey();
      if (isValid) {
        console.log(chalk.green("✓ MindStudio: Connected"));
      } else {
        console.log(chalk.red("✗ MindStudio: Invalid API key"));
      }
    } else {
      console.log(chalk.yellow("○ MindStudio: Not authenticated"));
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

    console.log("");
  });

program
  .command("set-config")
  .description("Set configuration")
  .option("--ollama-url <url>", "Override Ollama base URL")
  .option("--lmstudio-url <url>", "Override LM Studio base URL")
  .action(async (options) => {
    if (options.ollamaUrl) {
      setOllamaBaseUrl(options.ollamaUrl);
      console.log(chalk.green(`Ollama base URL set to ${options.ollamaUrl}`));
    }
    if (options.lmstudioUrl) {
      setLMStudioBaseUrl(options.lmstudioUrl);
      console.log(
        chalk.green(`LM Studio base URL set to ${options.lmstudioUrl}`)
      );
    }
  });

// Start command
program
  .command("start")
  .description("Start the local model tunnel")
  .option("--ollama-url <url>", "Override Ollama base URL")
  .option("--lmstudio-url <url>", "Override LM Studio base URL")
  .action(async (options) => {
    if (options.ollamaUrl) {
      setOllamaBaseUrl(options.ollamaUrl);
    }
    if (options.lmstudioUrl) {
      setLMStudioBaseUrl(options.lmstudioUrl);
    }

    const info = getEnvironmentInfo();
    console.log(
      chalk.white(`Environment: ${info.current} (${info.apiBaseUrl})`)
    );

    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(
        chalk.red(
          `Not authenticated for ${info.current} environment. Run: mindstudio-local auth\n`
        )
      );
      process.exit(1);
    }

    // Verify API key
    const spinner = ora("Connecting to MindStudio...").start();
    const isValid = await verifyApiKey();

    if (!isValid) {
      spinner.fail(chalk.red("Invalid API key. Run: mindstudio-local auth"));
      process.exit(1);
    }
    spinner.succeed(`Connected to MindStudio ${envBadge()}`);

    // Check if any provider is running
    const anyProviderRunning = await isAnyProviderRunning();
    if (!anyProviderRunning) {
      console.log(chalk.red("\nNo local model provider is running."));
      console.log(chalk.white("Start one of the following:"));
      console.log(chalk.white("  Ollama: ollama serve"));
      console.log(chalk.white("  LM Studio: Start the local server\n"));
      process.exit(1);
    }

    // Start the runner
    const runner = new LocalModelRunner();
    await runner.start();
  });

// Models command
program
  .command("models")
  .description("List available local models")
  .action(async () => {
    const anyProviderRunning = await isAnyProviderRunning();

    if (!anyProviderRunning) {
      console.log(chalk.red("\nNo local model provider is running."));
      console.log(chalk.white("  Start Ollama: ollama serve"));
      console.log(chalk.white("  Start LM Studio: Enable local server\n"));
      process.exit(1);
    }

    const models = await discoverAllModels();

    if (models.length === 0) {
      console.log(chalk.yellow("\nNo models found."));
      console.log(chalk.white("  Ollama: ollama pull llama3.2"));
      console.log(chalk.white("  LM Studio: Load a model in the app\n"));
      return;
    }

    displayModels(models);

    console.log("");
  });

// Config command
program
  .command("config")
  .description("Show configuration")
  .action(() => {
    const info = getEnvironmentInfo();
    console.log(chalk.blue(`\nConfiguration ${envBadge()}\n`));
    console.log(`  Config file:  ${chalk.white(getConfigPath())}`);
    console.log(`  Environment:  ${chalk.cyan(info.current)}`);
    console.log(`  API URL:      ${chalk.white(info.apiBaseUrl)}`);
    console.log(`  Ollama Base URL:   ${chalk.white(getOllamaBaseUrl())}`);
    console.log(`  LM Studio Base URL: ${chalk.white(getLMStudioBaseUrl())}`);
    console.log(
      `  API key:      ${
        info.hasApiKey ? chalk.green("Set") : chalk.yellow("Not set")
      }`
    );
    console.log("");
  });

// Env command - switch or show environment
program
  .command("env [environment]")
  .description("[DEVELOPER ONLY] Show or switch environment (prod, local)")
  .action((environment?: string) => {
    if (environment) {
      if (environment !== "prod" && environment !== "local") {
        console.log(
          chalk.red(
            `Invalid environment: ${environment}. Use 'prod' or 'local'.`
          )
        );
        process.exit(1);
      }
      setEnvironment(environment as Environment);
      console.log(chalk.green(`\nSwitched to ${environment} environment.\n`));
    }

    const info = getEnvironmentInfo();
    console.log(chalk.blue("\nEnvironment\n"));
    console.log(`  Current:     ${envBadge()}`);
    console.log(`  API URL:     ${chalk.white(info.apiBaseUrl)}`);
    console.log(
      `  API Key:     ${
        info.hasApiKey ? chalk.green("Set") : chalk.yellow("Not set")
      }`
    );
    console.log("");
    console.log(chalk.white("  Switch with: mindstudio-local env prod"));
    console.log(chalk.white("          or: mindstudio-local env local"));
    console.log("");
  });

// Register command
program
  .command("register")
  .description("Register all local models")
  .action(async () => {
    // Check if authenticated
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(
        chalk.red("\nNot authenticated. Run 'mindstudio-local auth' first.\n")
      );
      process.exit(1);
    }

    // Check if any provider is running
    const anyProviderRunning = await isAnyProviderRunning();
    if (!anyProviderRunning) {
      console.log(chalk.red("\nNo local model provider is running."));
      console.log(chalk.white("  Start Ollama: ollama serve"));
      console.log(chalk.white("  Start LM Studio: Enable local server\n"));
      process.exit(1);
    }

    // Get all local models from all providers
    const spinner = ora("Loading local models...").start();
    const localModels = await discoverAllModels();
    spinner.succeed();

    if (localModels.length === 0) {
      spinner.fail(chalk.yellow("No local models found."));
      console.log(chalk.white("  Ollama: ollama pull llama3.2"));
      console.log(chalk.white("  LM Studio: Load a model in the app\n"));
      process.exit(1);
    }

    const registeredModels = await getRegisteredModels();
    const registeredNames = new Set(registeredModels);

    const unregisteredModels = localModels.filter(
      (m) => !registeredNames.has(m.name)
    );

    if (localModels.length > 0 && unregisteredModels.length === 0) {
      console.log(
        chalk.green("\n✓ All local models are already registered.\n")
      );
      process.exit(0);
    }

    const registerSpinner = ora(`Registering models...`).start();

    try {
      console.log("\n");
      for (const model of unregisteredModels) {
        await registerLocalModel(model.name, model.provider);
        const providerTag = chalk.blue(`[${model.provider}]`);
        console.log(chalk.green(`✓ ${model.name} ${providerTag}\n`));
      }

      registerSpinner.succeed(
        chalk.green("All local models registered successfully.\n")
      );

      console.log(
        chalk.white(
          "Manage models at: https://app.mindstudio.ai/services/self-hosted-models\n"
        )
      );
      process.exit(0);
    } catch (error) {
      registerSpinner.fail(chalk.red(`Failed to register models`));
      console.log(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}\n`
        )
      );
      process.exit(1);
    }
  });

program.parse();
