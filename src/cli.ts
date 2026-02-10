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
  setStableDiffusionBaseUrl,
  getEnvironment,
  setEnvironment,
  getEnvironmentInfo,
  type Environment,
  getOllamaBaseUrl,
  getLMStudioBaseUrl,
  getStableDiffusionBaseUrl,
} from "./config.js";
import {
  discoverAllModels,
  discoverAllModelsWithParameters,
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
import { displayModels } from "./helpers.js";

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

async function waitForEnter(): Promise<void> {
  const { spawn } = await import("child_process");

  console.log(chalk.gray("\nPress Enter to continue..."));

  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn("cmd", ["/c", "pause >nul"], { stdio: "inherit" })
      : spawn("bash", ["-c", "read -n 1 -s"], { stdio: "inherit" });

    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
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

// Setup command
program
  .command("setup")
  .alias("quickstart")
  .description("Interactive setup wizard for installing providers")
  .action(async () => {
    const { startQuickstart } = await import("./quickstart/index.js");
    await startQuickstart();
  });

// Status command
program
  .command("status")
  .description("Check connection status")
  .option("--simple", "Use simple text output (no TUI)")
  .action(async (options) => {
    if (!options.simple) {
      process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
      const { showStatusScreen } = await import("./tui/screens/index.js");
      await showStatusScreen();
      return;
    }

    // Simple mode (original behavior)
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
  .option("--sd-url <url>", "Override Stable Diffusion base URL")
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
    if (options.sdUrl) {
      setStableDiffusionBaseUrl(options.sdUrl);
      console.log(
        chalk.green(`Stable Diffusion base URL set to ${options.sdUrl}`)
      );
    }
  });

// Start command
program
  .command("start")
  .description("Start the local model tunnel")
  .option("--ollama-url <url>", "Override Ollama base URL")
  .option("--lmstudio-url <url>", "Override LM Studio base URL")
  .option("--sd-url <url>", "Override Stable Diffusion base URL")
  .option("--simple", "Use simple non-interactive mode (no TUI)")
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
      const { startTUI } = await import("./tui/index.js");
      await startTUI();
      return;
    }

    // Simple mode (original behavior)
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
      console.log(chalk.white("  LM Studio: Start the local server"));
      console.log(chalk.white("  Stable Diffusion: Start AUTOMATIC1111\n"));
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
      console.log(chalk.white("  Start LM Studio: Enable local server"));
      console.log(
        chalk.white("  Start Stable Diffusion: Launch AUTOMATIC1111\n")
      );
      process.exit(1);
    }

    const models = await discoverAllModels();

    if (models.length === 0) {
      console.log(chalk.yellow("\nNo models found."));
      console.log(chalk.white("  Ollama: ollama pull llama3.2"));
      console.log(chalk.white("  LM Studio: Load a model in the app"));
      console.log(
        chalk.white("  Stable Diffusion: Models in models/Stable-diffusion/\n")
      );
      return;
    }

    displayModels(models);

    console.log("");
  });

// Config command
program
  .command("config")
  .description("Show configuration")
  .option("--simple", "Use simple text output (no TUI)")
  .action(async (options) => {
    if (!options.simple) {
      process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
      const { showConfigScreen } = await import("./tui/screens/index.js");
      await showConfigScreen();
      return;
    }

    // Simple mode (original behavior)
    const info = getEnvironmentInfo();
    console.log(chalk.blue(`\nConfiguration ${envBadge()}\n`));
    console.log(`  Config file:     ${chalk.white(getConfigPath())}`);
    console.log(`  Environment:     ${chalk.cyan(info.current)}`);
    console.log(`  API URL:         ${chalk.white(info.apiBaseUrl)}`);
    console.log(
      `  API key:         ${
        info.hasApiKey ? chalk.green("Set") : chalk.yellow("Not set")
      }`
    );
    console.log(chalk.blue("\nProvider URLs\n"));
    console.log(`  Ollama:          ${chalk.white(getOllamaBaseUrl())}`);
    console.log(`  LM Studio:       ${chalk.white(getLMStudioBaseUrl())}`);
    console.log(
      `  Stable Diffusion: ${chalk.white(getStableDiffusionBaseUrl())}`
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
      console.log(chalk.white("  Start LM Studio: Enable local server"));
      console.log(
        chalk.white("  Start Stable Diffusion: Launch AUTOMATIC1111\n")
      );
      process.exit(1);
    }

    // Get all local models from all providers (with parameter schemas)
    const spinner = ora("Loading local models...").start();
    const localModels = await discoverAllModelsWithParameters();
    spinner.succeed();

    if (localModels.length === 0) {
      spinner.fail(chalk.yellow("No local models found."));
      console.log(chalk.white("  Ollama: ollama pull llama3.2"));
      console.log(chalk.white("  LM Studio: Load a model in the app"));
      console.log(
        chalk.white("  Stable Diffusion: Models in models/Stable-diffusion/\n")
      );
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
        const modelTypeMap = {
          text: "llm_chat",
          image: "image_generation",
          video: "video_generation",
        } as const;

        const modelType =
          modelTypeMap[model.capability as keyof typeof modelTypeMap];

        await registerLocalModel({
          modelName: model.name,
          provider: model.provider,
          modelType,
          parameters: model.parameters,
        });

        const providerTag = chalk.gray(`[${model.provider}]`);
        const paramsInfo = model.parameters
          ? chalk.cyan(` (${model.parameters.length} params)`)
          : "";
        console.log(
          chalk.green(`✓ ${model.name} ${providerTag}${paramsInfo}\n`)
        );
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

// Default action when no command is provided - show home screen
async function runDefaultAction() {
  const args = process.argv.slice(2);
  // Check if a command was provided (excluding global options like --env)
  const hasCommand = args.some(
    (arg) => !arg.startsWith("-") && arg !== "prod" && arg !== "local"
  );

  if (!hasCommand) {
    const { showHomeScreen } = await import("./tui/screens/index.js");

    // Loop to handle navigation
    while (true) {
      const nextCommand = await showHomeScreen();

      if (!nextCommand) {
        // User exited without selecting a command
        process.exit(0);
      }

      // Handle the selected command
      process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
      switch (nextCommand) {
        case "start": {
          const { startTUI } = await import("./tui/index.js");
          await startTUI();
          break;
        }
        case "setup": {
          const { startQuickstart } = await import("./quickstart/index.js");
          await startQuickstart();
          process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
          continue; // Return to home screen after setup
        }
        case "auth": {
          // Run auth flow (same logic as auth command)
          const { url: authUrl, token } = await requestDeviceAuth();
          console.log(chalk.white("\nOpening browser for authentication...\n"));
          console.log(chalk.white("  If browser doesn't open, visit:"));
          console.log(chalk.cyan(`  ${authUrl}\n`));
          await open(authUrl);

          const pollSpinner = ora(
            "Waiting for browser authorization..."
          ).start();
          const pollInterval = 2000;
          const maxAttempts = 30;

          let authSuccess = false;
          for (let i = 0; i < maxAttempts; i++) {
            await sleep(pollInterval);
            const result = await pollDeviceAuth(token);

            if (result.status === "completed" && result.apiKey) {
              setApiKey(result.apiKey);
              pollSpinner.succeed(chalk.green("Authenticated successfully!"));
              authSuccess = true;
              break;
            }

            if (result.status === "expired") {
              pollSpinner.fail(
                chalk.red("Authorization expired. Please try again.")
              );
              break;
            }

            const remaining = Math.floor(
              ((maxAttempts - i) * pollInterval) / 1000
            );
            pollSpinner.text = `Waiting for browser authorization... (${remaining}s remaining)`;
          }

          await waitForEnter();
          process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
          continue; // Return to home screen after auth
        }
        case "register": {
          const registerSpinner = ora("Discovering local models...").start();
          try {
            const apiKey = getApiKey();
            if (!apiKey) {
              registerSpinner.fail(
                chalk.red("Not authenticated. Please authenticate first.")
              );
              await waitForEnter();
              process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
              continue;
            }

            const localModels = await discoverAllModelsWithParameters();
            if (localModels.length === 0) {
              registerSpinner.fail(chalk.yellow("No local models found."));
              await waitForEnter();
              process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
              continue;
            }

            const registeredModels = await getRegisteredModels();
            const registeredNames = new Set(registeredModels);
            const unregisteredModels = localModels.filter(
              (m) => !registeredNames.has(m.name)
            );

            if (unregisteredModels.length === 0) {
              registerSpinner.succeed(
                chalk.green("All models already registered.")
              );
              await waitForEnter();
              process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
              continue;
            }

            registerSpinner.text = `Registering ${unregisteredModels.length} models...`;
            console.log("\n");

            for (const model of unregisteredModels) {
              const modelTypeMap = {
                text: "llm_chat",
                image: "image_generation",
                video: "video_generation",
              } as const;

              const modelType =
                modelTypeMap[model.capability as keyof typeof modelTypeMap];

              await registerLocalModel({
                modelName: model.name,
                provider: model.provider,
                modelType,
                parameters: model.parameters,
              });

              console.log(chalk.green(`✓ ${model.name} [${model.provider}]`));
            }

            registerSpinner.succeed(
              chalk.green(`Registered ${unregisteredModels.length} models.`)
            );
            await waitForEnter();
          } catch (error) {
            registerSpinner.fail(
              chalk.red(
                `Failed: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            );
          }
          await waitForEnter();
          process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
          continue; // Return to home screen
        }
        case "models": {
          const { showModelsScreen } = await import("./tui/screens/index.js");
          await showModelsScreen();
          process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
          continue; // Return to home screen after models
        }
        case "config": {
          const { showConfigScreen } = await import("./tui/screens/index.js");
          await showConfigScreen();
          await waitForEnter();
          process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
          continue; // Return to home screen after config
        }
        case "logout": {
          clearApiKey();
          console.log(
            chalk.green("\nLogged out successfully. All credentials cleared.\n")
          );
          await waitForEnter();
          process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
          continue; // Return to home screen after logout
        }
        default:
          process.exit(0);
      }

      // If we reach here (from start), exit the loop
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
      .some((arg) => !arg.startsWith("-") && arg !== "prod" && arg !== "local")
  ) {
    program.parse();
  }
});
